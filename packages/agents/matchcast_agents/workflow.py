"""The match workflow: Producer, Analyst, Narrator, Verifier, repair, approval, publication.

One ``MatchWorkflow`` serves one stream. Executors are async so live (Foundry) agents can
replace the rules twins through ``AgentSet`` without changing this graph. Every step appends
a hash-chained audit record (ADR-0013: lines carry verdicts and approvals).
"""

import asyncio
import os
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any, Protocol

from matchcast_contracts import ContractError, validate
from opentelemetry import trace

from . import recap as recap_mod
from .context import MatchContext
from .hub import StreamHub
from .messages import Check, DraftLine, LineRecord, Persona, ProducerTask, Skip, Verdict
from .personas import MAX_WATCH_MODES, known
from .rules import AnalystRules, NarratorRules, ProducerRules, VerifierRules
from .rules.analyst import ClaimResult
from .safety import LocalSafetyScreen, SafetyScreen
from .season_clubs import season_code
from .state import MatchState, apply
from .statsdesk import TEAM_METRICS, StatsDesk, StatsDeskError
from .store import MemoryStore, Store, stream_key
from .tools import InProcessTools, ToolCall, ToolError

if TYPE_CHECKING:
    from .live.client import ModelClient

STATS_DESK_BUDGET_S = 2.0

