"""Match routes: events in, SSE and claims, lines and audit out (docs/architecture/12-api.md)."""

from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import ipaddress
import json
import logging
import os
import re
import time
import uuid
from collections import deque
from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any, Literal
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, FastAPI, Header, Query, Request, WebSocket
from fastapi.responses import JSONResponse, Response, StreamingResponse
from matchcast_agents import (
    AgentSet,
    MatchSpawnBudgets,
    MatchWorkflow,
    WorkflowConfig,
    rules_agents,
)
from matchcast_agents.ask import kb_root
from matchcast_agents.data_scientist import ask as ds_ask_season
from matchcast_agents.feeds import FEED_KEYS
from matchcast_agents.grading import scoreboard
from matchcast_agents.grading_live import events_digest, load_live_run
from matchcast_agents.hub import StreamEvent
from matchcast_agents.live import FoundryModelClient, ModelClient, ModelCut, live_agents
from matchcast_agents.live.knowledge import TalkKnowledge
from matchcast_agents.messages import LineRecord
from matchcast_agents.personas import ALIASES, BOOTH, booth, normalise
from matchcast_agents.safety import safety_from_env
from matchcast_agents.statsdesk import A2A_URL, A2AStatsDesk, StatsDeskError
from matchcast_agents.store import stream_key
from matchcast_agents.tables import build_store
from matchcast_agents.tools import ToolCall
from matchcast_agents.translate import LANGUAGES, TranslationService
from matchcast_agents.vision import agreement, engine_stream_of, is_vision_stream, pass_facts
from matchcast_agents.workflow import WorkflowError, feed_kills_in, public_line
from matchcast_contracts import ContractError
from matchcast_mcp.app import build_app
from matchcast_mcp.season import Season, SeasonError
from matchcast_mcp.server import create_server
from mcp import Client
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app import budget
from app.auth import PRODUCER_ROLES, caller_actor, caller_role
from app.call import CallSocket
from app.pipeline import Pipeline
from app.speech import SPEECH_PER_MINUTE, SpeechError, SpeechTokenService
from app.vision import VISION_MAX_BODY, VisionError, VisionService
from app.voice import (
    AUDITION_SCRIPT,
    MAX_CHARS,
    VoiceError,
    VoiceService,
    clip_key,
    speakable,
)
from app.voice import (
    PER_MINUTE as VOICE_PER_MINUTE,
)

TENANT = "demo"
HEARTBEAT_S = 15
ASK_PER_MINUTE = 20  # Copilot questions per browser session; a judge's quick run stays under it
TALK_PER_MINUTE = 20  # player and producer replies per browser session, a budget of their own
ASK_PER_IP_MINUTE = 60  # asks and talks from one address, whatever session ids it sends
DS_PER_MINUTE = 5
ID = r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
STATUS = {
    "not_found": 404,
    "match_exists": 409,
    "forbidden_role": 403,
    "not_approvable": 409,
    "prompt_attack": 400,
    "rate_limited": 429,
}


def pretty(identifier: str) -> str:
    """'harbour-united' -> 'Harbour United': display text when the client sends no names."""
    return " ".join(part.capitalize() for part in identifier.replace("_", "-").split("-") if part)


class Problem(Exception):
    """Rendered as RFC 9457 application/problem+json."""

    def __init__(
        self,
        status: int,
        code: str,
        detail: str,
        path: str | None = None,
        retry_after: int | None = None,
    ):
        self.status, self.code, self.detail, self.path = status, code, detail, path
        self.retry_after = retry_after


def problem_response(error: Problem) -> JSONResponse:
    body = {
        "type": f"https://matchcast.dev/problems/{error.code}",
        "title": error.code.replace("_", " "),
        "status": error.status,
        "detail": error.detail,
        "code": error.code,
        "path": error.path,
        "trace_id": uuid.uuid4().hex,
    }
    headers = {"Retry-After": str(error.retry_after)} if error.retry_after else None
    return JSONResponse(
        body, status_code=error.status, media_type="application/problem+json", headers=headers
    )


class MatchCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str = Field(pattern=ID)
    match_id: str = Field(pattern=ID)
    roster: dict[str, Any]
    names: dict[str, str] = Field(default_factory=dict)
    clubs: dict[str, str] = Field(default_factory=dict)
    approval_mode: Literal["auto", "producer"] = "auto"
    hold_booth: bool = True  # with approval_mode producer: hold the booth voices for the producer
    seed_bad_claim: bool = False
    seed_bad_claim_at_ms: int = Field(default=720_000, ge=0)
    # descriptive fields from docs/architecture/12-api.md; stored with the match, not used by agents
    seed: int | None = None
    engine_version: str | None = None
    home_team_id: str | None = None
    away_team_id: str | None = None
    venue_id: str | None = None
    kickoff_local: str | None = None


class EventBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    events: list[dict[str, Any]] = Field(min_length=1, max_length=50)


class LineAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str = Field(pattern=ID)
    match_id: str = Field(pattern=ID)
    text: str | None = Field(default=None, min_length=1, max_length=280)
    reason: str | None = Field(default=None, max_length=200)


class FeedAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str = Field(pattern=ID)
    reason: str | None = Field(default=None, max_length=200)


class AskBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str = Field(pattern=ID)
    question: str = Field(min_length=1, max_length=300)
    persona: Literal["casual", "analyst", "broadcast"] = "casual"
    # ADR-0023: the feed languages, the same as LANGUAGES in matchcast_agents.translate
    lang: Literal["en", "es", "pt", "hi", "ar", "fr", "de", "id", "ja", "zh-Hans"] = "en"
    surface: Literal["ask", "broadcast"] = "ask"


class DrillBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str = Field(pattern=ID)
    model_cut: bool  # true cuts the match's model calls, false restores them


class ExportBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str = Field(pattern=ID)
    kind: Literal["claims_csv", "events_json"]
    verdict: Literal["verified", "rejected", "pending"] | None = None
    agent: str | None = None
    metric: str | None = None


