"""CREW-5.2 live arms: the scoreboard's three arms with the model behind each agent, each arm under
its own call budget.

A live arm is its rules twin with the model in place (ADR-0014). Every model call goes through
``BudgetedClient``: a call past the budget is refused, and a call the model fails is counted. The
rules twin answers both, and so it answers any rejected answer or open circuit. Each arm reports
how many calls it sent, how many failed or were refused, and how many agent calls a fallback
answered (mode ``mixed``). A live run is recorded once by ``scripts/scoreboard_live.py``; the
scoreboard route shows its arms beside the rules arms, labelled with the run id, and never calls
a model (docs/architecture/16, section 4.1).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, fields
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping

from .grading import (
    ARMS,
    DEFAULT_SEED,
    MODEL_METHODS,
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
RECORD_KEYS = ("fixture", "run_id", "run_date", "events_sha256")
MAX_CALLS_PER_ARM = 1000  # the recording script's ceiling, enforced here too
log = logging.getLogger(__name__)


@dataclass
class CallBudget:
    """One arm's model calls. ``attempted`` were sent; ``refused`` were past the cap and never
    sent; ``failed`` were sent and raised. Refused and failed calls fall back to the rules."""

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


@dataclass
class _Tally:
    """One arm's agent calls. ``answered_by_rules`` counts the calls a fallback answered."""

    agent_calls: int = 0
    answered_by_rules: int = 0


class _Tallied:
    """Wraps an agent: counts its calls and those a fallback answered. Other attributes pass."""

    def __init__(self, inner: Any, tally: _Tally) -> None:
        self._inner = inner
        self._tally = tally

    @property
    def mode(self) -> str:
        return getattr(self._inner, "mode", "live")

    def __getattr__(self, name: str) -> Any:
        attr = getattr(self._inner, name)
        if name not in MODEL_METHODS:
            return attr
        inner, tally = self._inner, self._tally

        async def call(*args: Any, **kwargs: Any) -> Any:
            result = await attr(*args, **kwargs)
            tally.agent_calls += 1
            if hasattr(inner, "take_fallbacks"):
                taken = inner.take_fallbacks()
                if taken:
                    tally.answered_by_rules += 1
                inner.keep_fallbacks(taken)  # the workflow's audit still reads them
            return result

        return call


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


class _Unused:
    """The live arms count calls on their budget, so the rules ledger is never written."""

    calls = 0


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
    tally = _Tally()
    start = time.perf_counter()
    if key == "single_agent":
        run = asyncio.run(
            _single(
                match,
                chosen,
                ledger=_Unused(),
                analyst=_Tallied(_live_analyst(model, chosen), tally),
                narrator=_Tallied(_live_narrator(model), tally),
            )
        )
    else:
        unchecked = key == "crew_no_verifier"
        crew = _live_crew(model, chosen, unchecked=unchecked)
        agents = AgentSet(**{f.name: _Tallied(getattr(crew, f.name), tally) for f in fields(crew)})
        run = asyncio.run(
            _crew(
                match,
                chosen,
                unchecked=unchecked,
                ledger=_Unused(),
                clock=clock,
                agents=agents,
            )
        )
    total = round((time.perf_counter() - start) * 1000, 3)
    run["model_calls"] = budget.attempted
    mode = "mixed" if tally.answered_by_rules else "live"
    arm = _report(key, run, match, seed, seeded_claims, mode=mode)
    arm["latency_ms"]["total"] = total
    arm["cost"] = {
        **arm["cost"],
        "model_calls": budget.attempted,
        "model_errors": budget.failed,
        "budget_refused": budget.refused,
        "agent_calls": tally.agent_calls,  # every agent call, rules-only ones included
        "answered_by_rules": tally.answered_by_rules,
        "max_calls": max_calls,
        "basis": "model calls through the budget, one per complete() call (the SDK may retry one "
        "request inside a call). Refused and failed calls, rejected answers and open circuits fell "
        "back to the rules (answered_by_rules). No price applied here.",
    }
    return arm


def events_digest(events: list[Mapping[str, Any]]) -> str:
    """A sha256 of the event log, independent of key order: which events a recording ran on."""
    text = json.dumps(events, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode()).hexdigest()


def live_run(
    match: Mapping[str, Any],
    *,
    client: ModelClient,
    max_calls: int,
    fixture: str,
    seed: int = DEFAULT_SEED,
    rate: float = SEED_RATE,
    run_date: str | None = None,
    on_arm: Callable[[str, dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """The three arms on the model, each with its own budget of ``max_calls``. Returns the run
    record the scoreboard route shows beside the rules arms. ``fixture`` names the fixture the
    match is (its id in the fixture list, such as N001); it is required so a recording is never
    labelled with a fixture it did not run on. ``on_arm`` is called with each arm as it completes,
    so a caller can keep a paid arm even if a later one fails."""
    if not 1 <= max_calls <= MAX_CALLS_PER_ARM:
        raise ValueError(f"a live run needs 1 to {MAX_CALLS_PER_ARM} model calls per arm")
    as_of = run_date or datetime.now(UTC).date().isoformat()
    clock = _pinned_clock(as_of)
    chosen, seeded_claims = seeded_set(match, seed=seed, rate=rate, clock=clock)
    arms: dict[str, dict[str, Any]] = {}
    for key in ARMS:
        arms[key] = _live_arm(
            match,
            key,
            client=client,
            max_calls=max_calls,
            chosen=chosen,
            seed=seed,
            seeded_claims=seeded_claims,
            clock=clock,
        )
        if on_arm is not None:
            on_arm(key, arms[key])
    match_id = match["roster"]["stream"]["match_id"]
    run_id = hashlib.sha256(
        json.dumps(
            {
                "match": match_id,
                "fixture": fixture,
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
        "fixture": fixture,
        "teams": sorted(match["teams"].values()),
        "events_sha256": events_digest(match["events"]),
        "match_id": match_id,  # the match it was recorded from; the route does not check it
        "run_date": as_of,
        "seed": seed,
        "seed_rate": rate,
        "max_calls_per_arm": max_calls,
        "arms": arms,
    }


def load_live_run(
    path: str, *, teams: list[str], seed: int = DEFAULT_SEED, rate: float = SEED_RATE
) -> dict[str, Any] | None:
    """The recording of this fixture, for these teams, seed and rate, or None when there is none.
    A match is judged by its teams, not its id: judges' sessions get fresh ids. A file that does
    not parse, or an arm that is not an object with a run id, is logged and treated as no run."""
    file = Path(path)
    try:
        record = json.loads(file.read_text())
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        log.warning(
            "scoreboard live run %s does not parse or cannot be read; showing rules arms", path
        )
        return None
    if not isinstance(record, dict) or record.get("kind") != RUN_KIND:
        return None
    if record.get("teams") != sorted(teams) or record.get("seed") != seed:
        return None
    if record.get("seed_rate") != rate:
        return None
    if not all(key in record for key in RECORD_KEYS):  # the route reads each of these
        log.warning("scoreboard live run %s is missing fields; showing rules arms", path)
        return None
    if not isinstance(record["run_id"], str) or not record["run_id"]:
        log.warning("scoreboard live run %s has no run id; showing rules arms", path)
        return None
    arms = record.get("arms")
    if not isinstance(arms, dict) or not arms:
        return None
    if not all(
        isinstance(arm, dict) and isinstance(arm.get("run_id"), str) and arm["run_id"]
        for arm in arms.values()
    ):
        log.warning("scoreboard live run %s has an arm without a run id; showing rules arms", path)
        return None
    return record
