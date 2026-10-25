"""CREW-5.2 live arms: the scoreboard's three arms with the model behind each agent, each arm under
its own call budget.

A live arm is its rules twin with the model in place (ADR-0014). Every model call goes through
``BudgetedClient``: a call past the budget is refused, and a call the model fails is counted. The
rules twin answers both, so the arm still airs lines, and it reports how many calls it sent and how
many fell back. A live run is recorded once by ``scripts/scoreboard_live.py``; the scoreboard route
shows its arms as precomputed, labelled with the run id, and never calls a model (docs/architecture/
16, section 4.1).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping

from .grading import (
    ARMS,
    PERSONAS,
    SEED_RATE,
    SeededAnalyst,
    UncheckedVerifier,
    _crew,
    _pinned_clock,
    _report,
    _single,
    corrupt_first,
    seeded_set,
)
from .live.analyst import LiveAnalyst
from .live.client import ModelClient
from .live.narrator import LiveNarrator
from .live.producer import LiveProducer
from .live.verifier import LiveVerifier
from .messages import ProducerTask
from .resilience import ModelError, ResilientAgent
from .rules import AnalystRules, NarratorRules, ProducerRules, VerifierRules
from .rules.analyst import ClaimResult
from .workflow import AgentSet

RUN_KIND = "crew_live_run"


@dataclass
class CallBudget:
    """One arm's model calls. ``attempted`` calls were sent; ``refused`` were past the cap and never
    sent; ``failed`` were sent and raised. Both refused and failed calls fall back to the rules."""

    max_calls: int
    attempted: int = 0
    refused: int = 0
    failed: int = 0


class BudgetedClient:
    """A model client that refuses calls past its budget and counts the ones that fail."""

    def __init__(self, inner: ModelClient, budget: CallBudget) -> None:
        self._inner = inner
        self.budget = budget

    async def complete(
        self,
        system: str,
        user: str,
        schema: dict[str, Any],
        *,
        temperature: float = 0.1,
        max_tokens: int = 400,
    ) -> dict[str, Any]:
        if self.budget.attempted >= self.budget.max_calls:
            self.budget.refused += 1
            raise ModelError("scoreboard call budget spent")
        self.budget.attempted += 1
        try:
            return await self._inner.complete(
                system, user, schema, temperature=temperature, max_tokens=max_tokens
            )
        except Exception:
            self.budget.failed += 1
            raise


class _LiveSeededAnalyst:
    """The live Analyst with the seeded wrong claims, as ``SeededAnalyst`` seeds the rules one."""

    mode = "live"
    agent_id = "analyst"

    def __init__(self, live: LiveAnalyst, seeded: frozenset[str]) -> None:
        self._live = live
        self._seeded = seeded

    async def analyse(
        self, ctx: Any, task: ProducerTask, *, repair: bool = False
    ) -> list[ClaimResult]:
        results = await self._live.analyse(ctx, task, repair=repair)
        return corrupt_first(results, task, self._seeded, repair)


def _live_analyst(model: ModelClient, seeded: frozenset[str]) -> ResilientAgent:
    rules = SeededAnalyst(seeded)  # the fallback: the same seeded claims, from the rules
    return ResilientAgent(_LiveSeededAnalyst(LiveAnalyst(model, AnalystRules()), seeded), rules)


def _live_narrator(model: ModelClient) -> ResilientAgent:
    return ResilientAgent(LiveNarrator(model), NarratorRules())


def _live_crew(model: ModelClient, seeded: frozenset[str], *, unchecked: bool) -> AgentSet:
    """Every agent on the model, every moment (no quiet-moment skip: an arm is the whole crew)."""
    verifier = (
        UncheckedVerifier() if unchecked else ResilientAgent(LiveVerifier(model), VerifierRules())
    )
    return AgentSet(
        producer=LiveProducer(model, ProducerRules(PERSONAS)),
        analyst=_live_analyst(model, seeded),
        narrator=_live_narrator(model),
        verifier=verifier,
    )


def _live_arm(
    match: Mapping[str, Any],
    key: str,
    *,
    client: ModelClient,
    max_calls: int,
    chosen: frozenset[str],
    seed: int,
    seeded_claims: frozenset[str],
    clock: Any,
) -> dict[str, Any]:
    budget = CallBudget(max_calls)
    model = BudgetedClient(client, budget)
    start = time.perf_counter()
    if key == "single_agent":
        run = asyncio.run(
            _single(
                match,
                chosen,
                ledger=_Unused(),
                analyst=_live_analyst(model, chosen),
                narrator=_live_narrator(model),
            )
        )
    else:
        agents = _live_crew(model, chosen, unchecked=key == "crew_no_verifier")
        run = asyncio.run(
            _crew(
                match,
                chosen,
                unchecked=key == "crew_no_verifier",
                ledger=_Unused(),
                clock=clock,
                agents=agents,
            )
        )
    total = round((time.perf_counter() - start) * 1000, 3)
    run["model_calls"] = budget.attempted
    arm = _report(key, run, match, seed, seeded_claims, mode="live")
    arm["latency_ms"]["total"] = total
    arm["cost"] = {
        **arm["cost"],
        "model_calls": budget.attempted,
        "model_errors": budget.failed,
        "budget_refused": budget.refused,
        "max_calls": max_calls,
        "basis": "agent calls sent to the model; refused and failed calls fell back to the rules. "
        "No price applied here.",
    }
    return arm


class _Unused:
    """The live arms count calls on their budget, so the rules ledger is never written."""

    calls = 0


def live_run(
    match: Mapping[str, Any],
    *,
    client: ModelClient,
    max_calls: int,
    seed: int = 2026,
    rate: float = SEED_RATE,
    run_date: str | None = None,
) -> dict[str, Any]:
    """The three arms on the model, each with its own budget of ``max_calls``. Returns the run
    record a scoreboard reads as precomputed arms."""
    if max_calls < 1:
        raise ValueError("a live run needs a call budget of at least one call per arm")
    as_of = run_date or datetime.now(UTC).date().isoformat()
    clock = _pinned_clock(as_of)
    chosen, seeded_claims = seeded_set(match, seed=seed, rate=rate, clock=clock)
    arms = {
        key: _live_arm(
            match,
            key,
            client=client,
            max_calls=max_calls,
            chosen=chosen,
            seed=seed,
            seeded_claims=seeded_claims,
            clock=clock,
        )
        for key in ARMS
    }
    match_id = match["roster"]["stream"]["match_id"]
    run_id = hashlib.sha256(
        json.dumps(
            {
                "match": match_id,
                "run_date": as_of,
                "seed": seed,
                "rate": rate,
                "arms": [arm["run_id"] for arm in arms.values()],
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()[:12]
    return {
        "kind": RUN_KIND,
        "run_id": run_id,
        "match_id": match_id,
        "run_date": as_of,
        "seed": seed,
        "seed_rate": rate,
        "max_calls_per_arm": max_calls,
        "arms": arms,
    }


def load_live_run(path: str, *, match_id: str) -> dict[str, dict[str, Any]] | None:
    """The recorded arms of a live run for this match, or None when there is no such run."""
    file = Path(path)
    if not file.is_file():
        return None
    record = json.loads(file.read_text())
    if record.get("kind") != RUN_KIND or record.get("match_id") != match_id:
        return None
    return record["arms"]
