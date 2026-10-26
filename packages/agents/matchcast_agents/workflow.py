"""The match workflow: Producer, Analyst, Narrator, Verifier, repair, approval, publication.

One ``MatchWorkflow`` serves one stream. Executors are async so live (Foundry) agents can
replace the rules twins through ``AgentSet`` without changing this graph. Every step appends
a hash-chained audit record (ADR-0013: lines carry verdicts and approvals).
"""

import asyncio
import copy
import logging
import os
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING, Any, Protocol

from matchcast_contracts import ContractError, validate
from opentelemetry import trace

from . import catch_me_up
from . import half_time as half_time_mod
from . import recap as recap_mod
from .context import MatchContext
from .feed_lines import ticker_drafts
from .feeds import (
    TICKER_PERSONA,
    drops_on_failed_repair,
    feed_for,
    waits_for_producer,
)
from .history import history_for_roster
from .hub import StreamHub
from .memory import storylines
from .messages import Check, DraftLine, LineRecord, Persona, ProducerTask, Skip, Verdict
from .personas import BOOTH, MAX_WATCH_MODES, known
from .rules import AnalystRules, NarratorRules, ProducerRules, VerifierRules
from .rules.analyst import ClaimResult
from .rules.producer import BOOTH_MOMENTS
from .safety import LocalSafetyScreen, SafetyScreen
from .season_clubs import season_code
from .specialists import SpawnBudget, default_registry, plan_spawns, run_all
from .stall import StallClock
from .state import MatchState, apply
from .statsdesk import TEAM_METRICS, StatsDesk, StatsDeskError
from .store import MemoryStore, Store, stream_key
from .storyline import FALLBACK_PLAN, StorylineBook, pick_plan
from .tools import InProcessTools, ToolCall, ToolError
from .verify.checks import recompute
from .verify.text import extract_numbers
from .vision import agreement, is_vision_stream, pass_facts, vision_value

if TYPE_CHECKING:
    from .live.client import ModelClient
    from .live.knowledge import TalkKnowledge

STATS_DESK_BUDGET_S = 2.0
# the template feeds a live match airs. The audio description is written (feed_lines.py) but not
# aired: a later booth line can land inside it, so it waits for the speak-time check (Planned)
LIVE_FEED_LINES = ("ticker",)
MINUTE_MENTION = re.compile(r"\bminute\s+(\d{1,3})\b", re.IGNORECASE)  # "minute 12": a log minute

TALK_PHRASES = {
    "shots on target": "shots_on_target", "shots": "shots", "goals": "goals",
    "tackles won": "tackles_won", "fouls": "fouls", "cards": "cards",
}  # fmt: skip
TALK_RE = re.compile(r"(\d+) (shots on target|shots|goals|tackles won|fouls|cards)\b")
AUDIT_SKIPPED = ("rate_limited", "duplicate_moment", "model_skip")


WITHHELD = "[withheld: refused by Content Safety]"
UNCHECKED = "[awaiting checks]"
NOT_SHOWN = "[not shown: did not pass its checks]"
PASSED = ("verified", "approved", "published")  # Verifier and Content Safety have both passed


def public_line(line: LineRecord, *, stream: bool = False) -> dict[str, Any]:
    """The line as it may be read. The text of a line Content Safety refused is always withheld.
    On the open stream (`stream=True`) text goes out only once the line passed the Verifier and
    Content Safety; the role-gated producer routes also show a rejected or escalated line so a
    person can decide, but never one still awaiting its checks. The store keeps every text for
    the audit chain; status, reason and ids always stay."""
    out = line.model_dump()
    if line.reason_code == "unsafe_content":
        out["text"] = WITHHELD
    elif line.status in ("drafted", "verifying"):
        out["text"] = UNCHECKED
    elif stream and line.status not in PASSED:
        out["text"] = NOT_SHOWN
    if out["text"] in (WITHHELD, UNCHECKED, NOT_SHOWN):
        for check in out["checks"]:  # a model-written reason can quote the line it judged
            if check["name"] == "meaning" or check["name"].startswith("adversary"):
                check["detail"] = ""
    return out


def repair_feedback(draft: DraftLine, verdict: Verdict) -> str:
    """What to tell the Narrator on its one redraft, in words: no figure from the failed check
    (a limit or a number named there would be echoed into the line)."""
    said = {
        "persona": f"the {draft.persona} line was too long or had too many numbers: shorten it",
        "numbers": "a number lacked a claim or was repeated: use the claim values, each once",
        "names": "a name was not in the roster or not on the team in this moment",
        "sources": "a claim was not usable",
        "specific": "the colour line must name a player or club",
    }
    parts = [
        said.get(c.name, "the line was not supported by the claims")
        for c in verdict.checks
        if not c.passed
    ]
    return "; ".join(dict.fromkeys(parts))


NUMBER_OR_SOURCE = ("number_mismatch", "unknown_source", "stale_state")
# a booth line that fails its repair on one of these goes to the producer queue: the event log can
# settle it. The six derived feeds that fail are dropped from air instead (CREW-4.3).
ESCALATED_CODES = ("number_mismatch", "unknown_player", "unknown_source", "stale_state")
# the rundown ledger keeps this many moments (it is checkpointed with the match)
RUNDOWN_KEEP = 400
# how often the stall timer looks at the clock: a silent feed replans too, not only on an event
STALL_CHECK_S = 5.0
# the final period: its ended boundary is full time, and the stall timer stops there
FULL_TIME_PERIOD = 2
logger = logging.getLogger(__name__)


def _event_key(event: dict[str, Any]) -> tuple[str, int]:
    """Which revision of an event: a corrected revision keeps its event id and sequence."""
    return event["event_id"], int(event.get("revision", 0))


# the contract version of the crew frames (crew_ledger, crew_spawn); the audit stays on 1.1.0
CREW_SCHEMA_VERSION = "1.3.0"
# a specialist's report status, as the crew_spawn frame names it
SPAWN_STATUS = {
    "ok": "done",
    "no_data": "no_data",
    "budget_exhausted": "budget_exhausted",
    "failed": "failed",
}
# the specialist a replan assigns to its new storyline: it replays the moments of that storyline
REPLAN_SPECIALIST = "replay"
# the agents a moment's rundown entry records as called (the producer decides, it is not routed)
ROUTED_AGENTS = ("analyst", "narrator", "verifier")
# the specialists the Showrunner may spawn, in the order the planner prefers them (CREW-2.1)
SPAWN_POOL = ("replay", "tactics", "stats", "rhythm", "history")
QUIET_SPAWNS_PER_MATCH = 40  # the quiet moments' own allowance, apart from the priority-1 pool


@dataclass
class MatchSpawnBudgets:
    """The specialist pools of one match. Every workflow that runs the match (its engine stream and
    its Vision stream) draws on the same two pools, so the caps hold per match, not per stream."""

    priority_one: SpawnBudget = field(default_factory=SpawnBudget)
    quiet: SpawnBudget = field(default_factory=lambda: SpawnBudget(QUIET_SPAWNS_PER_MATCH))


def feed_kills_in(store: Any, sk: str) -> set[str]:
    """The derived feeds the desk has killed on a match, replayed from its audit chain (AB#499).

    A kill is audited before it takes effect, so this is the kill state a restart rebuilds, and
    a Vision session reads its engine match's kills the same way when it is created."""
    killed: set[str] = set()
    sequence = 1
    while True:
        rows = store.audit_records(sk, from_sequence=sequence, limit=500)
        if not rows:
            return killed
        for row in rows:
            if row["action"] == "feed_killed":
                killed.add(row["subject_id"])
            elif row["action"] == "feed_resumed":
                killed.discard(row["subject_id"])
        sequence = rows[-1]["sequence"] + 1


class WorkflowError(Exception):
    """A request the workflow refuses; ``code`` maps to an RFC 9457 problem code."""

    def __init__(self, code: str, detail: str):
        self.code = code
        super().__init__(detail)


class Producer(Protocol):
    async def decide(self, ctx: MatchContext, event: dict[str, Any]) -> ProducerTask | Skip: ...


class Analyst(Protocol):
    async def analyse(
        self, ctx: MatchContext, task: ProducerTask, *, repair: bool = False
    ) -> list[ClaimResult]: ...


class Narrator(Protocol):
    async def write(
        self,
        ctx: MatchContext,
        task: ProducerTask,
        claims: list[dict[str, Any]],
        *,
        attempt: int = 0,
        feedback: str = "",
    ) -> list[DraftLine]: ...


class Verifier(Protocol):
    async def check(
        self, ctx: MatchContext, line: DraftLine, claims: list[dict[str, Any]]
    ) -> Verdict: ...


@dataclass
class AgentSet:
    producer: Producer
    analyst: Analyst
    narrator: Narrator
    verifier: Verifier

    @property
    def mode(self) -> str:
        modes = {
            getattr(a, "mode", "live")
            for a in (self.producer, self.analyst, self.narrator, self.verifier)
        }
        return modes.pop() if len(modes) == 1 else "mixed"


def rules_agents(
    personas: tuple[Persona, ...] = ("casual", "analyst"),
    *,
    seed_bad_claim: bool = False,
    seed_bad_claim_at_ms: int = 720_000,
    failing_tools: frozenset[str] = frozenset(),
    tool_call: ToolCall | None = None,
) -> AgentSet:
    return AgentSet(
        ProducerRules(personas),
        AnalystRules(
            corrupt_first_claim=seed_bad_claim,
            failing_tools=failing_tools,
            corrupt_after_ms=seed_bad_claim_at_ms,
            tool_call=tool_call,
        ),
        NarratorRules(),
        VerifierRules(),
    )


@dataclass
class WorkflowConfig:
    approval_mode: str = "auto"  # auto | producer
    hold_booth: bool = True  # producer mode holds the booth voices for a person (25 Oct decision)
    publication_ttl_s: int = 30
    personas: tuple[Persona, ...] = ("casual", "analyst")
    # the engine clock at which the one Vision moment is due (ADR-0022); 0 turns it off
    vision_moment_ms: int = 900_000
    # the template feeds aired on this match: () by default; the match service turns on
    # LIVE_FEED_LINES (AB#471), so the library and its evals keep their lines as they were
    feed_lines: tuple[str, ...] = ()
    # af (Microsoft Agent Framework workflow graph, the default) | native (plain calls)
    orchestrator: str = field(
        default_factory=lambda: os.environ.get("MATCHCAST_ORCHESTRATOR", "af")
    )
    extra: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.orchestrator not in ("af", "native"):
            raise ValueError(
                f"MATCHCAST_ORCHESTRATOR must be af or native, not {self.orchestrator!r}"
            )