class VisionIdentify(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str = Field(pattern=ID)
    crop: str = Field(min_length=1, max_length=60_000)  # base64 PNG, 128x128, at most 40 KB decoded
    track_id: str = Field(min_length=1, max_length=64)
    team_hint: Literal["home", "away"]


class DsAsk(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str = Field(pattern=ID)
    question: str = Field(min_length=1, max_length=300)


class TalkBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str = Field(pattern=ID)
    target: str = Field(pattern=ID)
    utterance: str = Field(min_length=1, max_length=300)
    position: str | None = Field(default=None, pattern=r"^[A-Z]{1,3}$")  # the sim's position code


class RecapTrigger(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tenant_id: str = Field(default=TENANT, pattern=ID)
    session_id: str = Field(pattern=ID)
    match_id: str = Field(pattern=ID)
    final: bool = False  # full time after extra time: write the recaps again over the first ones


class _LocalStatsDesk:
    """The Stats Desk skill called in-process; the mcp container serves the same over A2A."""

    transport = "in_process"

    def __init__(self, season: Season) -> None:
        self.season = season
        self._season = season

    async def compare(
        self, metric: str, scope: str, value: float, team_id: str | None = None
    ) -> dict[str, Any]:
        try:
            return await asyncio.to_thread(self._season.compare, metric, scope, value, team_id)
        except SeasonError as error:
            raise StatsDeskError(str(error)) from error


def _local_stats_desk() -> _LocalStatsDesk | None:
    try:
        return _LocalStatsDesk(Season())
    except Exception:  # noqa: BLE001 - no season Parquet in this image
        logging.getLogger(__name__).warning("season data missing; Stats Desk disabled")
        return None


def stats_desk_from_env(local: Any, env: Mapping[str, str] | None = None) -> Any:
    """The partner agent over A2A when ``STATS_DESK_URL`` is an https URL, else in process."""
    url = (os.environ if env is None else env).get("STATS_DESK_URL", "").strip()
    if not url:
        return local
    if not A2A_URL.match(url):
        logging.getLogger(__name__).warning(
            "STATS_DESK_URL must be https://<host>/a2a; using in process"
        )
        return local
    return A2AStatsDesk(url)


# the crew scoreboard, computed once per match, event count and run date (crew_scoreboard)
SCOREBOARD_CACHE_SIZE = 32
_SCOREBOARDS: dict[tuple[str, int, str], dict[str, Any]] = {}


class Registry:
    """Matches held by this single api replica (ADR-0005), keyed by session and match."""

    def __init__(self, require_role: bool) -> None:
        self.flows: dict[tuple[str, str], MatchWorkflow] = {}
        self.cuts: dict[tuple[str, str], ModelCut] = {}  # the failure drill's switch per match
        self.create_lock = asyncio.Lock()  # the stored-match check awaits, so creates take turns
        self.store = (
            build_store()
        )  # MATCHCAST_STORE=table|memory; one store for every match, so the MCP tools see them all
        self.require_role = require_role
        local = _local_stats_desk()
        self.stats_desk: Any = stats_desk_from_env(local)
        self._model_client: ModelClient | None = None
        self.asked: dict[str, deque[float]] = {}
        self.talked: dict[str, deque[float]] = {}
        self.ip_questions: dict[str, deque[float]] = {}
        # every model call asks a budget first (cost guard): match agents, and Ask/Talk answers
        self.budgets = {
            "agents": budget.ModelBudget(),
            "answers": budget.ModelBudget("MATCHCAST_ANSWER_CALLS_PER_DAY", budget.ANSWERS_PER_DAY),
        }
        self._budgeted: dict[str, budget.BudgetedModelClient] = {}
        self.new_matches = budget.HourlyWindows()
        self.exports: dict[str, tuple[bytes, str, str]] = {}
        self.season = local.season if local else None
        self.ds_asked: dict[str, deque[float]] = {}
        self.vision = VisionService()
        self.speech = SpeechTokenService()
        self.voice = VoiceService()  # Azure Speech synthesis, EXP-16 (docs/architecture/10)
        self.knowledge = TalkKnowledge.from_kb(
            kb_root()
        )  # squads and kb passages for talk (EXP-18)
        self.pipeline: Pipeline | None = None  # set by install() when MATCHCAST_PIPELINE says so
        self.translation = TranslationService()
        self.safety = safety_from_env()  # Azure Content Safety when CONTENT_SAFETY_ENDPOINT is set

    def allow_ask(self, session_id: str, now: float | None = None) -> bool:
        """At most ASK_PER_MINUTE questions per browser session per rolling minute."""
        return _within(self.asked, session_id, ASK_PER_MINUTE, now)

    def allow_talk(self, session_id: str, now: float | None = None) -> bool:
        """At most TALK_PER_MINUTE talks per browser session per rolling minute."""
        return _within(self.talked, session_id, TALK_PER_MINUTE, now)

    def allow_question(self, request: Request) -> None:
        """Asks and talks share per-address limits, so new session ids buy nothing."""
        ip = client_ip(request)
        if not _within(self.ip_questions, ip, ASK_PER_IP_MINUTE, None):
            detail = f"at most {ASK_PER_IP_MINUTE} questions a minute from one address"
            raise Problem(429, "rate_limited", detail, retry_after=60)
        if not self.new_matches.allow("q:" + ip, budget.QUESTIONS_PER_IP_HOUR):
            detail = f"at most {budget.QUESTIONS_PER_IP_HOUR} questions an hour from one address"
            raise Problem(429, "rate_limited", detail, retry_after=600)

    def live_allowed(self, request: Request) -> bool:
        """Whether a new match may run live; refuses only past the MATCHES_PER_HOUR memory guard.
        Rules matches cost no model call, so past the live allowances a match runs on the rules."""
        if self.new_matches.full("*", budget.MATCHES_PER_HOUR):
            raise Problem(429, "rate_limited", "too many new matches this hour", retry_after=600)
        return not (
            self.new_matches.full("live:*", budget.LIVE_MATCHES_PER_HOUR)
            or self.new_matches.full("live:" + client_ip(request), budget.LIVE_MATCHES_PER_IP_HOUR)
        )

    def count_new_match(self, request: Request, live: bool) -> None:
        """Only a match that was really created uses an allowance."""
        self.new_matches.add("*")
        if live:
            self.new_matches.add("live:*", "live:" + client_ip(request))

    def agents_for(
        self,
        personas: tuple[str, ...],
        *,
        live: bool = True,
        cut: ModelCut | None = None,
        **seed: Any,
    ) -> AgentSet:
        """Live agents when MATCHCAST_AGENT_MODE=live and a model client exists, else rules.
        A match's cut (the failure drill) sits in front of its model calls only."""
        client = self.model_client() if live else None
        tool_call = self.tool_call()
        if client is None:
            return rules_agents(personas, tool_call=tool_call, **seed)
        if cut is not None:
            client = cut.guard(client)
        return live_agents(client, personas, tool_call=tool_call, **seed)

    def answers_for(self, live: bool, cut: ModelCut) -> ModelClient | None:
        """Ask and Talk answer on the model when live; the failure drill cuts them too."""
        client = self.model_client("answers") if live else None
        return cut.guard(client) if client is not None else None

    def tool_call(self) -> ToolCall | None:
        """With MATCHCAST_TOOLS=mcp the Analyst calls the MCP tools in memory, against this
        process's store. A separate `mcp` container needs the shared store first (DAT-2)."""
        if os.environ.get("MATCHCAST_TOOLS") != "mcp":
            return None
        server = create_server(self.store)

        async def call(tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
            async with Client(server) as client:
                result = await client.call_tool(tool, arguments)
            if result.is_error or result.structured_content is None:
                raise RuntimeError(f"{tool} returned an error")
            return result.structured_content

        return call

    def model_client(self, pool: str = "agents") -> ModelClient | None:
        """The model behind a daily budget; None (rules) when live is off or switched off."""
        if self._model_client is None and os.environ.get("MATCHCAST_AGENT_MODE") == "live":
            try:
                self._model_client = FoundryModelClient()
            except Exception:  # noqa: BLE001 - no endpoint, SDK or credential: stay on rules
                logging.getLogger(__name__).warning("live mode requested; using rules agents")
        client = self._model_client
        if client is None or budget.model_off():
            return None
        wrapped = self._budgeted.get(pool)
        if wrapped is None or wrapped.inner is not client:
            wrapped = self._budgeted[pool] = self.budgets[pool].wrap(client)
        return wrapped

    def allow_ds(self, client: str, now: float | None = None) -> bool:
        """At most DS_PER_MINUTE Data Scientist questions per client per rolling minute."""
        now = time.monotonic() if now is None else now
        for key in [k for k, w in self.ds_asked.items() if not w or now - w[-1] >= 60]:
            del self.ds_asked[key]
        window = self.ds_asked.setdefault(client, deque())
        while window and now - window[0] >= 60:
            window.popleft()
        if len(window) >= DS_PER_MINUTE:
            return False
        window.append(now)
        return True

    def vision_feed_for(
        self, session_id: str, match_id: str
    ) -> Callable[[], list[dict[str, Any]]] | None:
        """An engine match's Vision passes, as pass facts, from the store: its one Vision moment
        counts them beside its own (ADR-0022). None for a Vision stream."""
        if is_vision_stream({"session_id": session_id}):
            return None
        vision = {
            "tenant_id": TENANT,
            "session_id": f"{session_id}.vision",
            "match_id": match_id,
        }
        sk = stream_key(vision)
        return lambda: pass_facts(self.store.events(sk))

    def spawn_budgets_for(self, session_id: str, match_id: str) -> MatchSpawnBudgets | None:
        """A Vision stream draws on its engine match's specialist pools, so the caps hold per match.
        The pools live on the engine workflow: they last as long as its flow (CREW-2.1)."""
        if not is_vision_stream({"session_id": session_id}):
            return None
        engine = self.flows.get((engine_stream_of(session_id), match_id))
        return engine.spawn_budgets if engine is not None else None

    def truth_feed_for(
        self, session_id: str, match_id: str
    ) -> Callable[[], list[dict[str, Any]]] | None:
        """A Vision stream's truth: the engine match's own events, from the store (ADR-0022)."""
        if not is_vision_stream({"session_id": session_id}):
            return None
        engine = {
            "tenant_id": TENANT,
            "session_id": engine_stream_of(session_id),
            "match_id": match_id,
        }
        sk = stream_key(engine)
        return lambda: self.store.events(sk)

    async def flow_for(self, session_id: str, match_id: str) -> MatchWorkflow:
        """The workflow of a match, rebuilt from its stored roster after a restart (F1)."""
        key = (session_id, match_id)
        if (flow := self.flows.get(key)) is not None:
            return flow
        stream = {"tenant_id": TENANT, "session_id": session_id, "match_id": match_id}
        sk = stream_key(stream)
        # one point read decides whether the match exists, so an unknown id costs no hydrate and
        # no time under the lock (every stream retry for an id that is not there lands here)
        if await asyncio.to_thread(self.store.get_match, sk) is None:
            raise Problem(404, "not_found", f"unknown match {match_id}")
        if is_vision_stream({"session_id": session_id}):
            # its Verifier reads the engine's events from the store, so the engine match comes first
            await self.flow_for(engine_stream_of(session_id), match_id)
        async with self.create_lock:
            if (flow := self.flows.get(key)) is not None:
                return flow

            def stored() -> dict[str, Any] | None:
                _is_stored(self.store, sk)  # hydrates a buffered store off the event loop
                return self.store.get_match(sk)

            info = await asyncio.to_thread(stored)
            if info is None:
                raise Problem(404, "not_found", f"unknown match {match_id}")
            config = WorkflowConfig(
                approval_mode=info.get("approval_mode", "auto"),
                hold_booth=bool(info.get("hold_booth", True)),
            )
            live = info.get("live", True)  # a match past the live allowance stays on the rules
            seeds: dict[str, Any] = {}
            # the seeded wrong claim fires once; a match rebuilt past its cue has already had it
            cue = info.get("seed_bad_claim_at_ms", 720_000)
            state = self.store.get_state(sk)
            unfired = state.revision == 0 or state.event_time_ms < cue
            if info.get("seed_bad_claim") and unfired:
                seeds = {
                    "seed_bad_claim": True,
                    "seed_bad_claim_at_ms": cue,
                }
            cut = self.cuts.setdefault(key, ModelCut(on=bool(info.get("model_cut", False))))
            flow = MatchWorkflow(
                stream=stream,
                roster=info["roster"],
                names=info.get("names", {}),
                clubs=info.get("clubs", {}),
                agents=self.agents_for(config.personas, live=live, cut=cut, **seeds),
                config=config,
                store=self.store,
                stats_desk=self.stats_desk,
                safety=self.safety,
                # Ask and talk answer on the model when live
                answer_model=self.answers_for(live, cut),
                knowledge=self.knowledge,
                truth_feed=self.truth_feed_for(session_id, match_id),
                vision_feed=self.vision_feed_for(session_id, match_id),
                spawn_budgets=self.spawn_budgets_for(session_id, match_id),
            )
            if is_vision_stream({"session_id": session_id}):
                # a Vision match created after a desk kill must not air from the killed feed
                flow.killed_feeds |= await asyncio.to_thread(
                    _engine_kills, self.store, session_id, match_id
                )
            self.flows[key] = flow
            return flow

    def get(self, session_id: str, match_id: str) -> MatchWorkflow:
        flow = self.flows.get((session_id, match_id))
        if flow is None:
            raise Problem(404, "not_found", f"unknown match {match_id}")
        return flow


def _bare_ip(entry: str) -> str | None:
    """The address in a forwarded entry, without a port; None when it is not an address."""
    if entry.startswith("["):  # [v6]:port
        entry = entry[1:].split("]", 1)[0]
    elif entry.count(":") == 1:  # v4:port
        entry = entry.split(":", 1)[0]
    try:
        return str(ipaddress.ip_address(entry))
    except ValueError:
        return None


def _within(
    windows: dict[str, deque[float]], session_id: str, limit: int, now: float | None
) -> bool:
    """A rolling one-minute window per session: False when the session has used its ``limit``."""
    now = time.monotonic() if now is None else now
    for key in [k for k, w in windows.items() if not w or now - w[-1] >= 60]:
        del windows[key]  # idle sessions leave no entry behind
    window = windows.setdefault(session_id, deque())
    while window and now - window[0] >= 60:
        window.popleft()
    if len(window) >= limit:
        return False
    window.append(now)
    return True


def client_ip(request: Request) -> str:
    """The address rate limits key on.

    Behind the Container Apps ingress (``MATCHCAST_BEHIND_INGRESS=true``, set by Bicep) the socket
    peer is the ingress, so the client is the rightmost ``X-Forwarded-For`` entry, the one the
    ingress appended; entries to its left come from the caller and can be forged. Anywhere else
    the header is ignored.
    """
    if os.environ.get("MATCHCAST_BEHIND_INGRESS", "").strip().lower() == "true":
        entries = [e.strip() for e in request.headers.get("x-forwarded-for", "").split(",")]
        if (entry := next((e for e in reversed(entries) if e), "")) and (ip := _bare_ip(entry)):
            return ip
    return request.client.host if request.client else "local"


def wanted_on_stream(item: StreamEvent, keep: tuple[str, ...]) -> bool:
    """Whether a viewer reading the personas in `keep` gets this event (empty keep: all of them).

    Publications belong to the persona they were written for. Line records and derived feed
    records (onair, feed_drop) stay on every stream: the desk monitor counts the six feeds from
    whichever lens is open, and it reads them by feed key (AB#499)."""
    if not keep:
        return True
    if item.event == "publication":
        return item.data["persona"] in keep
    return True


def _engine_kills(store: Any, vision_session: str, match_id: str) -> set[str]:
    """The desk's feed kills on a Vision session's engine match, from its audit chain (AB#499)."""
    engine = {
        "tenant_id": TENANT,
        "session_id": engine_stream_of(vision_session),
        "match_id": match_id,
    }
    return feed_kills_in(store, stream_key(engine))


def _is_stored(store: Any, sk: str) -> bool:
    hydrate = getattr(store, "hydrate", None)
    if hydrate is not None:
        hydrate(sk)
    return store.get_match(sk) is not None


def _line_json(line: LineRecord) -> dict[str, Any]:
    return public_line(line)


def _claim_verdict(lines: list[LineRecord], claim_id: str) -> str:
    states = [ln.status for ln in lines if claim_id in ln.claim_ids]
    if any(s in ("verified", "approved", "published") for s in states):
        return "verified"
    if any(s in ("rejected", "abstained", "killed") for s in states):
        return "rejected"
    return "pending"


def _claim_rows(
    flow: MatchWorkflow, verdict: str | None, agent: str | None, metric: str | None
) -> list[dict[str, Any]]:
    rows = []
    lines = list(flow.store.lines(flow.sk))  # read once: a durable store scans a partition per call
    for row in flow.store.claims(flow.sk):
        packet = row["packet"]
        item = {**packet, "agent": row["agent"], "moment_id": row["moment_id"],
                "verdict": _claim_verdict(lines, packet["claim_id"])}  # fmt: skip
        if (verdict and item["verdict"] != verdict) or (agent and item["agent"] != agent):
            continue
        if metric and item["metric"] != metric:
            continue
        rows.append(item)
    return rows


CSV_COLUMNS = (
    "claim_id", "metric", "value", "units", "derivation_version", "verdict", "agent",
    "moment_id", "max_evidence_sequence",
)  # fmt: skip


def _claims_csv(rows: list[dict[str, Any]]) -> bytes:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    for row in rows:
        writer.writerow([row[c] for c in CSV_COLUMNS])
    return out.getvalue().encode()


def _state_json(flow: MatchWorkflow) -> dict[str, Any]:
    state = flow.store.get_state(flow.sk)
    return {
        "score": state.score,
        "clock_ms": state.event_time_ms,
        "period": state.period,
        "possession": state.possession,
        "revision": state.revision,
    }


def _names(flow: MatchWorkflow) -> list[str]:
    """Player and club names the Translator must leave alone and the re-check must find."""
    return [*flow.names.values(), *flow.clubs.values()]


CLIP_HEADERS = {"Cache-Control": "private, max-age=600"}
ON_AIR = ("approved", "published")  # the lines a viewer can hear


async def _audio(request: Request, registry: Registry, text: str, voice_name: str) -> Response:
    """A clip from the cache, or made now: a new clip is rate limited per client address."""
    return await _audio_parts(request, registry, [text], voice_name)


def pack(sentences: list[str], limit: int = MAX_CHARS - 100) -> list[str]:
    """Sentences joined into the fewest clip-sized parts; empty or over-long ones are skipped."""
    parts: list[str] = []
    for sentence in sentences:
        if not sentence or len(sentence) > limit:
            continue  # never cut a checked sentence: what is spoken is what was verified
        if parts and len(parts[-1]) + 1 + len(sentence) <= limit:
            parts[-1] += " " + sentence
        else:
            parts.append(sentence)
    return parts


MAX_PARTS = 6  # a recap voiced in more clips than this is not read aloud


async def _audio_parts(
    request: Request, registry: Registry, texts: list[str], voice_name: str
) -> Response:
    """One mp3 from several clips (frames join end to end); each new clip uses an allowance."""
    voice = registry.voice
    if len(texts) > MAX_PARTS:
        raise Problem(503, "not_ready", "this text is too long to read aloud")
    for text in texts:
        if voice.get(clip_key(text, voice_name)) is None and not voice.allow(client_ip(request)):
            raise Problem(
                429,
                "rate_limited",
                f"at most {VOICE_PER_MINUTE} new voice clips a minute",
                retry_after=60,
            )
    try:
        audio = b"".join([await voice.clip(t, voice_name) for t in texts])
    except VoiceError as error:
        raise Problem(503, "not_ready", str(error)) from error
    return Response(audio, media_type="audio/mpeg", headers=CLIP_HEADERS)


def build_router(registry: Registry) -> APIRouter:
    router = APIRouter(prefix="/v1", tags=["matches"])

    def need_producer(role: str | None) -> None:
        if registry.require_role and role not in PRODUCER_ROLES:
            raise Problem(403, "forbidden_role", "this route needs the Producer or Admin role")

    @router.post("/matches", status_code=201)
    async def create_match(
        body: MatchCreate,
        request: Request,
        x_matchcast_seed_bad_claim: str | None = Header(default=None),
    ) -> dict[str, Any]:
        live = registry.live_allowed(request)  # past the allowances a match runs on the rules
        async with registry.create_lock:
            key = (body.session_id, body.match_id)
            if key in registry.flows:
                raise Problem(409, "match_exists", "match already exists")
            stream = {"tenant_id": TENANT, "session_id": body.session_id, "match_id": body.match_id}
            # A match an earlier process stored is not started again over its rows (07 §11).
            # The store reads Table Storage, so it runs off the event loop.
            if await asyncio.to_thread(_is_stored, registry.store, stream_key(stream)):
                raise Problem(
                    409, "match_exists", "match already exists in the store; use a new id"
                )
            if body.roster.get("stream") != stream:
                raise Problem(
                    422, "contract_invalid", "roster stream must match this match", "/roster/stream"
                )
            config = WorkflowConfig(approval_mode=body.approval_mode, hold_booth=body.hold_booth)
            cut = ModelCut()
            players = body.roster.get("players")
            teams = body.roster.get("team_ids")
            try:
                names = {p["player_id"]: pretty(p["player_id"]) for p in players or []} | body.names
                clubs = {team: pretty(team) for team in teams or []} | body.clubs
                flow = MatchWorkflow(
                    stream=stream,
                    roster=body.roster,
                    names=names,
                    clubs=clubs,
                    agents=registry.agents_for(
                        config.personas,
                        live=live,
                        cut=cut,
                        seed_bad_claim=body.seed_bad_claim or x_matchcast_seed_bad_claim == "1",
                        seed_bad_claim_at_ms=body.seed_bad_claim_at_ms,
                    ),
                    config=config,
                    store=registry.store,
                    stats_desk=registry.stats_desk,
                    safety=registry.safety,
                    answer_model=registry.answers_for(live, cut),
                    knowledge=registry.knowledge,
                    truth_feed=registry.truth_feed_for(stream["session_id"], stream["match_id"]),
                    vision_feed=registry.vision_feed_for(stream["session_id"], stream["match_id"]),
                    spawn_budgets=registry.spawn_budgets_for(
                        stream["session_id"], stream["match_id"]
                    ),
                )
            except (ContractError, TypeError, KeyError) as error:
                raise Problem(
                    422, "contract_invalid", str(error), getattr(error, "path", "/roster")
                ) from error
            if is_vision_stream(stream):  # the Vision match is created after the desk's kills
                flow.killed_feeds |= _engine_kills(
                    registry.store, stream["session_id"], stream["match_id"]
                )
            registry.flows[key] = flow
            registry.cuts[key] = cut
            registry.count_new_match(request, live)
            # what a rebuilt match needs to behave as this one does after a restart
            seed = body.seed_bad_claim or x_matchcast_seed_bad_claim == "1"
            registry.store.put_match(
                flow.sk,
                {
                    **(registry.store.get_match(flow.sk) or {}),
                    "approval_mode": body.approval_mode,
                    "hold_booth": body.hold_booth,
                    "live": live,
                    "seed_bad_claim": seed,
                    "seed_bad_claim_at_ms": body.seed_bad_claim_at_ms,
                    "model_cut": cut.on,  # a drill that landed first is not overwritten
                },
            )
        return {"stream": stream, "approval_mode": body.approval_mode, "mode": flow.agents.mode}

    @router.get("/matches/{match_id}")
    async def get_match(match_id: str, session_id: str) -> dict[str, Any]:
        flow = await registry.flow_for(session_id, match_id)
        return {"stream": flow.stream, "state": _state_json(flow), "stats": flow.stats,
                "mode": flow.agents.mode, "approval_mode": flow.config.approval_mode}  # fmt: skip

    @router.post("/matches/{match_id}/drill")
    async def failure_drill(match_id: str, body: DrillBody) -> dict[str, Any]:
        """The failure drill: cut or restore one match's model calls. While cut, each model call
        fails at once and the rules twin answers; every refusal is audited as fallback_used."""
        flow = await registry.flow_for(body.session_id, match_id)
        cut = registry.cuts.setdefault((body.session_id, match_id), ModelCut())
        cut.on = body.model_cut
        sk = flow.sk

        def persist() -> None:
            registry.store.put_match(
                sk, {**(registry.store.get_match(sk) or {}), "model_cut": cut.on}
            )

        await asyncio.to_thread(persist)
        return {"model_cut": cut.on, "mode": flow.agents.mode}

    @router.post("/matches/{match_id}/events", status_code=202)
    async def post_events(match_id: str, session_id: str, body: EventBatch) -> dict[str, int]:
        flow = await registry.flow_for(session_id, match_id)
        try:
            if registry.pipeline is None:
                return await flow.ingest(body.events)
            # Through the event stream (F1 rule 2): publish before acknowledging.
            flow.validate_batch(body.events)
        except ContractError as error:
            index = getattr(error, "index", 0)
            code = error.code if error.code == "roster_required" else "contract_invalid"
            raise Problem(
                422, code, str(error), f"/events/{index}{error.path}".rstrip("/")
            ) from error
        try:
            await registry.pipeline.publish(flow.sk, body.events)
        except Exception as error:  # noqa: BLE001 - any transport failure: the browser retries
            logging.getLogger(__name__).exception("publish to the event stream failed")
            raise Problem(
                503, "publish_failed", "the event stream did not accept the batch; send it again"
            ) from error
        return {
            "accepted": len(body.events),
            "last_sequence": max(e["stream_sequence"] for e in body.events),
        }

    @router.get("/matches/{match_id}/vision/summary")
    async def vision_summary(match_id: str, session_id: str) -> dict[str, Any]:
        """What Vision contributes to the agents on this match (ADR-0022): passes in, the lines the
        Verifier passed on them, the latest such line, and agreement with the engine's passes.
        ``ready`` is false until the match and its Vision stream exist; the page polls this before
        a match starts, so that is an answer, not an error."""
        try:
            await registry.flow_for(session_id, match_id)  # the engine match must exist
            vision = await registry.flow_for(f"{session_id}.vision", match_id)
        except Problem:  # no engine match yet, or no Vision has been sent for this match
            return {
                "ready": False,
                "passes_in": 0,
                "lines_verified": 0,
                "latest_line": None,
                "agreement": agreement([], []),
            }
        return {"ready": True, **vision.vision_summary()}

    @router.get("/matches/{match_id}/stream")
    async def stream(
        match_id: str,
        session_id: str,
        persona: str | None = None,
        lang: str = "en",
        follow: bool = True,
        last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    ) -> StreamingResponse:
        flow = await registry.flow_for(session_id, match_id)
        if lang not in LANGUAGES:
            raise Problem(
                422, "contract_invalid", "lang must be one of the feed languages", "/lang"
            )
        keep: tuple[str, ...] = ()  # the personas this viewer reads; empty means every one
        if persona and booth(persona):  # both voices of the commentary booth, in one stream
            keep = BOOTH
        elif persona:
            persona = normalise(persona, flow.clubs, flow.names)
            if persona is None:
                raise Problem(422, "contract_invalid", "unknown persona for this match")
            keep = (persona,)
        if keep and not flow.add_personas(keep):  # a watch mode gets lines from the next moment on
            raise Problem(429, "rate_limited", "this match already has the most watch modes")

        def wanted(item: StreamEvent) -> bool:
            return wanted_on_stream(item, keep)

        async def localised(item: StreamEvent) -> StreamEvent:
            """The publication with a checked `variants[lang]`, or untouched (English)."""
            if item.event != "publication":
                return item
            data = item.data
            if (
                lang == "en"
            ):  # the line's voice route; it makes the clip only when a viewer plays it
                if not registry.voice.ready:
                    return item
                line_id = data["publication_id"].removeprefix("pub-")
                path = f"/v1/matches/{match_id}/lines/{line_id}/audio.mp3"
                url = f"{path}?{urlencode({'session_id': session_id})}"
                return StreamEvent(item.event, item.id, {**data, "audio_url": url})
            pub_id = data["publication_id"]
            variant = await registry.translation.variant(
                f"{session_id}/{match_id}",
                pub_id,
                data["text"],
                lang,
                _names(flow),
                lambda reason: flow.record_translation_rejected(pub_id, lang, reason),
            )
            if variant.text is None:
                return item
            return StreamEvent(item.event, item.id, {**data, "variants": {lang: variant.text}})

        async def body() -> AsyncIterator[str]:
            yield StreamEvent("status", None, {"status": flow.status}).encode()
            yield StreamEvent("state", None, _state_json(flow)).encode()
            replay = [e for e in flow.hub.replay_after(last_event_id) if wanted(e)]
            if not follow:
                for item in replay:
                    yield (await localised(item)).encode()
                return
            source = flow.hub.subscribe(replay).__aiter__()
            while True:
                try:
                    item = await asyncio.wait_for(source.__anext__(), HEARTBEAT_S)
                except TimeoutError:
                    yield StreamEvent("heartbeat", None, {"time": _now()}).encode()
                    continue
                if wanted(item):
                    yield (await localised(item)).encode()

        return StreamingResponse(
            body(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @router.get("/matches/{match_id}/claims")
    async def claims(
        match_id: str,
        session_id: str,
        verdict: Literal["verified", "rejected", "pending"] | None = None,
        agent: str | None = None,
        metric: str | None = None,
        limit: int = Query(100, ge=1, le=500),
        cursor: int = Query(0, ge=0),
    ) -> dict[str, Any]:
        flow = await registry.flow_for(session_id, match_id)
        rows = _claim_rows(flow, verdict, agent, metric)
        page = rows[cursor : cursor + limit]
        more = cursor + limit < len(rows)
        return {"items": page, "next_cursor": cursor + limit if more else None}

    @router.get("/matches/{match_id}/booth")
    async def booth_status(match_id: str, session_id: str) -> dict[str, Any]:
        """Register the commentary booth for this match, or say plainly why it is not available,
        so the client can fall back to the rules booth instead of waiting on a stream that 429s."""
        flow = await registry.flow_for(session_id, match_id)
        ready = flow.add_personas(BOOTH)
        return {
            "ready": ready,
            "personas": list(BOOTH),
            "reason": None if ready else "watch_mode_cap",
            "mode": flow.agents.mode,  # live (model) or rules (stock reading)
            "held": flow.config.hold_booth and flow.config.approval_mode == "producer",
        }

    @router.get("/matches/{match_id}/lines")
    async def lines(
        match_id: str,
        session_id: str,
        status: str | None = None,
        x_matchcast_role: str | None = Depends(caller_role),
    ) -> dict[str, Any]:
        need_producer(x_matchcast_role)
        flow = await registry.flow_for(session_id, match_id)
        rows = [ln for ln in flow.store.lines(flow.sk) if status in (None, ln.status)]
        return {"items": [_line_json(ln) for ln in rows]}

    async def act(
        line_id: str,
        body: LineAction,
        role: str | None,
        action: str,
        actor: tuple[str, str | None] = ("producer", None),
    ) -> dict[str, Any]:
        need_producer(role)
        actor_id, actor_name = actor
        flow = await registry.flow_for(body.session_id, body.match_id)
        try:
            if action == "approve":
                line = await flow.approve(line_id, actor_id, actor_name)
                return {"line": _line_json(line)}
            if action == "kill":
                line = await flow.kill(
                    line_id, body.reason or "killed by producer", actor_id, actor_name
                )
                return {"line": _line_json(line)}
            if body.text is None:
                raise Problem(422, "contract_invalid", "text is required", "/text")
            line, verdict = await flow.edit(line_id, body.text, actor_id, actor_name)
        except WorkflowError as error:
            raise Problem(STATUS[error.code], error.code, str(error)) from error
        if verdict.verdict == "rejected":
            raise Problem(422, "contract_invalid", f"edit rejected: {verdict.reason_code}", "/text")
        return {"line": _line_json(line), "verdict": verdict.model_dump()}

    @router.post("/lines/{line_id}/approve")
    async def approve(
        line_id: str,
        body: LineAction,
        x_matchcast_role: str | None = Depends(caller_role),
        actor: tuple[str, str | None] = Depends(caller_actor),
    ) -> dict[str, Any]:
        return await act(line_id, body, x_matchcast_role, "approve", actor)

    @router.post("/lines/{line_id}/edit")
    async def edit(
        line_id: str,
        body: LineAction,
        x_matchcast_role: str | None = Depends(caller_role),
        actor: tuple[str, str | None] = Depends(caller_actor),
    ) -> dict[str, Any]:
        return await act(line_id, body, x_matchcast_role, "edit", actor)

    @router.post("/lines/{line_id}/kill")
    async def kill(
        line_id: str,
        body: LineAction,
        x_matchcast_role: str | None = Depends(caller_role),
        actor: tuple[str, str | None] = Depends(caller_actor),
    ) -> dict[str, Any]:
        return await act(line_id, body, x_matchcast_role, "kill", actor)

    async def feed_switch(
        match_id: str,
        feed: str,
        body: FeedAction,
        role: str | None,
        actor: tuple[str, str | None],
        killed: bool,
    ) -> dict[str, Any]:
        """The desk's per-feed kill or resume (AB#499). Audited now; the air gate reads it later."""
        need_producer(role)
        if feed not in FEED_KEYS:
            raise Problem(422, "contract_invalid", f"unknown feed {feed}", "/feed")
        flow = await registry.flow_for(body.session_id, match_id)
        reason = body.reason or ("killed on desk" if killed else "resumed")
        record = await flow.set_feed(feed, killed, reason, actor[0], actor[1])
        if not is_vision_stream({"session_id": body.session_id}):
            # the Vision session is its own workflow and its analyst lines air too: the kill
            # reaches it, so a Vision pass cannot air from a feed the desk has killed
            try:
                vision = await registry.flow_for(f"{body.session_id}.vision", match_id)
            except Problem:  # no Vision match was ever created: nothing from it can air
                vision = None
            if vision is not None:
                await vision.set_feed(feed, killed, reason, actor[0], actor[1])
        return {
            "feed": feed,
            "state": "killed" if killed else "live",
            "audit_id": record["audit_id"],
            "enforced": True,
        }

    @router.post("/matches/{match_id}/feeds/{feed}/kill")
    async def feed_kill(
        match_id: str,
        feed: str,
        body: FeedAction,
        x_matchcast_role: str | None = Depends(caller_role),
        actor: tuple[str, str | None] = Depends(caller_actor),
    ) -> dict[str, Any]:
        return await feed_switch(match_id, feed, body, x_matchcast_role, actor, killed=True)

    @router.post("/matches/{match_id}/feeds/{feed}/resume")
    async def feed_resume(
        match_id: str,
        feed: str,
        body: FeedAction,
        x_matchcast_role: str | None = Depends(caller_role),
        actor: tuple[str, str | None] = Depends(caller_actor),
    ) -> dict[str, Any]:
        return await feed_switch(match_id, feed, body, x_matchcast_role, actor, killed=False)

    @router.get("/matches/{match_id}/audit")
    async def audit(
        match_id: str,
        session_id: str,
        from_seq: int = Query(1, ge=1),
        limit: int = Query(1000, ge=1, le=1000),
    ) -> dict[str, Any]:
        flow = await registry.flow_for(session_id, match_id)
        return {"items": flow.store.audit_records(flow.sk, from_seq, limit)}

    @router.get("/matches/{match_id}/scoreboard")
    async def crew_scoreboard(match_id: str, session_id: str) -> dict[str, Any]:
        """The three-arm crew scoreboard for this match (CREW-5.2). The rules arms run on the
        stored events, cached per match, event count and run date. When a recorded live run of
        the fixture is set (MATCHCAST_SCOREBOARD_LIVE_RUN), it is shown beside them under
        ``recorded``: as the same events when its digest matches this match, else as a benchmark
        on the fixture, labelled not this match. The route never calls a model."""
        flow = await registry.flow_for(session_id, match_id)
        events = flow.store.events(flow.sk)
        run_date = datetime.now(UTC).date().isoformat()
        key = (flow.sk, len(events), run_date)
        board = _SCOREBOARDS.get(key)
        if board is None:
            match = {
                "events": events,
                "roster": flow.roster,
                "names": flow.names,
                "teams": flow.clubs,
            }
            board = await asyncio.to_thread(scoreboard, match, run_date=run_date)
            if len(_SCOREBOARDS) >= SCOREBOARD_CACHE_SIZE:
                _SCOREBOARDS.pop(next(iter(_SCOREBOARDS)))  # the oldest one out
            _SCOREBOARDS[key] = board
        live_path = os.environ.get("MATCHCAST_SCOREBOARD_LIVE_RUN", "")
        recorded = (
            load_live_run(live_path, teams=sorted(flow.clubs.values())) if live_path else None
        )
        if recorded is None:
            return board
        same = recorded["events_sha256"] == events_digest(events)
        if same:
            label = (
                f"Recorded live run {recorded['run_id']}, {recorded['run_date']}, "
                "same events as this match"
            )
        else:
            label = (
                f"Recorded live benchmark: {recorded['fixture']}, seed {recorded['seed']}, "
                f"{recorded['run_date']}, not this match"
            )
        view = {
            "run_id": recorded["run_id"],
            "fixture": recorded["fixture"],
            "run_date": recorded["run_date"],
            "seed": recorded["seed"],
            "same_events": same,
            "label": label,
            "arms": recorded["arms"],
        }
        return {**board, "recorded": view}

    @router.get("/matches/{match_id}/trace/{line_id}")
    async def trace(match_id: str, line_id: str, session_id: str) -> dict[str, Any]:
        flow = await registry.flow_for(session_id, match_id)
        line = flow.store.get_line(flow.sk, line_id)
        if line is None:
            raise Problem(404, "not_found", f"unknown line {line_id}")
        subjects = {line_id, *line.claim_ids}
        steps = [
            {"sequence": r["sequence"], "time": r["time"], "actor": r["actor_id"],
             "action": r["action"], "mode": r["details"].get("mode"), "details": r["details"]}
            for r in flow.store.audit_records(flow.sk)
            if r["subject_id"] in subjects
        ]  # fmt: skip
        return {"line": _line_json(line), "steps": steps}

    @router.post("/matches/{match_id}/exports", status_code=201)
    async def create_export(
        match_id: str, body: ExportBody, _role: str | None = Depends(caller_role)
    ) -> dict[str, Any]:
        """A hash-stamped export of the claims ledger or the event log (7 days in Blob later)."""
        flow = await registry.flow_for(body.session_id, match_id)
        if body.kind == "claims_csv":
            rows = _claim_rows(flow, body.verdict, body.agent, body.metric)
            payload, media, ext = _claims_csv(rows), "text/csv", "csv"
        else:
            rows = flow.store.events(flow.sk)
            payload, media, ext = json.dumps(rows, indent=1).encode(), "application/json", "json"
        sha = hashlib.sha256(payload).hexdigest()
        export_id = f"{body.kind}-{sha[:12]}"
        registry.exports[export_id] = (payload, media, f"{match_id}.{ext}")
        flow.record_export(export_id, body.kind, sha, len(rows))
        return {"export_id": export_id, "url": f"/v1/exports/{export_id}", "sha256": sha,
                "rows": len(rows)}  # fmt: skip

    @router.get("/exports/{export_id}")
    async def get_export(export_id: str) -> Response:
        found = registry.exports.get(export_id)
        if found is None:
            raise Problem(404, "not_found", f"unknown export {export_id}")
        payload, media, filename = found
        return Response(
            payload, media_type=media,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )  # fmt: skip

    @router.post("/matches/{match_id}/vision/identify")
    async def vision_identify(
        match_id: str, body: VisionIdentify, request: Request
    ) -> dict[str, Any]:
        """Second opinion on a shirt number from a torso crop (DAT-11); budgeted, never stored."""
        await registry.flow_for(body.session_id, match_id)
        try:
            return await asyncio.to_thread(registry.vision.identify, body.crop)
        except VisionError as error:
            raise Problem(
                error.status, error.code, error.detail, retry_after=error.retry_after
            ) from error

    @router.get("/speech/token")
    async def speech_token(request: Request) -> dict[str, Any]:
        """A short-lived Entra token for the browser's Speech SDK; never a key (EXP-16)."""
        speech = registry.speech
        if not speech.ready:
            raise Problem(503, "not_ready", "no Speech resource is configured")
        if not speech.allow(client_ip(request)):
            raise Problem(
                429, "rate_limited", f"at most {SPEECH_PER_MINUTE} tokens a minute", retry_after=60
            )
        try:
            return await asyncio.to_thread(speech.issue)
        except SpeechError as error:
            raise Problem(503, "not_ready", str(error)) from error

    @router.post("/ds/ask")
    async def ds_ask(body: DsAsk, request: Request) -> dict[str, Any]:
        """Data Scientist: a season question, answered from one verified SELECT (F10)."""
        if registry.season is None:
            raise Problem(503, "not_ready", "the season data is not loaded")
        if not registry.allow_ds(client_ip(request)):
            raise Problem(
                429, "rate_limited", f"at most {DS_PER_MINUTE} questions a minute", retry_after=60
            )
        try:
            result = await asyncio.to_thread(ds_ask_season, body.question, registry.season)
        except SeasonError as error:
            raise Problem(400, "invalid_query", str(error)) from error
        stream = {"tenant_id": TENANT, "session_id": body.session_id, "match_id": "season"}
        registry.store.append_audit(
            stream_key(stream), stream=stream, actor_kind="agent", actor_id="data-scientist",
            action="ds_answered" if result.verdict == "verified" else "ds_unverified",
            subject_id="ds-ask",
            details={"verdict": result.verdict, "sql": result.sql, "mismatch": result.mismatch},
            time=_now(),
        )  # fmt: skip
        return {
            "answer": result.answer,
            "verdict": result.verdict,
            "sql": result.sql,
            "columns": result.columns,
            "rows": result.rows,
            "chart_spec": result.chart_spec,
        }

    @router.post("/matches/{match_id}/talk")
    async def talk(match_id: str, body: TalkBody, request: Request) -> dict[str, Any]:
        flow = await registry.flow_for(body.session_id, match_id)
        if not registry.allow_talk(body.session_id):
            raise Problem(
                429, "rate_limited", f"at most {TALK_PER_MINUTE} talks a minute", retry_after=60
            )
        registry.allow_question(request)
        try:
            result = await flow.talk(body.target, body.utterance, position=body.position)
        except WorkflowError as error:
            raise Problem(STATUS[error.code], error.code, str(error)) from error
        result["lang"] = "en"
        result["audio_url"] = None
        voice = registry.voice
        if result["verdict"] == "verified" and voice.ready:  # only a checked reply is spoken
            role = "producer" if body.target == "producer" else "player"
            voice_name = voice.voice_for(role, body.target)
            key = clip_key(result["reply"], voice_name)
            # A new clip uses the caller's voice allowance; once spent, the reply is shown unspoken.
            if voice.get(key) is not None or voice.allow(client_ip(request)):
                try:
                    await voice.clip(result["reply"], voice_name)
                    result["audio_url"] = f"/v1/audio/{key}.mp3"
                except VoiceError:
                    pass  # the reply is still shown, just not spoken
        return result

    @router.websocket("/matches/{match_id}/call")
    async def call(websocket: WebSocket, match_id: str) -> None:
        """The voice call (EXP-18): talks and their spoken replies over one socket, both ways."""
        session_id = websocket.query_params.get("session_id", "")
        if not re.fullmatch(ID, session_id):
            await websocket.close(code=1008)
            return
        try:
            flow = await registry.flow_for(session_id, match_id)
        except Problem:
            await websocket.close(code=1008)
            return
        await websocket.accept()
        voice = registry.voice
        ip = client_ip(websocket)

        async def talk(target: str, utterance: str, position: str | None) -> dict[str, Any]:
            try:  # the talk route's own limits, so a turn never reaches the model unchecked
                TalkBody(
                    session_id=session_id, target=target, utterance=utterance, position=position
                )
            except ValidationError as error:
                raise Problem(
                    422,
                    "bad_frame",
                    "a talk needs a player, 1 to 300 characters, and a position code",
                ) from error
            registry.allow_question(websocket)  # a turn counts as a question, as in the talk route
            try:
                result = await flow.talk(target, utterance, position=position)
            except WorkflowError as error:
                raise Problem(STATUS[error.code], error.code, str(error)) from error
            result["lang"] = "en"
            return result

        async def speak(sentence: str, voice_name: str) -> bytes | None:
            if not voice.ready:
                return None
            # a new clip uses the caller's voice allowance; once spent, the reply is written only
            if voice.get(clip_key(sentence, voice_name)) is None and not voice.allow(ip):
                return None
            try:
                return await voice.clip(sentence, voice_name)
            except VoiceError:
                return None

        await CallSocket(
            websocket,
            talk=talk,
            speak=speak,
            voice_for=voice.voice_for,
            allow_talk=lambda: registry.allow_talk(session_id),
        ).serve()

    @router.get("/voice/audition.mp3")
    async def audition(request: Request) -> Response:
        return await _audio(
            request, registry, AUDITION_SCRIPT, registry.voice.voice_for("commentary")
        )

    @router.get("/audio/{audio_id}.mp3")
    async def audio_by_id(audio_id: str) -> Response:
        audio = await registry.voice.fetch(audio_id)
        if audio is None:
            raise Problem(404, "not_found", "no clip with that id")
        return Response(audio, media_type="audio/mpeg", headers=CLIP_HEADERS)

    @router.get("/matches/{match_id}/lines/{line_id}/audio.mp3")
    async def line_audio(
        match_id: str, line_id: str, session_id: str, request: Request
    ) -> Response:
        flow = await registry.flow_for(session_id, match_id)
        line = next(
            (
                ln
                for ln in flow.store.lines(flow.sk)
                if ln.line_id == line_id and ln.status in ON_AIR
            ),
            None,
        )
        words = speakable(line.text) if line else ""
        if not words:
            raise Problem(404, "not_found", "no line on air with that id")
        return await _audio(request, registry, words, registry.voice.voice_for("commentary"))

    @router.get("/matches/{match_id}/recap/{persona}")
    async def get_recap(match_id: str, persona: str, session_id: str) -> dict[str, Any]:
        flow = await registry.flow_for(session_id, match_id)
        recap = flow.store.get_recap(flow.sk, ALIASES.get(persona, persona))
        if recap is None:
            raise Problem(404, "not_found", f"the {persona} recap is not ready")
        return recap

    @router.get("/matches/{match_id}/recap/{persona}/audio.mp3")
    async def recap_audio(
        match_id: str, persona: str, session_id: str, request: Request
    ) -> Response:
        """The stored recap read aloud: only sentences the Verifier marked verified are spoken."""
        flow = await registry.flow_for(session_id, match_id)
        recap = flow.store.get_recap(flow.sk, ALIASES.get(persona, persona))
        rows = recap["sentences"] if recap else []
        parts = pack([speakable(r["text"]) for r in rows if r["verdict"] == "verified"])
        if not parts:
            raise Problem(404, "not_found", f"the {persona} recap is not ready")
        return await _audio_parts(request, registry, parts, registry.voice.voice_for("commentary"))

    @router.post("/matches/{match_id}/ask")
    async def ask(match_id: str, body: AskBody, request: Request) -> dict[str, Any]:
        flow = await registry.flow_for(body.session_id, match_id)
        if not registry.allow_ask(body.session_id):
            raise Problem(
                429, "rate_limited", f"at most {ASK_PER_MINUTE} questions a minute", retry_after=60
            )
        registry.allow_question(request)
        try:
            result = await flow.ask(body.question, body.persona, surface=body.surface)
        except WorkflowError as error:
            raise Problem(STATUS[error.code], error.code, str(error)) from error
        reply: dict[str, Any] = {
            "answer": result.answer,
            "intent": result.intent,
            "abstained": result.abstained,
            "citations": result.citations,
            "mode": result.mode,
            "retrieval": result.retrieval,
            "lang": "en",
        }
        if result.broadcast is not None:  # the Broadcast Copilot's picks: highlights, focus or plan
            reply["broadcast"] = result.broadcast
        # the Broadcast picks stay English: the desk never reads variants, so no translation call
        if body.lang != "en" and not result.abstained and result.broadcast is None:
            key = "ask-" + hashlib.sha256(result.answer.encode()).hexdigest()[:12]
            variant = await registry.translation.variant(
                f"{body.session_id}/{match_id}",
                key,
                result.answer,
                body.lang,
                _names(flow),
                lambda reason: flow.record_translation_rejected(key, body.lang, reason),
            )
            if variant.text is not None:
                reply["variants"] = {body.lang: variant.text}
        return reply

    return router


def build_internal_router(registry: Registry) -> APIRouter:
    router = APIRouter(prefix="/internal/v1", tags=["internal"])

    @router.post("/recaps", status_code=202)
    async def create_recaps(
        body: RecapTrigger, role: str | None = Depends(caller_role)
    ) -> dict[str, Any]:
        """Called by fn-recap at full time; the api runs the recap workflow (F8)."""
        if registry.require_role and role not in PRODUCER_ROLES:
            raise Problem(403, "forbidden_role", "this route needs the recap function identity")
        flow = await registry.flow_for(body.session_id, body.match_id)
        try:
            recaps = await flow.recap(force=body.final)
        except WorkflowError as error:
            raise Problem(503, error.code, str(error)) from error
        return {"match_id": body.match_id, "personas": sorted(recaps)}

    return router


def _now() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def install(app: FastAPI, registry: Registry | None = None) -> Registry:
    """Mount the match routes and the problem handler on ``app``."""
    registry = registry or Registry(os.environ.get("MATCHCAST_REQUIRE_ROLE") == "1")
    app.state.matches = registry
    registry.pipeline = Pipeline.build(registry)

    @app.exception_handler(Problem)
    async def problem_handler(_request: Request, error: Problem) -> JSONResponse:
        return problem_response(error)

    @app.middleware("http")
    async def vision_body_limit(request: Request, call_next: Any) -> Any:
        """The vision route is anonymous: refuse an oversize body before it is buffered."""
        size = request.headers.get("content-length", "0")
        if request.url.path.endswith("/vision/identify") and (
            not size.isdigit() or int(size) > VISION_MAX_BODY
        ):
            return problem_response(Problem(413, "crop_too_large", "request body is too large"))
        return await call_next(request)

    @app.exception_handler(404)
    async def unknown_path(_request: Request, _error: Exception) -> JSONResponse:
        return problem_response(Problem(404, "not_found", "no such path"))

    app.include_router(build_router(registry))
    app.include_router(build_internal_router(registry))
    if os.environ.get("MATCHCAST_MCP_MOUNT") != "0":
        _mount_mcp(app, registry)
    if registry.pipeline is not None:
        _run_pipeline(app, registry.pipeline)
    return registry


def _run_pipeline(app: FastAPI, pipeline: Pipeline) -> None:
    """Start the event stream consumer with the app and stop it with the app (ADR-0005)."""
    outer = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        async with outer(application), pipeline.running():
            yield

    app.router.lifespan_context = lifespan


def _mount_mcp(app: FastAPI, registry: Registry) -> None:
    """Serve the MCP tools at /mcp from this process: the matches live in its memory (ADR-0005).

    The separate `mcp` container takes over when a shared store exists (DAT-2).
    """
    mcp_app = build_app(registry.store)
    outer = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        async with outer(application), mcp_app.router.lifespan_context(mcp_app):
            yield

    app.router.lifespan_context = lifespan
    taken = {getattr(r, "path", None) for r in app.router.routes}
    # only the MCP paths join the api (A2A stays on the mcp container, which is not public), so
    # unknown paths still return Problem JSON
    app.router.routes.extend(
        r
        for r in mcp_app.router.routes
        if getattr(r, "path", None) not in taken and str(getattr(r, "path", "")).startswith("/mcp")
    )
