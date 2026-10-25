"""Typed packets handed between workflow executors (docs/architecture/04-agents.md §4)."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from .personas import PATTERN

Persona = Annotated[str, StringConstraints(pattern=PATTERN)]
Priority = Literal[1, 2, 3]
VerdictName = Literal["verified", "review", "rejected"]
ReasonCode = Literal[
    "number_mismatch",
    "unknown_player",
    "unknown_source",
    "stale_state",
    "unsupported_statement",
    "unsafe_content",
    "length_exceeded",
    "citation_missing",
]
SkipReason = Literal["quiet_play", "rate_limited", "duplicate_moment", "low_score", "model_skip"]
LineStatus = Literal[
    "drafted",
    "verifying",
    "verified",
    "review",
    "rejected",
    "repairing",
    "abstained",
    "approved",
    "killed",
    "published",
]


class Packet(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ProducerTask(Packet):
    moment_id: str
    match_id: str
    event_ids: tuple[str, ...]
    up_to_sequence: int
    priority: Priority
    personas: tuple[Persona, ...]
    deadline_ms: int = 20_000
    reason: str
    routed_by: Literal["rules", "model"] = "rules"
    why: str = ""  # the model's one-line reason for this route, empty for rules
    call_stats_desk: bool = False  # the model asked for the Stats Desk on a non-priority-1 moment


class Skip(Packet):
    moment_id: str
    reason: SkipReason
    why: str = ""  # the model's one-line reason for a model_skip, for the audit trail


class DraftLine(Packet):
    line_id: str
    claim_ids: tuple[str, ...]
    persona: Persona
    text: str
    max_chars: int
    origin: Literal["template", "model"] = "template"


class Check(Packet):
    name: str
    passed: bool
    detail: str


class Verdict(Packet):
    line_id: str
    verdict: VerdictName
    reason_code: ReasonCode | None = None
    checks: tuple[Check, ...] = ()


class RepairRequest(Packet):
    line_id: str
    target: Literal["analyst", "narrator"]
    verdict: Verdict
    attempt: Literal[1] = 1


class LineRecord(BaseModel):
    """A stored line: the Narrator's text for one persona plus its verification state."""

    line_id: str
    moment_id: str
    claim_ids: list[str]
    persona: Persona
    text: str
    status: LineStatus
    reason_code: ReasonCode | None = None
    checks: list[Check] = Field(default_factory=list)
    repair_of: str | None = None
    created_at: str
    decided_by: str | None = None
    origin: Literal["template", "model"] = "template"
    escalated: bool = False  # a repair failed on a checkable fact and a person must decide
    snapshot_revision: int