_TRACER = trace.get_tracer("matchcast.agents")


def _annotate(span: Any, method: str, result: Any) -> None:
    """Attach the verdict or claim ids to the agent span so a claim ID finds its trace (PLT-8)."""
    verdict = getattr(result, "verdict", None)
    if method == "check" and verdict:
        span.set_attribute("matchcast.verdict", verdict)
        reason = getattr(result, "reason_code", None)
        if reason:
            span.set_attribute("matchcast.reason_code", reason)
    if method == "analyse" and isinstance(result, list | tuple):
        ids = [c.packet.get("claim_id") for c in result if hasattr(c, "packet")]
        ids = [i for i in ids if i]
        if ids:
            span.set_attribute("matchcast.claim_ids", ids)


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _repair_link(repair_of: str | None) -> dict[str, str]:
    """The audit details that name the line a repair replaces; empty for a first attempt."""
    return {"repair_of": repair_of} if repair_of else {}


# Producer free text the Verifier has not checked. It stays in the stored audit, and is never
# published to the live stream (issue #382).
MODEL_TEXT_DETAILS = frozenset({"why"})


def _live_details(details: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in details.items() if k not in MODEL_TEXT_DETAILS}


def _counted_events(events: Any, minute: int) -> tuple[dict[str, Any], ...]:
    """The stored events a recap at a minute counts from. A retraction counts only if its event
    time is at or before that minute: a later one does not change the recap."""
    retracted = {
        e["payload"]["target_event_id"]
        for e in events
        if e["payload"]["type"] == "retraction" and e["event_time_ms"] <= minute * 60_000
    }
    return tuple(e for e in events if e["event_id"] not in retracted)


def _sentence_recounts(
    events: tuple[dict[str, Any], ...],
    piece: catch_me_up.CatchMeUp,
    home: str,
    sentence: str,
    metrics: tuple[str, ...],
) -> bool:
    """A sentence with figures has them in the order of its metrics, each the recount of that
    metric. A sentence with no figure (a named event) has nothing to recount."""
    figures = extract_numbers(sentence)
    expected = [float(recompute(events, m, piece.cut_sequence, home=home)) for m in metrics]
    return not figures or figures == expected