TALK_PHRASES = {
    "shots on target": "shots_on_target", "shots": "shots", "goals": "goals",
    "tackles won": "tackles_won", "fouls": "fouls", "cards": "cards",
}  # fmt: skip
TALK_RE = re.compile(r"(\d+) (shots on target|shots|goals|tackles won|fouls|cards)\b")
AUDIT_SKIPPED = ("rate_limited", "duplicate_moment")
NUMBER_OR_SOURCE = ("number_mismatch", "unknown_source", "stale_state")


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
    publication_ttl_s: int = 30
    personas: tuple[Persona, ...] = ("casual", "analyst")
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
        stats_desk: StatsDesk | None = None,
        answer_model: "ModelClient | None" = None,
    ) -> None:
        from .live.answers import LiveAnswers  # lazy: the live package imports this module

        self.stats_desk = stats_desk
        self._answers = LiveAnswers(answer_model) if answer_model is not None else None
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
            },
        )
        self._restore()
        self.stats = {
            "events": 0,
            "moments": 0,
            "skipped": 0,
            "claims": 0,
            "lines": 0,
            "verified": 0,
            "repaired": 0,
            "abstained": 0,
            "published": 0,
        }

    # ---- helpers -----------------------------------------------------------------------

    def _ctx(self) -> MatchContext:
        return MatchContext(
            stream=self.stream,
            roster=self.roster,
            names=self.names,
            clubs=self.clubs,
            state=self.store.get_state(self.sk),
            events=tuple(self.store.events(self.sk)),
            personas=self.config.personas,
        )

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
        self.hub.publish("audit", f"audit:{record['sequence']}", record)
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
        self.hub.publish("line", f"line:{line.line_id}:{line.status}", line.model_dump())

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
            return
        self.store.put_state(self.sk, MatchState.model_validate(row["state"]))
        restore = getattr(self.agents.producer, "restore", None)
        if restore and row.get("producer") is not None:
            restore(row["producer"])

    def _checkpoint(self, sequence: int) -> None:
        snapshot = getattr(self.agents.producer, "snapshot", None)
        self.store.put_checkpoint(
            self.sk,
            {
                "processed_sequence": sequence,
                "state": self.store.get_state(self.sk).model_dump(),
                "producer": snapshot() if snapshot else None,
            },
        )

    async def _catch_up(self) -> None:
        """Process events that were stored but not finished before a crash, in order."""
        row = self.store.get_checkpoint(self.sk)
        done = row["processed_sequence"] if row else 0
        pending = [e for e in self.store.events(self.sk) if e["stream_sequence"] > done]
        if pending and row is None:
            self.store.put_state(self.sk, MatchState())
        if pending:
            self._restore()  # drop the half-applied state of the interrupted event
        for event in pending:
            await self._process(event)

    async def _process(self, event: dict[str, Any]) -> None:
        await self._process_event(event)
        self._checkpoint(event["stream_sequence"])

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

    async def _process_event(self, event: dict[str, Any]) -> None:
        self.stats["events"] += 1
        state = apply(self.store.get_state(self.sk), event)
        self.store.put_state(self.sk, state)
        self.hub.publish("state", f"state:{state.revision}", self._state_json(state))
        ctx = self._ctx()
        if self.config.orchestrator == "af":
            from .af_graph import run_event  # Agent Framework is imported only when selected

            await run_event(self, ctx, event)
            return
        decision = await self._decide(ctx, event)
        if isinstance(decision, ProducerTask):
            await self._run_moment(ctx, decision)

    async def _decide(self, ctx: MatchContext, event: dict[str, Any]) -> ProducerTask | None:
        """The Producer: one task for a moment worth a line, or None after auditing a skip."""
        decision = await self._call(
            self.agents.producer, "decide", f"m-{event['event_id']}", ctx, event
        )
        if (
            isinstance(decision, ProducerTask)
            and self.extra_personas
            and decision.reason != "colour"
        ):
            both = dict.fromkeys([*decision.personas, *self.extra_personas])
            decision = decision.model_copy(update={"personas": tuple(both)})
        if isinstance(decision, Skip):
            self.stats["skipped"] += 1
            if decision.reason in AUDIT_SKIPPED:
                self._agent(
                    "moment_skipped",
                    self.agents.producer,
                    decision.moment_id,
                    reason=decision.reason,
                )
            return None
        self.stats["moments"] += 1
        return decision

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
            live = await self._answers.talk(ctx, target, utterance, position)
            if live is not None and self._talk_numbers_ok(ctx, target, live[0]):
                return live[0], live[1], "model", live[2]
        reply, facts = player_reply(ctx, target, utterance)
        return reply, facts, "rules", keyword_order(utterance)

    @staticmethod
    def _talk_numbers_ok(ctx: MatchContext, target: str, reply: str) -> bool:
        """Every number must be one the log gives, attached to the metric it names.

        Recounted from the stored events here, not taken from the facts the role agent built.
        """
        from .state import counted
        from .verify import extract_numbers
        from .verify.checks import recompute

        numbers = extract_numbers(reply)
        if target == "producer":
            upto = ctx.state.max_sequence
            goals = {recompute(ctx.events, f"goals:{t}", upto) for t in (ctx.home, ctx.away)}
            return all(n in goals for n in numbers)
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
        results = await asyncio.gather(
            *(self._verify_line(ctx, task, claims, d, attempt=0) for d in drafts),
            return_exceptions=True,
        )
        for failure in results:
            if isinstance(failure, BaseException):
                if isinstance(failure, asyncio.CancelledError):
                    raise RuntimeError("a line check was cancelled") from failure
                raise failure

    def _wants_desk(self, task: ProducerTask) -> bool:
        return task.priority == 1 and self.stats_desk is not None

    async def _desk_after_verify(self, task: ProducerTask) -> None:
        if not self._wants_desk(task):
            return
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
            mode="rules" if draft.origin == "template" else "live",  # what wrote this very line
        )
        verdict = await self._call(a.verifier, "check", draft.line_id, ctx, draft, claims)
        verdict = await self._screen(draft, verdict)
        record.checks = list(verdict.checks)
        record.reason_code = verdict.reason_code
        if verdict.verdict == "rejected":
            record.status = "rejected"
            self._save_line(record)
            self._agent(
                "line_rejected",
                a.verifier,
                draft.line_id,
                reason_code=verdict.reason_code,
                checks=[c.model_dump() for c in verdict.checks if not c.passed],
            )
            if attempt == 0:
                await self._repair(ctx, task, claims, draft, verdict)
            else:
                record.status = "abstained"
                self._save_line(record)
                self.stats["abstained"] += 1
                self._agent(
                    "line_abstained", a.producer, draft.line_id, reason_code=verdict.reason_code
                )
            return
        record.status = "verified" if verdict.verdict == "verified" else "review"
        self._save_line(record)
        action = "line_verified" if record.status == "verified" else "line_review"
        self._agent(
            action,
            a.verifier,
            draft.line_id,
            checks=[{"name": c.name, "passed": c.passed} for c in verdict.checks],
        )
        if record.status == "verified":
            self.stats["verified"] += 1
            for claim in claims:
                if claim["claim_id"] in record.claim_ids:
                    self._verified_claims[claim["claim_id"]] = claim
            if self.config.approval_mode == "auto":
                self._approve(record, "agent", a.producer.agent_id)

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
                    )
                    if fresh_claims
                    else []
                )
                self._redrafts[key] = (fresh_ctx, fresh_claims, written)  # an empty one too
            ctx, claims, redrafts = self._redrafts[key]
        replacement = next((d for d in redrafts if d.persona == draft.persona), None)
        if replacement is None:
            return
        await self._verify_line(ctx, task, claims, replacement, attempt=1, repair_of=draft.line_id)

    # ---- approval and publication ------------------------------------------------------

    def _approve(
        self, line: LineRecord, actor_kind: str, actor_id: str, actor_name: str | None = None
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
            if line.status in ("published", "killed"):
                raise WorkflowError("not_approvable", f"line is {line.status}")
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
