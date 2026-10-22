"""Match routes: events in, SSE and claims, lines and audit out (docs/architecture/12-api.md)."""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Literal

from fastapi import APIRouter, Depends, FastAPI, Header, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents.hub import StreamEvent
from matchcast_agents.messages import LineRecord
from matchcast_agents.statsdesk import StatsDeskError
from matchcast_agents.store import MemoryStore
from matchcast_agents.workflow import WorkflowError
from matchcast_contracts import ContractError
from matchcast_mcp.app import build_app
from matchcast_mcp.season import Season, SeasonError
from pydantic import BaseModel, ConfigDict, Field

from app.auth import PRODUCER_ROLES, caller_role

TENANT = "demo"
HEARTBEAT_S = 15
ID = r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
PERSONA_ALIASES = {"fan": "casual", "producer": "broadcast"}
STATUS = {
    "not_found": 404,
    "match_exists": 409,
    "forbidden_role": 403,
    "not_approvable": 409,
    "prompt_attack": 400,
}


def pretty(identifier: str) -> str:
    """'harbour-united' -> 'Harbour United': display text when the client sends no names."""
    return " ".join(part.capitalize() for part in identifier.replace("_", "-").split("-") if part)


class Problem(Exception):
    """Rendered as RFC 9457 application/problem+json."""

    def __init__(self, status: int, code: str, detail: str, path: str | None = None):
        self.status, self.code, self.detail, self.path = status, code, detail, path


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
    return JSONResponse(body, status_code=error.status, media_type="application/problem+json")


class MatchCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str = Field(pattern=ID)
    match_id: str = Field(pattern=ID)
    roster: dict[str, Any]
    names: dict[str, str] = Field(default_factory=dict)
    clubs: dict[str, str] = Field(default_factory=dict)
    approval_mode: Literal["auto", "producer"] = "auto"
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