class MatchWorkflow:
    def __init__(
        self,
        *,
        stream: dict[str, str],
        roster: dict[str, Any],
        names: dict[str, str] | None = None,
        clubs: dict[str, str] | None = None,
        store: Store | None = None,
        hub: StreamHub | None = None,
        agents: AgentSet | None = None,
        config: WorkflowConfig | None = None,
        safety: SafetyScreen | None = None,
        clock: Callable[[], datetime] = _utc_now,
        stall_clock: Callable[[], float] = time.monotonic,
        stats_desk: StatsDesk | None = None,
        answer_model: "ModelClient | None" = None,
        history: dict[str, Any] | None = None,
        knowledge: "TalkKnowledge | None" = None,
        truth_feed: Callable[[], list[dict[str, Any]]] | None = None,
        vision_feed: Callable[[], list[dict[str, Any]]] | None = None,
        spawn_budgets: MatchSpawnBudgets | None = None,
    ) -> None:
        from .live.answers import LiveAnswers  # lazy: the live package imports this module

        self.stats_desk = stats_desk
        # a Vision stream reads the engine match's events here, to check them (ADR-0022)
        self._truth_feed = truth_feed
        # the engine match's Vision passes as pass facts: its one Vision moment counts them
        self._vision_feed = vision_feed
        self._vision_moment_tried = False
        # wall time since the last verified line; it starts with the first event
        self._stall = StallClock(clock=stall_clock)
        self._stall_started = False
        self._stall_task: asyncio.Task[None] | None = None  # the timer; it pauses at full time
        self._closed = False
        self._replans = 0  # numbers the replan moments, so two replans never share an id
        self._processed_key: tuple[str, int] | None = None  # (event id, revision) last finished
        self._plan: str | None = None  # the last storyline the stall replan chose
        self._book = StorylineBook()  # the storylines a replan opened, each waiting for its payoff
        self._vision_lines = 0
        self._latest_vision_line: str | None = None
        self._answers = LiveAnswers(answer_model) if answer_model is not None else None
        self._knowledge = knowledge  # squads and the knowledge base for talk (EXP-18)
        self._verified_claims: dict[str, dict[str, Any]] = {}
        self._repair_lock = asyncio.Lock()
        self._redrafts: dict[tuple[str, str], tuple[MatchContext, list[dict], list[DraftLine]]] = {}
        self.stream = stream
        self.sk = stream_key(stream)
        self.roster = validate(roster)
        self.store = store or MemoryStore()
        # a rebuild without names or clubs keeps the ones stored at creation, never blanks them
        stored = self.store.get_match(self.sk) or {}
        self.names = {**stored.get("names", {}), **(names or {})}
        self.clubs = {**stored.get("clubs", {}), **(clubs or {})}
        # real pre-match facts for national teams (ADR-0020); None for fictional clubs
        # the history cut-off is the day the match was created, so a rebuild keeps the same facts
        self.history_on = (
            date.fromisoformat(stored["history_on"]) if stored.get("history_on") else clock().date()
        )
        self.history = (
            history
            if history is not None
            else history_for_roster(self.roster.get("team_ids"), self.clubs, self.history_on)
        )
        self.hub = hub or StreamHub()
        self.config = config or WorkflowConfig()
        self.agents = agents or rules_agents(self.config.personas)
        self._clock = clock
        self.safety = safety or LocalSafetyScreen()
        self.status = "rules_fallback" if self.agents.mode == "rules" else "live"
        self._fallback_reason: str | None = None
        self._lock = asyncio.Lock()
        self.extra_personas: list[str] = []
        self.store.put_match(  # keeps what the api stored at creation (approval mode, demo seed)
            self.sk,
            {
                **(self.store.get_match(self.sk) or {}),
                "roster": self.roster,
                "names": self.names,
                "clubs": self.clubs,
                "history_on": self.history_on.isoformat(),
            },
        )
        self.rundown: list[dict[str, Any]] = []  # the Showrunner ledger, see _record_rundown
        self._routing: dict[str, Any] | None = None  # the entry of the moment being run
        self._at_ms = 0  # the event time of the event being run, for the crew frames
        # the match's cost guard for specialists, in two pools: quiet moments cannot use up
        # a goal's specialists. The pools are the match's; this workflow's share of them is
        # checkpointed, so a restart adds back exactly what this workflow spent
        pools = spawn_budgets or MatchSpawnBudgets()
        self.spawn_budgets = pools  # the engine stream's pools are handed to its Vision stream
        self.spawn_budget = pools.priority_one  # priority-1 moments
        self.quiet_budget = pools.quiet  # every other moment
        self._spent = {"priority_one": 0, "quiet": 0}  # what this workflow took from each pool
        self._saved_once = False  # this workflow has written a checkpoint of its own
        self._specialists = default_registry()
        self._restore()
        self.killed_feeds: set[str] = set()  # the desk's per-feed kills, from the audit chain
        self._restore_feed_state()
        self.stats = {
            "events": 0,
            "moments": 0,
            "skipped": 0,
            "claims": 0,
            "lines": 0,
            "verified": 0,
            "repaired": 0,
            "abstained": 0,
            "escalated": 0,
            "published": 0,
        }

    # ---- helpers -----------------------------------------------------------------------

    def _ctx(self) -> MatchContext:
        ctx = MatchContext(
            stream=self.stream,
            roster=self.roster,
            names=self.names,
            clubs=self.clubs,
            state=self.store.get_state(self.sk),
            events=tuple(self.store.events(self.sk)),
            personas=self.config.personas,
            truth=tuple(self._truth_feed()) if self._truth_feed else (),
            extra={
                **(
                    {"history": self.history, "history_on": self.history_on.isoformat()}
                    if self.history
                    else {}
                ),
                **({"vision_passes": self._vision_feed} if self._vision_feed else {}),
            },
        )
        if all(p in (*self.config.personas, *self.extra_personas) for p in BOOTH):
            ctx.extra["booth"] = (
                True  # kick-off and quiet-spell moments only when a viewer has the booth
            )
        memory = storylines(ctx, list(self.store.lines(self.sk)))
        if memory:
            ctx.extra["storylines"] = memory
        return ctx

    def vision_summary(self) -> dict[str, Any]:
        """What Vision contributes on this stream: passes in, the lines the Verifier passed on them,
        the latest such line, and how far Vision's passes agree with the engine's (ADR-0022)."""
        passes = pass_facts(self.store.events(self.sk))
        truth = list(self._truth_feed()) if self._truth_feed else []
        return {
            "passes_in": len(passes),
            "lines_verified": self._vision_lines,
            "latest_line": self._latest_vision_line,
            "agreement": agreement(passes, truth),
        }

    def _audit(
        self, actor_kind: str, actor_id: str, action: str, subject: str, details: dict[str, Any]
    ) -> dict[str, Any]:
        record = self.store.append_audit(
            self.sk,
            stream=self.stream,
            actor_kind=actor_kind,
            actor_id=actor_id,
            action=action,
            subject_id=subject,
            details=details,
            time=_stamp(self._clock()),
        )
        live = {**record, "details": _live_details(record["details"])}
        self.hub.publish("audit", f"audit:{record['sequence']}", live)
        return record

    def record_translation_rejected(self, publication_id: str, lang: str, reason: str) -> None:
        """A translation failed its re-check or its service; the viewer keeps the English."""
        self._audit(
            "system", "translator", "translation_rejected", publication_id,
            {"language": lang, "reason": reason},
        )  # fmt: skip

    def _agent(self, action: str, agent: Any, subject: str, **details: Any) -> None:
        extra = {"mode": getattr(agent, "mode", "live"), **details}
        self._audit("agent", agent.agent_id, action, subject, extra)

    async def _call(self, agent: Any, method: str, subject: str, *args: Any, **kwargs: Any) -> Any:
        """Call an agent, then audit any rules fallback it made and publish the status change."""
        with _TRACER.start_as_current_span(f"invoke_agent {agent.agent_id}") as span:
            span.set_attribute("gen_ai.agent.name", agent.agent_id)
            span.set_attribute("matchcast.mode", getattr(agent, "mode", "live"))
            span.set_attribute("matchcast.method", method)
            span.set_attribute("matchcast.subject", subject)
            try:
                result = await getattr(agent, method)(*args, **kwargs)
            finally:
                self._sync_status(agent, subject)
            _annotate(span, method, result)
            if agent.agent_id in ROUTED_AGENTS:
                self._note_called(agent.agent_id)
            return result

    def _sync_status(self, agent: Any, subject: str) -> None:
        take = getattr(agent, "take_fallbacks", None)
        reasons = take() if take else []
        for reason in reasons:
            self._agent("fallback_used", agent, subject, fallback_reason=reason)  # every refusal
            if self.status != "rules_fallback" or self._fallback_reason != reason:
                self.hub.publish("status", None, {"status": "rules_fallback", "reason": reason})
            self.status, self._fallback_reason = "rules_fallback", reason
        if not reasons and self.status == "rules_fallback" and self._all_live():
            self.status, self._fallback_reason = "live", None
            self.hub.publish("status", None, {"status": "live"})

    def _all_live(self) -> bool:
        """Live again only when no wrapped agent is running its rules twin."""
        wrapped = [a for a in self._agent_list() if hasattr(a, "take_fallbacks")]
        return bool(wrapped) and all(a.last_mode == "live" for a in wrapped)

    def _agent_list(self) -> list[Any]:
        a = self.agents
        return [a.producer, a.analyst, a.narrator, a.verifier]

    def _save_line(self, line: LineRecord) -> None:
        self.store.put_line(self.sk, line)
        self.hub.publish(
            "line", f"line:{line.line_id}:{line.status}", public_line(line, stream=True)
        )

    # ---- ingest ------------------------------------------------------------------------

    def validate_batch(self, events: list[dict[str, Any]]) -> None:
        """Raise ContractError (with ``index``) for the first event that is not valid here."""
        for index, event in enumerate(events):
            try:
                validate(event, roster=self.roster)
                if event["kind"] != "event" or event["stream"] != self.stream:
                    raise ContractError(
                        "invalid_schema", "/kind", "expected an event for this match"
                    )
            except ContractError as error:
                error.index = index  # type: ignore[attr-defined]
                raise

    async def ingest(self, events: list[dict[str, Any]]) -> dict[str, int]:
        """Validate the whole batch first (all or nothing), then process each event in order."""
        self.validate_batch(events)
        async with self._lock:
            self._start_stall_timer()  # a resumed workflow may see no new event: the timer runs
            await self._catch_up()
            for event in events:
                if self.store.add_event(self.sk, event):
                    await self._process(event)
        return {
            "accepted": len(events),
            "last_sequence": self.store.get_state(self.sk).max_sequence,
        }

    # ---- checkpoint and resume (AGT-13) --------------------------------------------------

    def _restore(self) -> None:
        """Start from the last checkpoint: state and Producer memory before any partial event."""
        row = self.store.get_checkpoint(self.sk)
        if row is None:
            # a replay from the first event decides every moment again: this workflow's share of
            # the pools, its ledger and the Producer's memory start at zero: nothing counts twice
            self._set_spent(0, 0)
            self.rundown = []
            self._book = StorylineBook()  # a replay opens its storylines again
            self._plan = None
            self._replans = 0
            self._stall.replanned = False
            self._processed_key = None
            reset = getattr(self.agents.producer, "reset", None)
            if reset:
                reset()
            return
        self.store.put_state(self.sk, MatchState.model_validate(row["state"]))
        self.rundown = copy.deepcopy(row.get("rundown", []))
        self._book = StorylineBook.from_rows(row.get("storylines", []))  # open storylines survive
        self._plan = row.get("plan")
        self._replans = row.get("replans", 0)  # replan ids continue after a restart
        self._stall.replanned = row.get("stall_replanned", False)  # the fallback rule survives
        processed = row.get("processed_event")
        self._processed_key = (processed[0], processed[1]) if processed else None
        self._set_spent(row.get("spawn_used", 0), row.get("quiet_used", 0))
        restore = getattr(self.agents.producer, "restore", None)
        if restore and row.get("producer") is not None:
            restore(row["producer"])

    def _checkpoint(self, sequence: int, key: tuple[str, int]) -> None:
        self._saved_once = True
        snapshot = getattr(self.agents.producer, "snapshot", None)
        self.store.put_checkpoint(
            self.sk,
            {
                "processed_sequence": sequence,
                "state": self.store.get_state(self.sk).model_dump(),
                "producer": snapshot() if snapshot else None,
                "rundown": copy.deepcopy(self.rundown),  # a copy: later entries must not reach it
                "storylines": self._book.to_rows(),
                "plan": self._plan,
                "replans": self._replans,
                "stall_replanned": self._stall.replanned,
                "processed_event": list(key),
                "spawn_used": self._spent["priority_one"],
                "quiet_used": self._spent["quiet"],
            },
        )

    async def _catch_up(self) -> None:
        """Process events that were stored but not finished before a crash, in order."""
        row = self.store.get_checkpoint(self.sk)
        done = row["processed_sequence"] if row else 0
        pending = [e for e in self.store.events(self.sk) if e["stream_sequence"] > done]
        if pending and row is None and self._saved_once:
            # this workflow already ran the match, so a replay would write its audit records again
            raise WorkflowError(
                "conflict", "no checkpoint for a match this workflow has already run"
            )
        if pending and row is None:
            self.store.put_state(self.sk, MatchState())
        if pending:
            self._restore()  # drop the half-applied state and spawn spend of the interrupted event
        for event in pending:
            await self._process(event)

    async def _process(self, event: dict[str, Any]) -> None:
        self._at_ms = int(event["event_time_ms"])
        try:
            await self._process_event(event)
            ran = self._routing
        finally:
            self._routing = None  # calls after the event (an edit, a talk) are not this moment's
        if ran is not None:  # the moment's run has ended, so its entry is final
            self._publish_ledger(ran)
        self._processed_key = _event_key(event)
        self._checkpoint(event["stream_sequence"], self._processed_key)

    def add_persona(self, persona: str) -> bool:
        """Write lines for a viewer's watch mode from the next moment on.

        False when it is not a real club, player or metric of this match, or when the match
        already writes for MAX_WATCH_MODES extra modes (each costs a Narrator call a moment).
        Modes are kept until the match ends and are not checkpointed: a reconnecting viewer
        adds theirs again.
        """
        if not known(persona, self.clubs, self.names):
            return False
        if persona in (*self.config.personas, *self.extra_personas):
            return True
        if len(self.extra_personas) >= MAX_WATCH_MODES:
            return False
        self.extra_personas.append(persona)
        return True

    def add_personas(self, personas: tuple[str, ...]) -> bool:
        """All of ``personas`` or none: a pair such as the booth never lands half registered."""
        if not all(known(p, self.clubs, self.names) for p in personas):
            return False
        new = [p for p in personas if p not in (*self.config.personas, *self.extra_personas)]
        if len(self.extra_personas) + len(new) > MAX_WATCH_MODES:
            return False
        self.extra_personas.extend(new)
        return True

    async def _process_event(self, event: dict[str, Any]) -> None:
        self.stats["events"] += 1
        state = apply(self.store.get_state(self.sk), event)
        self.store.put_state(self.sk, state)
        self.hub.publish("state", f"state:{state.revision}", self._state_json(state))
        ctx = self._ctx()
        payoff = self._book.on_goal(event)  # a storyline's player scoring pays it off, once
        if payoff is not None:
            ctx.extra["payoff"] = {
                "cites": list(payoff.cites)
            }  # the text has minutes: not for lines
        self._start_stall_timer()
        self._replan_if_stalled(ctx, event)
        if self.config.orchestrator == "af":
            from .af_graph import run_event  # Agent Framework is imported only when selected

            await run_event(self, ctx, event)
        else:
            task = await self._decide_moment(ctx, event)
            if task is not None:
                await self._run_moment(ctx, task)
        await self._write_feed_lines(event)
        self._note_aired(event)

    async def _write_feed_lines(self, event: dict[str, Any]) -> None:
        """This event's ticker line (AB#471), backed by claims the Verifier recounts.

        It goes through the same Verifier and air gate as every line. A refusal is dropped at once:
        a template line has no repair. The audio description is not aired here (see
        LIVE_FEED_LINES).
        """
        if TICKER_PERSONA not in self.config.feed_lines:
            return
        ctx = self._ctx()
        eid = event["event_id"]
        ticker = f"line-ticker-{eid}"
        written = {ln.line_id for ln in self.store.lines(self.sk)}
        drafts = [pair for pair in ticker_drafts(ctx) if pair[0].line_id == ticker]
        for draft, claims in drafts:
            if draft.line_id in written or not claims:
                continue
            task = ProducerTask(
                moment_id=f"f-{eid}",
                match_id=self.stream["match_id"],
                event_ids=(eid,),
                up_to_sequence=event["stream_sequence"],
                priority=3,
                personas=(draft.persona,),
                reason="feed",
            )
            for claim in claims:
                validate(claim)
                self.store.put_claim(
                    self.sk,
                    claim,
                    {
                        "moment_id": task.moment_id,
                        "agent": self.agents.narrator.agent_id,
                        "created_at": _stamp(self._clock()),
                        "tool_call_ids": [],
                        "formula_inputs": {},
                    },
                )
            await self._verify_line(ctx, task, claims, draft, attempt=1)

    def _note_aired(self, event: dict[str, Any]) -> None:
        """A verified line of this event's moment aired: the match is quiet no longer."""
        # the Vision moment's id is per match, so its line counts for any event of the match
        moments = {f"m-{event['event_id']}", f"v-{self.stream['match_id']}"}
        if any(
            ln.moment_id in moments and ln.status in ("verified", "approved", "published")
            for ln in self.store.lines(self.sk)
        ):
            self._stall.note_line()

    def _start_stall_timer(self) -> None:
        """Starts the stall clock once, with the match, and the timer whenever none is running.
        The timer pauses at full time and starts again on the next event, so a retraction or an
        extra-time period picks it up."""
        if self._closed or (self._stall_task is not None and not self._stall_task.done()):
            return
        if not self._stall_started:
            # the clock starts with the match, not with the workflow; a restored replan flag stays
            self._stall.last_line = self._stall.clock()
            self._stall_started = True
        self._stall_task = asyncio.get_running_loop().create_task(self._stall_watch())

    def _match_over(self) -> bool:
        """Full time has passed: the last period boundary still standing is an ended one in a
        period from the second half on. A retraction takes a boundary off the board, a correction
        puts its replacement there (or takes the boundary off when the replacement is no
        boundary), and a later boundary (extra time) puts the match back on."""
        events = sorted(self.store.events(self.sk), key=lambda e: e["stream_sequence"])
        periods = {e["event_id"]: e["clock"]["period"] for e in events}
        standing: dict[
            str, tuple[int, str, int]
        ] = {}  # boundary's event id -> (sequence, kind, period)
        for e in events:
            payload = e["payload"]
            if payload["type"] == "period_boundary":
                standing[e["event_id"]] = (
                    e["stream_sequence"],
                    payload["boundary"],
                    periods[e["event_id"]],
                )
            elif payload["type"] == "retraction":
                standing.pop(payload["target_event_id"], None)
            elif payload["type"] == "correction":
                target = payload["target_event_id"]
                replacement = payload["replacement"]
                if replacement["type"] == "period_boundary":
                    standing[target] = (
                        e["stream_sequence"],
                        replacement["boundary"],
                        periods.get(target, 0),
                    )
                else:
                    standing.pop(target, None)
        if not standing:
            return False
        _, kind, period = max(standing.values())
        return kind == "ended" and period >= FULL_TIME_PERIOD

    async def _stall_watch(self) -> None:
        """The stall timer (CREW-1.2): wall time passes whether or not an event arrives, so a
        silent feed replans after 60 s too. It stops at full time, and a failed look is logged
        and the timer goes on."""
        while True:
            await asyncio.sleep(STALL_CHECK_S)
            try:
                if not await self._stall_tick():
                    return
            except Exception:
                logger.exception("stall timer look failed; the timer keeps running")

    async def _stall_tick(self) -> bool:
        """One look at the stall clock, under the match lock so a replan never interleaves with a
        run. Returns False once full time has passed."""
        async with self._lock:
            if self._match_over():
                return False
            events = self.store.events(self.sk)
            # only a finished event may be checkpointed: a stored one whose processing failed waits
            # the stored event with the highest sequence; a later revision of a tie stays last
            newest = sorted(events, key=lambda e: e["stream_sequence"])[-1] if events else None
            if newest is not None and _event_key(newest) == self._processed_key:
                replans = self._replans
                self._replan_if_stalled(self._ctx(), newest)
                if self._replans != replans:
                    # no event is in flight here, so the replan is checkpointed now, or a restart
                    # before the next event would lose the storyline it opened
                    self._checkpoint(newest["stream_sequence"], _event_key(newest))
        return True

    def close(self) -> None:
        """Stops the stall timer for good. The timer also pauses by itself at full time."""
        self._closed = True
        if self._stall_task is not None:
            self._stall_task.cancel()

    def _replan_if_stalled(self, ctx: MatchContext, event: dict[str, Any]) -> None:
        """CREW-1.2: after a stall the Showrunner chooses a storyline from shared memory and
        assigns the replay specialist to it. A replan followed by another stall with no verified
        line chooses the rules storyline instead. Checked on each event, so a feed with no events
        does not replan. The specialist is assigned, not run: the rundown entry records it in
        ``skipped``, and no crew_spawn frame claims a run. The chosen storyline is recorded only;
        the Narrator does not use it yet (Planned)."""
        step = self._stall.next_step()
        if step == "wait":
            return
        old = self._plan
        new = FALLBACK_PLAN if step == "fallback" else pick_plan(ctx.extra.get("storylines", {}))
        self._plan = new
        if new.startswith("player:"):
            self._book.open(
                new.removeprefix("player:"), event, f"{ctx.player_name(new[7:])} storyline"
            )
        self._stall.note_replan()
        entry = {
            "moment_id": f"replan-{event['event_id']}-{self._next_replan()}",
            "called": [],
            "skipped": [REPLAN_SPECIALIST],
            "why": f"stall: {old or 'match flow'} -> {new}"
            + (" (rules storyline)" if new == FALLBACK_PLAN else ""),
            "routed_by": "rules",
        }
        self.rundown.append(entry)
        del self.rundown[:-RUNDOWN_KEEP]
        self._publish_ledger(entry)

    def _next_replan(self) -> int:
        self._replans += 1
        return self._replans

    async def _decide_moment(self, ctx: MatchContext, event: dict[str, Any]) -> ProducerTask | None:
        """The Producer's task for this event, else the one Vision moment if it is due."""
        decision = await self._decide(ctx, event)
        if isinstance(decision, ProducerTask):
            return decision
        task = self._vision_moment(ctx, event)
        if task is not None:  # the Vision moment is a crew moment: rundown, ledger and spawns
            self._record_rundown(task)
            await self._spawn(ctx, task)
        return task

    def _vision_moment(self, ctx: MatchContext, event: dict[str, Any]) -> ProducerTask | None:
        """The one Vision moment on the engine feed (ADR-0022): Vision's pass count for each team
        beside the engine's, once the engine clock reaches the config time and a pass is due.
        It is a moment of its own, not a Producer decision, so it works the same in both modes."""
        if (
            self._vision_moment_tried
            or self._vision_feed is None
            or not self.config.vision_moment_ms
            or is_vision_stream(ctx.stream)
            or event["payload"]["type"] != "pass"
            or event["event_time_ms"] < self.config.vision_moment_ms
        ):
            return None
        home, away = ctx.home, ctx.away
        passes = self._vision_feed()
        if any(
            vision_value("vision_precision", team, passes, ctx.events, event["event_time_ms"])
            is None
            for team in (home, away)
        ):
            return None  # no Vision pass is covered by the engine yet: try on a later pass
        self._vision_moment_tried = True
        return ProducerTask(
            moment_id=f"v-{ctx.stream['match_id']}",
            match_id=ctx.stream["match_id"],
            event_ids=(event["event_id"],),
            up_to_sequence=event["stream_sequence"],
            priority=3,
            personas=ctx.personas,
            reason="vision",
        )

    async def _decide(self, ctx: MatchContext, event: dict[str, Any]) -> ProducerTask | None:
        """The Producer: one task for a moment worth a line, or None after auditing a skip."""
        decision = await self._call(
            self.agents.producer, "decide", f"m-{event['event_id']}", ctx, event
        )
        if (
            isinstance(decision, ProducerTask)
            and self.extra_personas
            and decision.reason
            not in BOOTH_MOMENTS  # the booth's own moments keep the booth voices
        ):
            # a colour moment is the analyst's line (and the booth's), never a watch mode's
            extra = [p for p in self.extra_personas if decision.reason != "colour" or p in BOOTH]
            both = dict.fromkeys([*decision.personas, *extra])
            decision = decision.model_copy(update={"personas": tuple(both)})
        if isinstance(decision, Skip):
            self.stats["skipped"] += 1
            if decision.reason in AUDIT_SKIPPED:
                self._agent(
                    "moment_skipped",
                    self.agents.producer,
                    decision.moment_id,
                    reason=decision.reason,
                    why=decision.why,
                )
            return None
        self.stats["moments"] += 1
        self._record_rundown(decision)
        await self._spawn(ctx, decision)
        return decision

    def _set_spent(self, priority_one: int, quiet: int) -> None:
        """Make this workflow's share of the match's pools exactly these counts. The shared pool
        moves by the difference, so a restore or a replay adds nothing twice and refills nothing."""
        self.spawn_budget.used += priority_one - self._spent["priority_one"]
        self.quiet_budget.used += quiet - self._spent["quiet"]
        self._spent = {"priority_one": priority_one, "quiet": quiet}

    async def _spawn(self, ctx: MatchContext, task: ProducerTask) -> None:
        """The specialists for this moment: planned inside the match budget, run in parallel, and
        written into the moment's rundown entry (names in ``called``, and a ``spawns`` list). A
        refused moment gets ``spawn_reason`` and no ``spawns`` key."""
        priority_one = task.priority == 1
        plan = plan_spawns(
            priority=int(task.priority),
            moment_id=task.moment_id,
            available=SPAWN_POOL,
            budget=self.spawn_budget if priority_one else self.quiet_budget,
        )
        entry = self.rundown[-1]
        if not plan.requests:
            entry["spawn_reason"] = plan.reason
            return
        pool = "priority_one" if priority_one else "quiet"
        self._spent[pool] += len(plan.requests)
        entry["spawns"] = []
        for request in plan.requests:
            self._publish_spawn(request.moment_id, request.name, "running")
        reports = await run_all(ctx, plan.requests, self._specialists)
        # this moment's Analyst reads the reports from here; the Narrator reads their claims
        ctx.extra["specialists"] = {report.name: report for report in reports}
        for report in reports:
            entry["spawns"].append(
                {"name": report.name, "status": report.status, "findings": len(report.findings)}
            )
            self._note_called(report.name)
            self._publish_spawn(
                report.moment_id,
                report.name,
                SPAWN_STATUS[report.status],
                ended=True,
            )

    def _record_rundown(self, task: ProducerTask) -> None:
        """One rundown entry per moment the crew takes: the agents it calls, skips and why."""
        desk = self._wants_desk(task)
        self.rundown.append(
            {
                "moment_id": task.moment_id,
                "called": [],  # filled in as each agent actually runs, see _note_called
                "skipped": [] if desk else ["stats_desk"],
                "why": task.reason,  # the rules' or Producer's reason code, never model text
                "routed_by": task.routed_by,
            }
        )
        del self.rundown[:-RUNDOWN_KEEP]
        self._routing = self.rundown[-1]

    def _note_called(self, agent_id: str) -> None:
        """An agent of the current moment actually ran: it goes into that moment's entry."""
        if self._routing is not None and agent_id not in self._routing["called"]:
            self._routing["called"].append(agent_id)

    def _publish_ledger(self, entry: dict[str, Any]) -> None:
        """The crew_ledger frame for one moment, sent once its run has ended (contract 1.3.0)."""
        self.hub.publish(
            "crew_ledger",
            f"ledger:{entry['moment_id']}",
            {
                "kind": "crew_ledger",
                "schema_version": CREW_SCHEMA_VERSION,
                "stream": self.stream,
                "moment_id": entry["moment_id"],
                "at_ms": self._at_ms,
                "called": list(entry["called"]),
                "skipped": list(entry["skipped"]),
                "why": str(entry["why"])[:200],
                "routed_by": entry["routed_by"],
                "spawn_reason": str(entry.get("spawn_reason", ""))[:200],
            },
        )

    def _publish_spawn(
        self, moment_id: str, name: str, status: str, *, ended: bool = False
    ) -> None:
        """A crew_spawn frame: a specialist starts (running) or ends (contract 1.3.0). Specialists
        are deterministic here, so they make no model call and ``tokens`` is 0. ``why`` stays empty:
        a specialist's line is free text with numbers the Verifier has not checked, so it does not
        go on the wire."""
        self.hub.publish(
            "crew_spawn",
            f"spawn:{moment_id}:{name}:{status}",
            {
                "kind": "crew_spawn",
                "schema_version": CREW_SCHEMA_VERSION,
                "stream": self.stream,
                "moment_id": moment_id,
                "spawn_id": f"{moment_id}:{name}",
                "agent_id": name,
                "role": name,
                "parent_id": "showrunner",
                "status": status,
                "started_ms": self._at_ms,
                "ended_ms": self._at_ms if ended else None,
                "tokens": 0,
                "why": "",
            },
        )

    def _state_json(self, state: MatchState) -> dict[str, Any]:
        return {
            "score": state.score,
            "clock_ms": state.event_time_ms,
            "period": state.period,
            "possession": state.possession,
            "revision": state.revision,
        }

    # ---- ask the match (AGT-16) ---------------------------------------------------------

    async def ask(
        self, question: str, persona: str = "casual", assistant: Any = None, surface: str = "ask"
    ) -> Any:
        """Answer one fan question from the match, with citations: the model when it passes its
        checks, else the rules Assistant over the match tools and the knowledge base. The Broadcast
        picks (``surface="broadcast"``) are rules only, so the model is not asked for them."""
        from .ask import default_assistant

        shield = await self.safety.shield(question)
        if shield.attack_detected:
            self._audit("system", "content-safety", "safety_blocked", "ask",
                        {"source": shield.source, "kind": "prompt_attack"})  # fmt: skip
            raise WorkflowError("prompt_attack", "the question was flagged as a prompt attack")
        # An answer reads a snapshot and never waits for the ingest lock: a live batch holds that
        # lock while the agents write, and a viewer must not wait behind it (ADR-0018).
        result, rejected = None, ""
        if assistant is None and self._answers is not None and surface == "ask":
            result, rejected = await self._answers.ask(self._ctx().as_of(), question, persona)
            if result is not None and not (await self.safety.analyze(result.answer)).allowed:
                self._audit("system", "content-safety", "safety_blocked", "ask",
                            {"source": self.safety.source, "kind": "unsafe_content"})  # fmt: skip
                result, rejected = None, "unsafe_content"  # the rules answer instead
        if result is None:
            result = await (assistant or default_assistant()).ask(
                self, question, persona, surface=surface
            )
        self._audit(
            "agent",
            "assistant",
            "ask_answered",
            "ask",
            {
                "surface": surface,
                "intent": result.intent,
                "abstained": result.abstained,
                "dropped": result.dropped,
                "citations": [c["id"] for c in result.citations],
                "mode": result.mode,
                "rejected": rejected or None,  # why the model's answer was not shown, if it was not
            },
        )
        return result

    def record_export(self, export_id: str, kind: str, sha256: str, rows: int) -> None:
        self._audit("person", "viewer", "export_created", export_id,
                    {"kind": kind, "sha256": sha256, "rows": rows})  # fmt: skip

    # ---- talk to a player or the producer (EXP-16) ---------------------------------------

    async def talk(
        self, target: str, utterance: str, position: str | None = None
    ) -> dict[str, Any]:
        """A role agent answers from its own facts; the reply is checked before it is returned.

        An instruction is an order only when the role guard accepts it for this position, and the
        sim changes only for an order whose reply is verified.
        """
        from .roles import player_stats, producer_reply
        from .roles.orders import NONE, decide
        from .verify import extract_names

        shield = await self.safety.shield(utterance)
        if shield.attack_detected:
            self._audit("system", "content-safety", "safety_blocked", "talk",
                        {"source": shield.source, "kind": "prompt_attack"})  # fmt: skip
            raise WorkflowError("prompt_attack", "the utterance was flagged as a prompt attack")
        ctx = self._ctx().as_of()  # a snapshot: a talk never waits for the ingest lock (ADR-0018)
        origin, heard = "rules", NONE
        if target == "producer":
            reply, facts = producer_reply(ctx, utterance)
        elif self._is_player(ctx, target):
            reply, facts, origin, heard = await self._player_reply(ctx, target, utterance, position)
        else:
            raise WorkflowError("not_found", f"unknown talk target {target}")
        order = None
        if heard != NONE:
            decision = decide(position, heard)
            if not (origin == "model" and decision.accepted):  # his own words, if the guard allows
                reply = decision.line
            order = {"key": heard, "accepted": decision.accepted}
            stats = player_stats(ctx, target)  # the counts the order was checked against
            facts = stats.as_dict() if stats is not None else facts
        numbers_ok = self._talk_numbers_ok(ctx, target, reply)
        names_ok = all(n.casefold() in ctx.allowed_names for n in extract_names(reply))
        words = len(reply.split())
        verdict = "verified" if numbers_ok and names_ok and words <= 60 else "rejected"
        if verdict == "verified":  # Content Safety before the reply is shown or spoken
            safe = await self.safety.analyze(reply)
            if not safe.allowed:
                self._audit("system", "content-safety", "safety_blocked", "talk",
                            {"source": safe.source, "kind": "unsafe_content"})  # fmt: skip
                verdict = "rejected"
        if verdict == "rejected":
            reply, facts = "I can't confirm that from the match data yet.", {}
            if order is not None:
                order = {"key": order["key"], "accepted": False}  # an unchecked reply moves nothing
        self._audit("agent", f"talk-{target}", "talk_answered", "talk",
                    {"target": target, "verdict": verdict, "facts": facts,
                     "origin": origin, "order": order})  # fmt: skip
        return {
            "target": target,
            "reply": reply,
            "verdict": verdict,
            "facts": facts,
            "order": order,
        }

    @staticmethod
    def _is_player(ctx: MatchContext, target: str) -> bool:
        return target in ctx.names or any(
            e["payload"].get("player_id") == target for e in ctx.events
        )

    async def _player_reply(
        self, ctx: MatchContext, target: str, utterance: str, position: str | None
    ) -> tuple[str, dict[str, Any], str, str]:
        """(reply, facts, origin, order): the player's reply from the model when it passes the same
        checks the Verifier runs, else the rules template. The order is the one he heard."""
        from .roles import player_reply
        from .roles.orders import keyword_order

        if self._answers is not None:
            sheet, passages = self._talk_knowledge(ctx, target, utterance)
            live = await self._answers.talk(
                ctx, target, utterance, position, sheet=sheet, passages=passages
            )
            if live is not None and self._talk_numbers_ok(ctx, target, live[0]):
                return live[0], live[1], "model", live[2]
        reply, facts = player_reply(ctx, target, utterance)
        return reply, facts, "rules", keyword_order(utterance)

    def _talk_knowledge(
        self, ctx: MatchContext, target: str, utterance: str
    ) -> tuple[dict[str, list[str]], list[str]]:
        """Both squads and the knowledge passages about him and the manager's words.

        Empty when the match has no knowledge base.
        """
        if self._knowledge is None:
            return {}, []
        clubs = (ctx.club_name(ctx.home), ctx.club_name(ctx.away))
        return (
            self._knowledge.team_sheet(clubs),
            self._knowledge.passages(f"{ctx.player_name(target)} {utterance}"),
        )

    @staticmethod
    def _talk_numbers_ok(ctx: MatchContext, target: str, reply: str) -> bool:
        """Every number must be one the log gives, attached to the metric it names.

        Recounted from the stored events here, not taken from the facts the role agent built.
        """
        from .state import counted
        from .verify import extract_numbers
        from .verify.checks import recompute

        if target == "producer":
            numbers = extract_numbers(reply)
            upto = ctx.state.max_sequence
            goals = {recompute(ctx.events, f"goals:{t}", upto) for t in (ctx.home, ctx.away)}
            return all(n in goals for n in numbers)
        from .live.answers import minute_claims_fit

        if not minute_claims_fit(
            ctx, target, reply
        ):  # a minute must be one the named player's log event
            return False
        numbers = extract_numbers(MINUTE_MENTION.sub(" ", reply))
        recount = dict.fromkeys(TALK_PHRASES.values(), 0)
        for event in ctx.events:
            p = event["payload"]
            if p.get("player_id") == target and p["type"] not in ("correction", "retraction"):
                for metric, _team in counted(p):
                    if metric in recount:
                        recount[metric] += 1
        named = [(float(m.group(1)), TALK_PHRASES[m.group(2)]) for m in TALK_RE.finditer(reply)]
        upto = ctx.state.max_sequence

        def from_the_log(n: float, metric: str) -> bool:
            """His own count, or a club's total from the log when the reply names that club."""
            if recount[metric] == n:
                return True
            return any(
                recompute(ctx.events, f"{metric}:{team}", upto) == n
                and ctx.club_name(team).casefold() in reply.casefold()
                for team in (ctx.home, ctx.away)
            )

        return len(named) == len(numbers) and all(from_the_log(n, k) for n, k in named)

    # ---- catch-me-up on demand (CREW-7.3) ----------------------------------------------------

    def catch_me_up(self, minute: int, *, publish: bool = True) -> dict[str, Any] | None:
        """The recap as of a match minute. Every number it states is recounted from the stored
        events up to the cut; a recap that does not recount is not published (None). A read
        passes publish=False: the recap goes to the reader, not to every stream."""
        ctx = self._ctx()
        if "catch_me_up" in self.killed_feeds:
            return None  # the desk has killed this feed on the match
        piece = catch_me_up.build(ctx, minute)
        if piece is None:
            return None  # held (a correction before the cut) or over the word limit
        events = _counted_events(ctx.events, minute)
        for sentence, metrics in piece.sentences:
            if not _sentence_recounts(events, piece, ctx.home, sentence, metrics):
                return None  # a figure that the quoted metrics do not recount: nothing airs
        data = {
            "feed": "catch_me_up",
            "minute": piece.minute,
            "text": piece.text,
            "word_count": piece.word_count,
            "cut_sequence": piece.cut_sequence,
            "source_event_ids": list(piece.source_event_ids),
        }
        if publish:
            self.hub.publish("catch_me_up", f"catch-me-up:{minute}", data)
        return data

    # ---- full-time recap (AGT-15) -------------------------------------------------------

    async def recap(
        self, personas: tuple[str, ...] = ("casual", "analyst", "broadcast"), *, force: bool = False
    ) -> dict[str, dict[str, Any]]:
        """Write, verify and store one recap per persona; a failing sentence is dropped."""
        async with self._lock:
            a = self.agents
            ctx = self._ctx()
            todo = [p for p in personas if force or self.store.get_recap(self.sk, p) is None]
            if todo:
                moments = recap_mod.pick_moments(ctx)
                tools = InProcessTools(ctx, ctx.state.max_sequence)
                try:
                    claims = recap_mod.final_claims(ctx, tools)
                except ToolError as error:
                    self._agent(
                        "fallback_used",
                        a.analyst,
                        "recap",
                        fallback_reason="tool_error",
                        tool=error.tool,
                    )
                    raise WorkflowError("recap_unavailable", str(error)) from error
                packets = [c for c, _ in claims]
                for packet, call_id in claims:
                    validate(packet)
                    self.store.put_claim(
                        self.sk,
                        packet,
                        {
                            "moment_id": "recap",
                            "agent": a.analyst.agent_id,
                            "created_at": _stamp(self._clock()),
                            "tool_call_ids": [call_id],
                            "formula_inputs": {"metric": packet["metric"], "tool": "get_metrics"},
                        },
                    )
                    self._agent(
                        "claim_created",
                        a.analyst,
                        packet["claim_id"],
                        metric=packet["metric"],
                        value=packet["value"],
                        tool_call_ids=[call_id],
                        recap=True,
                    )
                for persona in todo:
                    await self._recap_persona(ctx, persona, packets, moments)  # type: ignore[arg-type]
                self.hub.publish(
                    "recap_ready", f"recap:{self.stream['match_id']}", {"personas": todo}
                )
            return {p: r for p in personas if (r := self.store.get_recap(self.sk, p))}

    async def half_time(self) -> dict[str, Any] | None:
        """Write and verify the half-time piece once the first half has ended (CREW-7.4).

        Each line cites its claims; the Verifier recounts them from the first-half events only.
        A line that fails is dropped, not escalated. Nothing airs here: the air path belongs to
        the feed lane (AB#499). None until the half is over, or when no piece can be written.
        """
        async with self._lock:
            a = self.agents
            ctx = self._ctx()
            piece = half_time_mod.build(ctx)
            if piece is None:
                return None
            stamp = _stamp(self._clock())
            packets = half_time_mod.claims(piece, ctx.stream)
            by_id = {c["claim_id"]: c for c in packets}
            for packet in packets:
                validate(packet)
                self.store.put_claim(
                    self.sk,
                    packet,
                    {
                        "moment_id": "half_time",
                        "agent": a.analyst.agent_id,
                        "created_at": stamp,
                        "tool_call_ids": [],
                        "formula_inputs": {"metric": packet["metric"], "tool": "state"},
                    },
                )
                self._agent(
                    "claim_created",
                    a.analyst,
                    packet["claim_id"],
                    metric=packet["metric"],
                    value=packet["value"],
                    half_time=True,
                )
            # the Verifier sees the first half only: no later event, engine truth, Vision pass or
            # storyline (storylines are built from every stored line, so later ones are in it)
            later = {"vision_passes", "storylines"}
            half = replace(
                ctx,
                events=piece.events,
                state=piece.state,
                truth=(),
                extra={k: v for k, v in ctx.extra.items() if k not in later},
            )
            kept: list[str] = []
            dropped = 0
            for draft in half_time_mod.drafts(piece, packets):
                self._agent(
                    "line_drafted",
                    a.narrator,
                    draft.line_id,
                    persona=draft.persona,
                    claim_ids=list(draft.claim_ids),
                    half_time=True,
                )
                claims = [by_id[c] for c in draft.claim_ids]
                verdict = await self._call(a.verifier, "check", draft.line_id, half, draft, claims)
                verdict = await self._screen(draft, verdict)
                if (
                    verdict.verdict != "verified"
                ):  # a half-time line is verified or dropped, never held
                    dropped += 1
                    self._agent(
                        "line_rejected",
                        a.verifier,
                        draft.line_id,
                        reason_code=verdict.reason_code,
                        half_time=True,
                        checks=[c.model_dump() for c in verdict.checks if not c.passed],
                    )
                    continue
                self._audit(
                    "agent",
                    a.verifier.agent_id,
                    "line_verified",
                    draft.line_id,
                    {
                        "mode": getattr(a.verifier, "mode", "live"),
                        "half_time": True,
                        "checks": [{"name": c.name, "passed": c.passed} for c in verdict.checks],
                    },
                )
                kept.append(draft.text)
            return {
                "match_id": self.stream["match_id"],
                "persona": "half_time",
                "cut_sequence": piece.cut_sequence,
                "text": " ".join(kept),
                "lines_dropped": dropped,
                "claim_ids": [c["claim_id"] for c in packets],
                "source_event_ids": list(piece.source_event_ids),
                "created_at": stamp,
            }

    async def _recap_persona(
        self,
        ctx: MatchContext,
        persona: Persona,
        packets: list[dict[str, Any]],
        moments: list[dict[str, Any]],
    ) -> None:
        a = self.agents
        by_id = {c["claim_id"]: c for c in packets}
        kept: list[tuple[int, str]] = []
        rows: dict[int, dict[str, Any]] = {}
        dropped = 0
        for index, draft in enumerate(recap_mod.sentences(ctx, persona, packets, moments), 1):
            self._agent(
                "line_drafted",
                a.narrator,
                draft.line_id,
                persona=persona,
                claim_ids=list(draft.claim_ids),
                recap=True,
            )
            claims = [by_id[c] for c in draft.claim_ids]
            verdict = await self._call(a.verifier, "check", draft.line_id, ctx, draft, claims)
            verdict = await self._screen(draft, verdict)
            if verdict.verdict == "rejected":
                dropped += 1
                self._agent(
                    "line_rejected",
                    a.verifier,
                    draft.line_id,
                    reason_code=verdict.reason_code,
                    recap=True,
                    checks=[c.model_dump() for c in verdict.checks if not c.passed],
                )
                self._agent(
                    "line_abstained",
                    a.producer,
                    draft.line_id,
                    reason_code=verdict.reason_code,
                    recap=True,
                )
                continue
            record = self._audit(
                "agent",
                a.verifier.agent_id,
                "line_verified",
                draft.line_id,
                {
                    "mode": getattr(a.verifier, "mode", "live"),
                    "recap": True,
                    "checks": [{"name": c.name, "passed": c.passed} for c in verdict.checks],
                },
            )
            kept.append((index, draft.text))
            rows[index] = {
                "line_id": draft.line_id,
                "text": draft.text,
                "claim_ids": list(draft.claim_ids),
                "verdict": verdict.verdict,
                "audit_sequence": record["sequence"],
            }
        final = recap_mod.fit_words(kept, persona)
        text = " ".join(t for _, t in final)
        recap = {
            "match_id": self.stream["match_id"],
            "persona": persona,
            "language": "en",
            "text": text,
            "word_count": len(text.split()),
            "sentences": [rows[i] for i, _ in final],
            "claim_ids": [c["claim_id"] for c in packets],
            "state": packets[0]["snapshot"],
            "created_at": _stamp(self._clock()),
            "mode": self.agents.mode,
        }
        self.store.put_recap(self.sk, persona, recap)
        self._audit(
            "system",
            "recap",
            "recap_created",
            f"recap-{persona}",
            {
                "persona": persona,
                "words": recap["word_count"],
                "sentences": len(final),
                "dropped": dropped,
            },
        )

    # ---- one moment through the graph --------------------------------------------------

    async def _run_moment(self, ctx: MatchContext, task: ProducerTask) -> None:
        claims = await self._analyse(ctx, task, repair=False)
        if not claims:
            return
        drafts = await self._narrate(ctx, task, claims)
        await self._verify_drafts(ctx, task, claims, drafts)
        await self._desk_after_verify(task)

    async def _narrate(
        self, ctx: MatchContext, task: ProducerTask, claims: list[dict[str, Any]]
    ) -> list[DraftLine]:
        return await self._call(self.agents.narrator, "write", task.moment_id, ctx, task, claims)

    async def _verify_drafts(
        self,
        ctx: MatchContext,
        task: ProducerTask,
        claims: list[dict[str, Any]],
        drafts: list[DraftLine],
    ) -> None:
        """Verifier, repair router and approval for every draft of the moment."""
        self._verified_claims = {}
        self._redrafts = {}  # one redraft per moment and target serves every rejected persona
        self._repair_lock = asyncio.Lock()
        # The lines of a moment are independent, so their model checks run together (a moment
        # costs one round of Verifier calls, not one per persona); repairs take turns.
        # The booth's colour analyst answers the play-by-play, so that line is checked and aired
        # after the call it reacts to; every other line goes together.
        reacting = [d for d in drafts if d.persona == "booth:colour"]
        first = [d for d in drafts if d not in reacting]
        for group in (first, reacting):
            if group is reacting and not self._call_aired(task):
                break  # the call it would answer never aired: no reaction to nothing
            results = await asyncio.gather(
                *(self._verify_line(ctx, task, claims, d, attempt=0) for d in group),
                return_exceptions=True,
            )
            for failure in results:
                if isinstance(failure, BaseException):
                    if isinstance(failure, asyncio.CancelledError):
                        raise RuntimeError("a line check was cancelled") from failure
                    raise failure

    def _call_aired(self, task: ProducerTask) -> bool:
        """Some play-by-play line of this moment passed its checks (or the moment has none)."""
        calls = [
            ln
            for ln in self.store.lines(self.sk)
            if ln.moment_id == task.moment_id and ln.persona == "booth:pbp"
        ]
        return not calls or any(ln.status in ("verified", "approved", "published") for ln in calls)

    def _wants_desk(self, task: ProducerTask) -> bool:
        # priority 1 always; any other moment only when the Producer asked for it
        return (task.priority == 1 or task.call_stats_desk) and self.stats_desk is not None

    async def _desk_after_verify(self, task: ProducerTask) -> None:
        if not self._wants_desk(task):
            return
        self._note_called("stats_desk")
        # After verification: only a claim that backs a verified line is ever sent to the desk.
        checked = list(self._verified_claims.values())
        try:
            await asyncio.wait_for(self._ask_stats_desk(task, checked), STATS_DESK_BUDGET_S)
        except TimeoutError:
            self._audit("agent", "producer", "a2a_failed", task.moment_id, {"error": "time budget"})

    async def _ask_stats_desk(self, task: ProducerTask, claims: list[dict[str, Any]]) -> None:
        """Priority 1 moments: compare the first team stat with the season over A2A (audited)."""
        claim = next((c for c in claims if c["metric"].split(":")[0] in TEAM_METRICS), None)
        if claim is None:
            return
        metric, _, side = claim["metric"].partition(":")
        # the season is keyed by club code; a name it does not know falls through to league-wide
        team_id = season_code(self.clubs.get(side), side) or side
        details: dict[str, Any] = {
            "skill": "compare_to_season",
            "metric": metric,
            "value": claim["value"],
            "claim_id": claim["claim_id"],
            "team_id": team_id,
            "as_of_ms": claim["snapshot"]["event_time_ms"],  # running total vs full-match season
            "transport": getattr(self.stats_desk, "transport", "a2a"),
        }
        try:
            try:
                result = await self.stats_desk.compare(  # type: ignore[union-attr]
                    metric, "team", claim["value"], team_id
                )
            except StatsDeskError as error:
                if "no team rows" not in str(error):
                    raise
                # a club the season has no rows for: compare with every team, and say so
                details.update(
                    team_id=None, requested_team_id=team_id, compared_with="all season teams"
                )
                result = await self.stats_desk.compare(  # type: ignore[union-attr]
                    metric, "team", claim["value"], None
                )
        except StatsDeskError as error:
            self._audit(
                "agent",
                "producer",
                "a2a_failed",
                task.moment_id,
                {**details, "error": str(error)[:200]},
            )
            return
        self._audit("agent", "producer", "a2a_call", task.moment_id, {**details, "result": result})

    async def _analyse(
        self, ctx: MatchContext, task: ProducerTask, *, repair: bool
    ) -> list[dict[str, Any]]:
        """Run the Analyst, store its claims with their tool calls; a failed tool means no claim."""
        a = self.agents
        try:
            results = await self._call(
                a.analyst, "analyse", task.moment_id, ctx, task, repair=repair
            )
        except ToolError as error:
            self._agent(
                "fallback_used",
                a.analyst,
                task.moment_id,
                fallback_reason="tool_error",
                tool=error.tool,
            )
            return []
        for result in results:
            claim = result.packet
            validate(claim)
            self.store.put_claim(
                self.sk,
                claim,
                {
                    "moment_id": task.moment_id,
                    "agent": a.analyst.agent_id,
                    "created_at": _stamp(self._clock()),
                    "tool_call_ids": list(result.tool_call_ids),
                    "formula_inputs": result.formula_inputs,
                },
            )
            if not repair:
                self.stats["claims"] += 1
            self.hub.publish("claim", f"claim:{claim['claim_id']}", claim)
            self._agent(
                "claim_created",
                a.analyst,
                claim["claim_id"],
                metric=claim["metric"],
                value=claim["value"],
                tool_call_ids=list(result.tool_call_ids),
                **({"repair": True} if repair else {"priority": task.priority}),
            )
        return [r.packet for r in results]

    async def _verify_line(
        self,
        ctx: MatchContext,
        task: ProducerTask,
        claims: list[dict[str, Any]],
        draft: DraftLine,
        *,
        attempt: int,
        repair_of: str | None = None,
    ) -> None:
        a = self.agents
        record = LineRecord(
            line_id=draft.line_id,
            moment_id=task.moment_id,
            claim_ids=list(draft.claim_ids),
            persona=draft.persona,
            text=draft.text,
            status="drafted",
            repair_of=repair_of,
            created_at=_stamp(self._clock()),
            origin=draft.origin,
            snapshot_revision=claims[0]["snapshot"]["state_revision"],
        )
        self.stats["lines"] += 1
        self._save_line(record)
        self._agent(
            "line_drafted",
            a.narrator,
            draft.line_id,
            persona=draft.persona,
            claim_ids=list(draft.claim_ids),
            moment=task.reason,
            mode="rules" if draft.origin == "template" else "live",  # what wrote this very line
            routed_by=task.routed_by,
            why=task.why,
        )
        verdict = await self._call(a.verifier, "check", draft.line_id, ctx, draft, claims)
        verdict = await self._screen(draft, verdict)
        record.checks = list(verdict.checks)
        record.reason_code = verdict.reason_code
        # a derived feed never waits for a person: a line the Verifier sends to review is refused
        # and goes through the same one repair as a rejected line (CREW-4.3)
        refused = verdict.verdict == "rejected" or (
            verdict.verdict == "review" and draft.persona not in BOOTH
        )
        if refused:
            record.status = "rejected"
            self._save_line(record)
            self._agent(
                "line_rejected",
                a.verifier,
                draft.line_id,
                reason_code=verdict.reason_code,
                checks=[c.model_dump() for c in verdict.checks],
                **_repair_link(repair_of),
            )
            if attempt == 0:
                with _TRACER.start_as_current_span("handoff verifier to repair") as span:
                    span.set_attribute("matchcast.reason_code", verdict.reason_code or "")
                    span.set_attribute("matchcast.line_id", draft.line_id)
                    await self._repair(ctx, task, claims, draft, verdict)
            else:
                self._give_up(record, verdict, task.event_ids)
            return
        record.status = "verified" if verdict.verdict == "verified" else "review"
        self._save_line(record)
        action = "line_verified" if record.status == "verified" else "line_review"
        self._agent(
            action,
            a.verifier,
            draft.line_id,
            checks=[{"name": c.name, "passed": c.passed} for c in verdict.checks],
            **_repair_link(repair_of),
        )
        if record.status == "verified":
            self.stats["verified"] += 1
            if is_vision_stream(self.stream):
                self._vision_lines += 1
                if draft.persona == "analyst":
                    self._latest_vision_line = draft.text
            for claim in claims:
                if claim["claim_id"] in record.claim_ids:
                    self._verified_claims[claim["claim_id"]] = claim
            # derived feeds air as soon as the Verifier passes them (CREW-4.3); the booth and
            # any other queued line wait for the producer in producer mode
            feed = feed_for(record.persona)
            if feed is not None and feed.key in self.killed_feeds:
                record.status = "killed"  # the desk killed this feed: nothing from it airs
                self._save_line(record)
                self._agent(
                    "line_killed", a.producer, draft.line_id, feed=feed.key, persona=record.persona
                )
                return
            if not waits_for_producer(
                record.persona, self.config.approval_mode, self.config.hold_booth
            ):
                self._approve(record, "agent", a.producer.agent_id, source_events=task.event_ids)

    async def _screen(self, draft: DraftLine, verdict: Verdict) -> Verdict:
        """Check 7: Content Safety on every line that survived checks 1 to 6."""
        if verdict.verdict == "rejected":
            return verdict
        result = await self.safety.analyze(draft.text)
        if result.source == "local" and hasattr(self.safety, "fallbacks"):
            self._audit(
                "system", "content-safety", "fallback_used", draft.line_id,
                {"fallback_reason": "content_safety"},
            )  # fmt: skip
        check = Check(
            name="safety",
            passed=result.allowed,
            detail=f"{result.source}: max severity {max(result.categories.values(), default=0)}",
        )
        checks = (*verdict.checks, check)
        if result.allowed:
            return verdict.model_copy(update={"checks": checks})
        self._audit(
            "system",
            "content-safety",
            "safety_blocked",
            draft.line_id,
            {"source": result.source, "categories": result.categories},
        )
        return verdict.model_copy(
            update={"verdict": "rejected", "reason_code": "unsafe_content", "checks": checks}
        )

    async def _repair(
        self,
        ctx: MatchContext,
        task: ProducerTask,
        claims: list[dict[str, Any]],
        draft: DraftLine,
        verdict: Verdict,
    ) -> None:
        """One repair: number or source problems go back to the Analyst, wording to the Narrator."""
        a = self.agents
        reused = any(
            not c.passed and "more often than the claims allow" in c.detail for c in verdict.checks
        )  # the claims are right; the wording repeated a value
        target = "analyst" if verdict.reason_code in NUMBER_OR_SOURCE and not reused else "narrator"
        self._agent(
            "line_repair_requested",
            a.producer,
            draft.line_id,
            target=target,
            reason_code=verdict.reason_code,
        )
        self.stats["repaired"] += 1
        async with self._repair_lock:
            key = (task.moment_id, target)
            if key not in self._redrafts:
                fresh_ctx, fresh_claims = ctx, claims
                if target == "analyst":
                    fresh_ctx = self._ctx()
                    # the same specialist reports the first analysis read, not a new fan-out
                    for name in ("specialists", "rhythm", "payoff"):
                        if name in ctx.extra:
                            fresh_ctx.extra[name] = ctx.extra[name]
                    fresh_claims = await self._analyse(fresh_ctx, task, repair=True)
                written = (
                    await self._call(
                        a.narrator,
                        "write",
                        task.moment_id,
                        fresh_ctx,
                        task,
                        fresh_claims,
                        attempt=1,
                        feedback=repair_feedback(draft, verdict),
                    )
                    if fresh_claims
                    else []
                )
                self._redrafts[key] = (fresh_ctx, fresh_claims, written)  # an empty one too
            ctx, claims, redrafts = self._redrafts[key]
        replacement = next((d for d in redrafts if d.persona == draft.persona), None)
        if replacement is None:  # no repaired line for this persona: the original is final
            original = self.store.get_line(self.sk, draft.line_id)
            assert original is not None
            self._give_up(original, verdict, task.event_ids)
            return
        await self._verify_line(ctx, task, claims, replacement, attempt=1, repair_of=draft.line_id)

    def _give_up(
        self, record: LineRecord, verdict: Verdict, event_ids: tuple[str, ...] = ()
    ) -> None:
        """A line that failed its one repair. A booth line (play-by-play or colour) whose failure
        is a checkable fact waits in the producer queue flagged escalated. The six derived feeds
        are dropped from air with an audit record (CREW-4.3): they air once the Verifier passes."""
        a = self.agents
        if record.persona in BOOTH and verdict.reason_code in ESCALATED_CODES:
            record.status = "review"
            record.escalated = True
            self._save_line(record)
            self.stats["escalated"] += 1
            self._agent(
                "line_review",
                a.verifier,
                record.line_id,
                reason_code=verdict.reason_code,
                escalated=True,
                repair_of=record.repair_of,
            )
            return
        record.status = "abstained"
        self._save_line(record)
        self.stats["abstained"] += 1
        feed = feed_for(record.persona)
        # a line the Verifier could not confirm has no code; a dropped feed line is unsupported
        reason_code = verdict.reason_code
        details: dict[str, Any] = {
            "mode": getattr(a.producer, "mode", "live"),
            "reason_code": reason_code,
            "persona": record.persona,
            **_repair_link(record.repair_of),
        }
        if feed is not None:
            reason_code = reason_code or "unsupported_statement"
            details["reason_code"] = reason_code
            # the audit route and its SSE event reach every viewer, so the text of a line that
            # Content Safety refused is never written there (14-security-and-responsible-ai.md §1)
            if reason_code != "unsafe_content":
                details["text"] = record.text  # a dropped feed line's text stays in the audit chain
        audit = self._audit("agent", a.producer.agent_id, "line_abstained", record.line_id, details)
        if feed is not None and drops_on_failed_repair(record.persona) and event_ids:
            drop = {
                "kind": "feed_drop",
                "schema_version": "1.2.0",
                "stream": self.stream,
                "publication_id": f"pub-{record.line_id}",
                "feed": feed.key,
                "source_event_ids": list(event_ids),
                "reason_code": reason_code,
                "repair_count": 1,
                "audit_id": audit["audit_id"],
                "match_time_ms": self.store.get_state(self.sk).event_time_ms,
            }
            validate(drop)
            self.hub.publish("feed_drop", f"drop:{record.line_id}", drop)

    # ---- approval and publication ------------------------------------------------------

    def _approve(
        self,
        line: LineRecord,
        actor_kind: str,
        actor_id: str,
        actor_name: str | None = None,
        *,
        source_events: tuple[str, ...] = (),
    ) -> None:
        line.status = "approved"
        line.decided_by = actor_id
        self._save_line(line)
        details: dict[str, Any] = {"persona": line.persona}
        if actor_name:
            details["actor_name"] = actor_name[:80]
        if actor_kind == "agent":
            details["mode"] = self.agents.mode
        self._audit(actor_kind, actor_id, "line_approved", line.line_id, details)
        claims = []
        for claim_id in line.claim_ids:
            row = self.store.get_claim(self.sk, claim_id)
            assert row is not None
            packet = {**row["packet"], "approval_status": "approved"}
            validate(packet)
            self.store.put_claim(self.sk, packet, {k: v for k, v in row.items() if k != "packet"})
            claims.append(packet)
        now = self._clock()
        publication = {
            "kind": "publication",
            "schema_version": "1.1.0",
            "stream": self.stream,
            "publication_id": f"pub-{line.line_id}",
            "claim_ids": list(line.claim_ids),
            "state": claims[0]["snapshot"],
            "persona": line.persona,
            "language": "en",
            "event_time_ms": claims[0]["snapshot"]["event_time_ms"],
            "published_at": _stamp(now),
            "expires_at": _stamp(now + timedelta(seconds=self.config.publication_ttl_s)),
            "audio_generation_id": None,
            "text": line.text,
        }
        validate(publication)
        self.store.put_publication(self.sk, publication)
        line.status = "published"
        self._save_line(line)
        self.stats["published"] += 1
        self.hub.publish("publication", f"pub:{publication['publication_id']}", publication)
        feed = feed_for(line.persona)
        if feed is not None and source_events:
            onair = {
                "kind": "onair",
                "schema_version": "1.2.0",
                "stream": self.stream,
                "publication_id": publication["publication_id"],
                "feed": feed.key,
                "lang": "en",
                "text": line.text,
                "source_event_ids": list(source_events),
                "claim_ids": list(line.claim_ids),
                "match_time_ms": publication["event_time_ms"],
                "aired_at": publication["published_at"],
                "repair_count": 1 if line.repair_of else 0,
            }
            validate(onair)
            self.hub.publish("onair", f"onair:{publication['publication_id']}", onair)
        self._audit(
            "system",
            "publisher",
            "publication_created",
            publication["publication_id"],
            {"line_id": line.line_id, "persona": line.persona},
        )

    def _line(self, line_id: str) -> LineRecord:
        line = self.store.get_line(self.sk, line_id)
        if line is None:
            raise WorkflowError("not_found", f"unknown line {line_id}")
        return line

    async def approve(
        self, line_id: str, actor_id: str = "producer", actor_name: str | None = None
    ) -> LineRecord:
        async with self._lock:
            line = self._line(line_id)
            if line.status not in ("verified", "review"):
                raise WorkflowError("not_approvable", f"line is {line.status}")
            if line.escalated:
                raise WorkflowError("not_approvable", "an escalated line can only be killed")
            self._approve(line, "person", actor_id, actor_name)
            return line

    async def kill(
        self,
        line_id: str,
        reason: str,
        actor_id: str = "producer",
        actor_name: str | None = None,
    ) -> LineRecord:
        async with self._lock:
            line = self._line(line_id)
            if line.status in ("published", "killed"):
                raise WorkflowError("not_approvable", f"line is {line.status}")
            line.status = "killed"
            line.decided_by = actor_id
            self._save_line(line)
            details = {"reason": reason[:200]}
            if actor_name:
                details["actor_name"] = actor_name[:80]
            self._audit("person", actor_id, "line_killed", line_id, details)
            return line

    async def set_feed(
        self,
        feed: str,
        killed: bool,
        reason: str,
        actor_id: str = "producer",
        actor_name: str | None = None,
    ) -> dict[str, Any]:
        """The desk's per-feed kill or resume (AB#499). Audited with enforced true: the air gate
        in _verify_line airs nothing from a killed feed."""
        async with self._lock:
            details = {"feed": feed, "reason": reason[:200], "enforced": True}
            if actor_name:
                details["actor_name"] = actor_name[:80]
            # audit first: if the append fails, the kill is not in force in memory either
            record = self._audit(
                "person", actor_id, "feed_killed" if killed else "feed_resumed", feed, details
            )
            if killed:
                self.killed_feeds.add(feed)
            else:
                self.killed_feeds.discard(feed)
            return record

    def _restore_feed_state(self) -> None:
        """Rebuild the kill state from the audit chain, so a restart keeps a kill in force."""
        self.killed_feeds |= feed_kills_in(self.store, self.sk)

    async def edit(
        self,
        line_id: str,
        text: str,
        actor_id: str = "producer",
        actor_name: str | None = None,
    ) -> tuple[LineRecord, Verdict]:
        """Replace the text, run the Verifier again, and approve only if it passes."""
        async with self._lock:
            line = self._line(line_id)
            if feed_for(line.persona) is not None:  # derived lines air on verify, never by edit
                raise WorkflowError("not_approvable", "a derived feed line is not edited")
            if line.status in ("published", "killed"):
                raise WorkflowError("not_approvable", f"line is {line.status}")
            if (
                line.escalated
            ):  # an edit that passes the Verifier would approve, so it waits for kill
                raise WorkflowError("not_approvable", "an escalated line can only be killed")
            shield = await self.safety.shield(text)
            if shield.attack_detected:
                self._audit("system", "content-safety", "safety_blocked", line_id,
                            {"source": shield.source, "kind": "prompt_attack"})  # fmt: skip
                raise WorkflowError("prompt_attack", "the edit text was flagged as a prompt attack")
            ctx = self._ctx()
            claims = [self.store.get_claim(self.sk, c)["packet"] for c in line.claim_ids]  # type: ignore[index]
            draft = DraftLine(
                line_id=line_id,
                claim_ids=tuple(line.claim_ids),
                persona=line.persona,
                text=text,
                max_chars=280,
            )
            verdict = await self._call(self.agents.verifier, "check", line_id, ctx, draft, claims)
            verdict = await self._screen(draft, verdict)
            if verdict.verdict == "rejected":
                return line, verdict
            line.text, line.checks, line.reason_code = text, list(verdict.checks), None
            line.origin = "template"
            edited: dict[str, Any] = {"persona": line.persona}
            if actor_name:
                edited["actor_name"] = actor_name[:80]
            self._audit("person", actor_id, "line_edited", line_id, edited)
            line.status = "verified"
            self._approve(line, "person", actor_id, actor_name)
            return line, verdict
