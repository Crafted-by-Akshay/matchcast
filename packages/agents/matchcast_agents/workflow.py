"""The match workflow: Producer, Analyst, Narrator, Verifier, repair, approval, publication.

One ``MatchWorkflow`` serves one stream. Executors are async so live (Foundry) agents can
replace the rules twins through ``AgentSet`` without changing this graph. Every step appends
a hash-chained audit record (ADR-0013: lines carry verdicts and approvals).
"""

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from matchcast_contracts import ContractError, validate

from .context import MatchContext
from .hub import StreamHub
from .messages import DraftLine, LineRecord, Persona, ProducerTask, Skip, Verdict
from .rules import AnalystRules, NarratorRules, ProducerRules, VerifierRules
from .state import MatchState, apply
from .store import MemoryStore, stream_key

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
    ) -> list[dict[str, Any]]: ...


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
    personas: tuple[Persona, ...] = ("casual", "analyst"), *, seed_bad_claim: bool = False
) -> AgentSet:
    return AgentSet(
        ProducerRules(personas),
        AnalystRules(corrupt_first_claim=seed_bad_claim),
        NarratorRules(),
        VerifierRules(),
    )


@dataclass
class WorkflowConfig:
    approval_mode: str = "auto"  # auto | producer
    publication_ttl_s: int = 30
    personas: tuple[Persona, ...] = ("casual", "analyst")
    extra: dict[str, Any] = field(default_factory=dict)


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
        store: MemoryStore | None = None,
        hub: StreamHub | None = None,
        agents: AgentSet | None = None,
        config: WorkflowConfig | None = None,
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        self.stream = stream
        self.sk = stream_key(stream)
        self.roster = validate(roster)
        self.names = names or {}
        self.clubs = clubs or {}
        self.store = store or MemoryStore()
        self.hub = hub or StreamHub()
        self.config = config or WorkflowConfig()
        self.agents = agents or rules_agents(self.config.personas)
        self._clock = clock
        self._lock = asyncio.Lock()
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

    def _agent(self, action: str, agent: Any, subject: str, **details: Any) -> None:
        extra = {"mode": getattr(agent, "mode", "live"), **details}
        self._audit("agent", agent.agent_id, action, subject, extra)

    def _save_line(self, line: LineRecord) -> None:
        self.store.put_line(self.sk, line)
        self.hub.publish("line", f"line:{line.line_id}:{line.status}", line.model_dump())

    # ---- ingest ------------------------------------------------------------------------

    async def ingest(self, events: list[dict[str, Any]]) -> dict[str, int]:
        """Validate the whole batch first (all or nothing), then process each event in order."""
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
        async with self._lock:
            for event in events:
                if self.store.add_event(self.sk, event):
                    await self._process(event)
        return {
            "accepted": len(events),
            "last_sequence": self.store.get_state(self.sk).max_sequence,
        }

    async def _process(self, event: dict[str, Any]) -> None:
        self.stats["events"] += 1
        state = apply(self.store.get_state(self.sk), event)
        self.store.put_state(self.sk, state)
        self.hub.publish("state", f"state:{state.revision}", self._state_json(state))
        ctx = self._ctx()
        decision = await self.agents.producer.decide(ctx, event)
        if isinstance(decision, Skip):
            self.stats["skipped"] += 1
            if decision.reason in AUDIT_SKIPPED:
                self._agent(
                    "moment_skipped",
                    self.agents.producer,
                    decision.moment_id,
                    reason=decision.reason,
                )
            return
        self.stats["moments"] += 1
        await self._run_moment(ctx, decision)

    def _state_json(self, state: MatchState) -> dict[str, Any]:
        return {
            "score": state.score,
            "clock_ms": state.event_time_ms,
            "period": state.period,
            "possession": state.possession,
            "revision": state.revision,
        }

    # ---- one moment through the graph --------------------------------------------------

    async def _run_moment(self, ctx: MatchContext, task: ProducerTask) -> None:
        a = self.agents
        claims = await a.analyst.analyse(ctx, task)
        for claim in claims:
            validate(claim)
            self.store.put_claim(
                self.sk,
                claim,
                {
                    "moment_id": task.moment_id,
                    "agent": a.analyst.agent_id,
                    "created_at": _stamp(self._clock()),
                },
            )
            self.stats["claims"] += 1
            self.hub.publish("claim", f"claim:{claim['claim_id']}", claim)
            self._agent(
                "claim_created",
                a.analyst,
                claim["claim_id"],
                metric=claim["metric"],
                value=claim["value"],
                priority=task.priority,
            )
        if not claims:
            return
        drafts = await a.narrator.write(ctx, task, claims)
        for draft in drafts:
            await self._verify_line(ctx, task, claims, draft, attempt=0)

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
        )
        verdict = await a.verifier.check(ctx, draft, claims)
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
        self._agent(action, a.verifier, draft.line_id, checks=[c.name for c in verdict.checks])
        if record.status == "verified":
            self.stats["verified"] += 1
            if self.config.approval_mode == "auto":
                self._approve(record, "agent", a.producer.agent_id)

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
        target = "analyst" if verdict.reason_code in NUMBER_OR_SOURCE else "narrator"
        self._agent(
            "line_repair_requested",
            a.producer,
            draft.line_id,
            target=target,
            reason_code=verdict.reason_code,
        )
        self.stats["repaired"] += 1
        if target == "analyst":
            fresh = self._ctx()
            claims = await a.analyst.analyse(fresh, task, repair=True)
            for claim in claims:
                validate(claim)
                self.store.put_claim(
                    self.sk,
                    claim,
                    {
                        "moment_id": task.moment_id,
                        "agent": a.analyst.agent_id,
                        "created_at": _stamp(self._clock()),
                    },
                )
                self.hub.publish("claim", f"claim:{claim['claim_id']}", claim)
                self._agent(
                    "claim_created",
                    a.analyst,
                    claim["claim_id"],
                    metric=claim["metric"],
                    value=claim["value"],
                    repair=True,
                )
            ctx = fresh
        redrafts = await a.narrator.write(ctx, task, claims, attempt=1)
        replacement = next((d for d in redrafts if d.persona == draft.persona), None)
        if replacement is None:
            return
        await self._verify_line(ctx, task, claims, replacement, attempt=1, repair_of=draft.line_id)

    # ---- approval and publication ------------------------------------------------------

    def _approve(self, line: LineRecord, actor_kind: str, actor_id: str) -> None:
        line.status = "approved"
        line.decided_by = actor_id
        self._save_line(line)
        details: dict[str, Any] = {"persona": line.persona}
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

    async def approve(self, line_id: str, actor_id: str = "producer") -> LineRecord:
        async with self._lock:
            line = self._line(line_id)
            if line.status not in ("verified", "review"):
                raise WorkflowError("not_approvable", f"line is {line.status}")
            self._approve(line, "person", actor_id)
            return line

    async def kill(self, line_id: str, reason: str, actor_id: str = "producer") -> LineRecord:
        async with self._lock:
            line = self._line(line_id)
            if line.status in ("published", "killed"):
                raise WorkflowError("not_approvable", f"line is {line.status}")
            line.status = "killed"
            line.decided_by = actor_id
            self._save_line(line)
            self._audit("person", actor_id, "line_killed", line_id, {"reason": reason[:200]})
            return line

    async def edit(
        self, line_id: str, text: str, actor_id: str = "producer"
    ) -> tuple[LineRecord, Verdict]:
        """Replace the text, run the Verifier again, and approve only if it passes."""
        async with self._lock:
            line = self._line(line_id)
            if line.status in ("published", "killed"):
                raise WorkflowError("not_approvable", f"line is {line.status}")
            ctx = self._ctx()
            claims = [self.store.get_claim(self.sk, c)["packet"] for c in line.claim_ids]  # type: ignore[index]
            draft = DraftLine(
                line_id=line_id,
                claim_ids=tuple(line.claim_ids),
                persona=line.persona,
                text=text,
                max_chars=280,
            )
            verdict = await self.agents.verifier.check(ctx, draft, claims)
            if verdict.verdict == "rejected":
                return line, verdict
            line.text, line.checks, line.reason_code = text, list(verdict.checks), None
            line.origin = "template"
            self._audit("person", actor_id, "line_edited", line_id, {"persona": line.persona})
            line.status = "verified"
            self._approve(line, "person", actor_id)
            return line, verdict