class RecapTrigger(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tenant_id: str = Field(default=TENANT, pattern=ID)
    session_id: str = Field(pattern=ID)
    match_id: str = Field(pattern=ID)


class _LocalStatsDesk:
    """The Stats Desk skill called in-process; the mcp container serves the same over A2A."""

    def __init__(self, season: Season) -> None:
        self._season = season

    async def compare(
        self, metric: str, scope: str, value: float, team_id: str | None = None
    ) -> dict[str, Any]:
        try:
            return self._season.compare(metric, scope, value, team_id)
        except SeasonError as error:
            raise StatsDeskError(str(error)) from error


def _local_stats_desk() -> _LocalStatsDesk | None:
    try:
        return _LocalStatsDesk(Season())
    except Exception:  # noqa: BLE001 - no season Parquet in this image
        return None


class Registry:
    """Matches held by this single api replica (ADR-0005), keyed by session and match."""

    def __init__(self, require_role: bool) -> None:
        self.flows: dict[tuple[str, str], MatchWorkflow] = {}
        self.store = MemoryStore()  # one store for every match, so the MCP tools see them all
        self.require_role = require_role
        self.stats_desk = _local_stats_desk()

    def get(self, session_id: str, match_id: str) -> MatchWorkflow:
        flow = self.flows.get((session_id, match_id))
        if flow is None:
            raise Problem(404, "not_found", f"unknown match {match_id}")
        return flow


def _line_json(line: LineRecord) -> dict[str, Any]:
    return line.model_dump()


def _claim_verdict(flow: MatchWorkflow, claim_id: str) -> str:
    states = [ln.status for ln in flow.store.lines(flow.sk) if claim_id in ln.claim_ids]
    if any(s in ("verified", "approved", "published") for s in states):
        return "verified"
    if any(s in ("rejected", "abstained", "killed") for s in states):
        return "rejected"
    return "pending"


def _state_json(flow: MatchWorkflow) -> dict[str, Any]:
    state = flow.store.get_state(flow.sk)
    return {
        "score": state.score,
        "clock_ms": state.event_time_ms,
        "period": state.period,
        "possession": state.possession,
        "revision": state.revision,
    }


def build_router(registry: Registry) -> APIRouter:
    router = APIRouter(prefix="/v1", tags=["matches"])

    def need_producer(role: str | None) -> None:
        if registry.require_role and role not in PRODUCER_ROLES:
            raise Problem(403, "forbidden_role", "this route needs the Producer or Admin role")

    @router.post("/matches", status_code=201)
    async def create_match(
        body: MatchCreate,
        x_matchcast_seed_bad_claim: str | None = Header(default=None),
    ) -> dict[str, Any]:
        key = (body.session_id, body.match_id)
        if key in registry.flows:
            raise Problem(409, "match_exists", "match already exists")
        stream = {"tenant_id": TENANT, "session_id": body.session_id, "match_id": body.match_id}
        if body.roster.get("stream") != stream:
            raise Problem(
                422, "contract_invalid", "roster stream must match this match", "/roster/stream"
            )
        config = WorkflowConfig(approval_mode=body.approval_mode)
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
                agents=rules_agents(
                    config.personas,
                    seed_bad_claim=body.seed_bad_claim or x_matchcast_seed_bad_claim == "1",
                    seed_bad_claim_at_ms=body.seed_bad_claim_at_ms,
                ),
                config=config,
                store=registry.store,
                stats_desk=registry.stats_desk,
            )
        except (ContractError, TypeError, KeyError) as error:
            raise Problem(
                422, "contract_invalid", str(error), getattr(error, "path", "/roster")
            ) from error
        registry.flows[key] = flow
        return {"stream": stream, "approval_mode": body.approval_mode, "mode": flow.agents.mode}

    @router.get("/matches/{match_id}")
    async def get_match(match_id: str, session_id: str) -> dict[str, Any]:
        flow = registry.get(session_id, match_id)
        return {"stream": flow.stream, "state": _state_json(flow), "stats": flow.stats,
                "mode": flow.agents.mode, "approval_mode": flow.config.approval_mode}  # fmt: skip

    @router.post("/matches/{match_id}/events", status_code=202)
    async def post_events(match_id: str, session_id: str, body: EventBatch) -> dict[str, int]:
        flow = registry.get(session_id, match_id)
        try:
            return await flow.ingest(body.events)
        except ContractError as error:
            index = getattr(error, "index", 0)
            code = error.code if error.code == "roster_required" else "contract_invalid"
            raise Problem(
                422, code, str(error), f"/events/{index}{error.path}".rstrip("/")
            ) from error

    @router.get("/matches/{match_id}/stream")
    async def stream(
        match_id: str,
        session_id: str,
        persona: str | None = None,
        lang: str = "en",
        follow: bool = True,
        last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    ) -> StreamingResponse:
        flow = registry.get(session_id, match_id)
        persona = PERSONA_ALIASES.get(persona or "", persona)

        def wanted(item: StreamEvent) -> bool:
            return not (item.event == "publication" and persona and item.data["persona"] != persona)

        async def body() -> AsyncIterator[str]:
            yield StreamEvent("status", None, {"status": flow.status}).encode()
            yield StreamEvent("state", None, _state_json(flow)).encode()
            replay = [e for e in flow.hub.replay_after(last_event_id) if wanted(e)]
            if not follow:
                for item in replay:
                    yield item.encode()
                return
            source = flow.hub.subscribe(replay).__aiter__()
            while True:
                try:
                    item = await asyncio.wait_for(source.__anext__(), HEARTBEAT_S)
                except TimeoutError:
                    yield StreamEvent("heartbeat", None, {"time": _now()}).encode()
                    continue
                if wanted(item):
                    yield item.encode()

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
        flow = registry.get(session_id, match_id)
        rows = []
        for row in flow.store.claims(flow.sk):
            packet = row["packet"]
            item = {**packet, "agent": row["agent"], "moment_id": row["moment_id"],
                    "verdict": _claim_verdict(flow, packet["claim_id"])}  # fmt: skip
            if (verdict and item["verdict"] != verdict) or (agent and item["agent"] != agent):
                continue
            if metric and item["metric"] != metric:
                continue
            rows.append(item)
        page = rows[cursor : cursor + limit]
        more = cursor + limit < len(rows)
        return {"items": page, "next_cursor": cursor + limit if more else None}

    @router.get("/matches/{match_id}/lines")
    async def lines(
        match_id: str,
        session_id: str,
        status: str | None = None,
        x_matchcast_role: str | None = Depends(caller_role),
    ) -> dict[str, Any]:
        need_producer(x_matchcast_role)
        flow = registry.get(session_id, match_id)
        rows = [ln for ln in flow.store.lines(flow.sk) if status in (None, ln.status)]
        return {"items": [_line_json(ln) for ln in rows]}

    async def act(line_id: str, body: LineAction, role: str | None, action: str) -> dict[str, Any]:
        need_producer(role)
        flow = registry.get(body.session_id, body.match_id)
        try:
            if action == "approve":
                line = await flow.approve(line_id)
                return {"line": _line_json(line)}
            if action == "kill":
                line = await flow.kill(line_id, body.reason or "killed by producer")
                return {"line": _line_json(line)}
            if body.text is None:
                raise Problem(422, "contract_invalid", "text is required", "/text")
            line, verdict = await flow.edit(line_id, body.text)
        except WorkflowError as error:
            raise Problem(STATUS[error.code], error.code, str(error)) from error
        if verdict.verdict == "rejected":
            raise Problem(422, "contract_invalid", f"edit rejected: {verdict.reason_code}", "/text")
        return {"line": _line_json(line), "verdict": verdict.model_dump()}

    @router.post("/lines/{line_id}/approve")
    async def approve(
        line_id: str, body: LineAction, x_matchcast_role: str | None = Depends(caller_role)
    ) -> dict[str, Any]:
        return await act(line_id, body, x_matchcast_role, "approve")

    @router.post("/lines/{line_id}/edit")
    async def edit(
        line_id: str, body: LineAction, x_matchcast_role: str | None = Depends(caller_role)
    ) -> dict[str, Any]:
        return await act(line_id, body, x_matchcast_role, "edit")

    @router.post("/lines/{line_id}/kill")
    async def kill(
        line_id: str, body: LineAction, x_matchcast_role: str | None = Depends(caller_role)
    ) -> dict[str, Any]:
        return await act(line_id, body, x_matchcast_role, "kill")

    @router.get("/matches/{match_id}/audit")
    async def audit(
        match_id: str,
        session_id: str,
        from_seq: int = Query(1, ge=1),
        limit: int = Query(1000, ge=1, le=1000),
    ) -> dict[str, Any]:
        flow = registry.get(session_id, match_id)
        return {"items": flow.store.audit_records(flow.sk, from_seq, limit)}

    @router.get("/matches/{match_id}/trace/{line_id}")
    async def trace(match_id: str, line_id: str, session_id: str) -> dict[str, Any]:
        flow = registry.get(session_id, match_id)
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

    @router.get("/matches/{match_id}/recap/{persona}")
    async def get_recap(match_id: str, persona: str, session_id: str) -> dict[str, Any]:
        flow = registry.get(session_id, match_id)
        recap = flow.store.get_recap(flow.sk, PERSONA_ALIASES.get(persona, persona))
        if recap is None:
            raise Problem(404, "not_found", f"the {persona} recap is not ready")
        return recap

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
        flow = registry.get(body.session_id, body.match_id)
        try:
            recaps = await flow.recap()
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

    @app.exception_handler(Problem)
    async def problem_handler(_request: Request, error: Problem) -> JSONResponse:
        return problem_response(error)

    app.include_router(build_router(registry))
    app.include_router(build_internal_router(registry))
    if os.environ.get("MATCHCAST_MCP_MOUNT") != "0":
        _mount_mcp(app, registry)
    return registry


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
    app.mount("/", mcp_app)
