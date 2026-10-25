"""The specialist contract: what the Showrunner asks for and what a specialist hands back.

A specialist reads the match through its context and never writes a line. Every finding carries the
event ids (or history row ids) its numbers came from, so the Verifier can recount each one.
"""

from dataclasses import dataclass
from typing import Literal, Protocol

from ..context import MatchContext

Status = Literal["ok", "no_data", "budget_exhausted", "failed"]


@dataclass(frozen=True)
class SpawnRequest:
    name: str  # the specialist to run: "rhythm", "history", ...
    moment_id: str
    objective: str
    token_budget: int  # 0 for a deterministic specialist that makes no model call


@dataclass(frozen=True)
class Finding:
    text: str
    figures: dict[str, float]  # every number in text, by name, so each can be recounted
    evidence_ids: tuple[str, ...]


@dataclass(frozen=True)
class SpecialistReport:
    name: str
    moment_id: str
    status: Status
    findings: tuple[Finding, ...] = ()
    why: str | None = None  # one line for the why-this-matters, when the specialist has one


class Specialist(Protocol):
    name: str

    async def run(self, ctx: MatchContext, request: SpawnRequest) -> SpecialistReport: ...
