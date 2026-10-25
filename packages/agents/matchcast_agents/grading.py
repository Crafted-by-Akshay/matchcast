"""CREW-5.1 and CREW-5.2: grade every aired line against the engine log, and compare three arms.

``grade_line`` is a pure function. It takes a line's text (or a LineRecord), the claims it was
built from and the match's events, and returns each claim's engine value, each number the line
states, the names it states that are not in the roster, and a verdict: correct, incorrect or
unverifiable. It recounts from the events (``verify.checks.recompute``), never from agent state,
and it never calls a model. A claim with no engine truth (a history fact) is unverifiable, never
correct.

``scoreboard`` runs three arms on one match and reports accuracy, catch rate, lines aired,
latency and model calls. The arms are rules-mode only, so they run live on each request:

- full_crew: the workflow with its Verifier (the production path).
- single_agent: one pass per shot or goal, the claims then the line, no Verifier, no Producer
  routing. It is given every shot and goal, so its line count differs from the crew's by design.
- crew_no_verifier: the same workflow with the Verifier check bypassed.

Model-driven arms cost model calls, so they are never called here. They enter only as
``precomputed`` arms from a recorded run, labelled with that run's id.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import random
import re
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

from . import history_metrics as history
from .context import MatchContext
from .messages import DraftLine, LineRecord, ProducerTask, Verdict
from .metrics_spec import METRIC_UNITS, TOLERANCE
from .rules import AnalystRules, NarratorRules, ProducerRules, VerifierRules
from .rules.analyst import ClaimResult
from .state import MatchState, apply
from .verify.checks import EPSILON, OPENERS, extract_names, extract_numbers, recompute
from .workflow import AgentSet, MatchWorkflow, WorkflowConfig

AIRED = ("verified", "approved", "published")  # the statuses a viewer sees (04-agents.md)
MOMENT_TYPES = ("shot", "goal")
PERSONAS = ("casual", "analyst")
MODEL_METHODS = frozenset({"decide", "analyse", "write", "check"})
# metrics the event log does not count (the Vision metrics): a claim on one is unverifiable
NOT_IN_LOG = frozenset({"vision_passes", "vision_precision"})
SEED_RATE = 0.25  # the share of aired shot and goal moments that get a seeded wrong claim
ARMS = ("full_crew", "single_agent", "crew_no_verifier")
LABELS = {
    "full_crew": "Full crew (workflow with Verifier, rules mode)",
    "single_agent": "Single agent (one pass per shot or goal, no Verifier, no routing)",
    "crew_no_verifier": "Crew without Verifier (workflow, Verifier check bypassed)",
}
METHOD = (
    "Same match and the same seeded wrong claims in all arms: the first claim of a seeded shot or "
    "goal moment is one too high, except on the repair. Each aired line is graded by grade_line "
    "against the event log. Accuracy is wrong numbers aired over numbers aired. Catch rate is the "
    "seeded wrong claims that no aired line states as written, over the seeded wrong claims. "
    "Latency is measured wall time per shot or goal on this machine, not a model's. The single "
    "agent skips the workflow's store, audit and validation, so its latency is a floor, not a "
    "like-for-like figure. Cost is the count of agent calls a model served; rules twins make "
    "none, so no price is applied. The single agent also skips Content Safety, which the crew "
    "arms run."
)


# ---- CREW-5.1: grade one line -------------------------------------------------------------


def _engine_value(events: Sequence[Mapping[str, Any]], claim: Mapping[str, Any]) -> float | None:
    """The engine's own count for the claim's metric up to its evidence, or None when the log
    cannot count it (a history fact)."""
    metric = claim["metric"]
    name = metric.partition(":")[0]
    if name in history.HISTORY_METRICS or name in NOT_IN_LOG or name not in METRIC_UNITS:
        return None  # not counted from the log: a history fact, a Vision metric, an unknown metric
    upto = claim["max_evidence_sequence"]
    if not any(e["stream_sequence"] == upto for e in events):
        return None  # the log does not hold the claim's evidence: a count up to it is a guess
    return float(recompute(events, metric, upto))


def _attributed_numbers(text: str, clubs: Mapping[str, str]) -> list[tuple[str, float]]:
    """Each number written straight after a club's name, with that club's side. The Verifier's
    score attribution uses the same rule, but this grader does not import it, so the two checks
    stay independent: "Harbour United 2" is a claim about the away side."""
    found: list[tuple[str, float]] = []
    for side, club in clubs.items():
        pattern = rf"(?<!\w){re.escape(club)}\s+(\d+(?:\.\d+)?)(?!\w)(?!\.\d)"
        found += [(side, float(m.group(1))) for m in re.finditer(pattern, text)]
    return found


def _number_row(
    value: float, pool: list[tuple[str, float, float, str, str]], used: set[int], side: str | None
) -> dict[str, Any]:
    """Match one stated number to a pool entry: the same side when ``side`` is given, else any."""
    match = next(
        (
            i
            for i, (_, cand, tol, _, claim_side) in enumerate(pool)
            if i not in used
            and (side is None or claim_side == side)
            and abs(value - cand) <= tol + EPSILON
        ),
        None,
    )
    if match is None:
        return {"line_value": value, "verdict": "incorrect", "matched_claim_id": None}
    used.add(match)
    return {"line_value": value, "verdict": pool[match][0], "matched_claim_id": pool[match][3]}


def _unknown_names(text: str, allowed: set[str]) -> list[str]:
    """Capitalised runs that are not a roster or club name. A capitalised commentary opener in
    front of one ("Strong Harbour United pressure") is that name, as in the Verifier's check 4."""
    unknown = []
    for name in extract_names(text):
        if name.casefold() in allowed:
            continue
        opener, _, rest = name.partition(" ")
        if opener.casefold() in OPENERS and rest.casefold() in allowed:
            continue
        unknown.append(name)
    return list(dict.fromkeys(unknown))


def grade_line(
    line: LineRecord | str,
    claims: Sequence[Mapping[str, Any]],
    events: Sequence[Mapping[str, Any]],
    allowed_names: Iterable[str],
    *,
    line_id: str | None = None,
    clubs: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Grade one line against the log. ``claims`` are the claim packets the line was built from,
    ``allowed_names`` the roster and club names of the match; ``clubs`` maps each side to its club
    so a number after a club's name is judged against that side's claims."""
    text = line.text if isinstance(line, LineRecord) else line
    if isinstance(line, LineRecord):
        line_id = line.line_id
    allowed = {n.casefold() for n in allowed_names}

    claim_rows: list[dict[str, Any]] = []
    # what a stated number may match: engine truth first, then a claim with no truth (unverifiable)
    pool: list[tuple[str, float, float, str, str]] = []
    for c in claims:
        engine = _engine_value(events, c)
        tol = TOLERANCE.get(c["units"], 0.0)
        side = c["metric"].partition(":")[2]
        if engine is None:
            verdict = "unverifiable"
            pool.append(("unverifiable", float(c["value"]), tol, c["claim_id"], side))
        else:
            verdict = "correct" if abs(engine - c["value"]) <= tol + EPSILON else "incorrect"
            pool.append(("correct", engine, tol, c["claim_id"], side))
        claim_rows.append(
            {
                "claim_id": c["claim_id"],
                "metric": c["metric"],
                "claim_value": float(c["value"]),
                "engine_value": engine,
                "verdict": verdict,
            }
        )
    pool.sort(key=lambda p: p[0] != "correct")  # truth before claims with no truth

    used: set[int] = set()
    attributed = _attributed_numbers(text, clubs or {})
    remaining = extract_numbers(text)
    for _side, value in attributed:
        if value in remaining:
            remaining.remove(value)
    number_rows = [_number_row(value, pool, used, side) for side, value in attributed]
    number_rows += [_number_row(value, pool, used, None) for value in remaining]

    unknown = _unknown_names(text, allowed)
    wrong_claim = any(c["verdict"] == "incorrect" for c in claim_rows)
    wrong_number = any(n["verdict"] == "incorrect" for n in number_rows)
    unverified = (
        not claim_rows
        or any(c["verdict"] == "unverifiable" for c in claim_rows)
        or any(n["verdict"] == "unverifiable" for n in number_rows)
    )
    if wrong_claim or wrong_number or unknown:
        verdict = "incorrect"
    elif unverified:
        verdict = "unverifiable"
    else:
        verdict = "correct"
    return {
        "line_id": line_id,
        "verdict": verdict,
        "claims": claim_rows,
        "numbers": number_rows,
        "unknown_names": unknown,
        "numbers_stated": len(number_rows),
        "wrong_numbers": sum(n["verdict"] == "incorrect" for n in number_rows),
    }


# ---- CREW-5.2: the three arms ---------------------------------------------------------------


@dataclass
class _Ledger:
    calls: int = 0  # agent calls served by a model; a rules twin adds nothing


class _Counted:
    """Wraps an agent and counts the calls a model serves. Other attributes pass through."""

    def __init__(self, inner: Any, ledger: _Ledger) -> None:
        self._inner = inner
        self._ledger = ledger

    @property
    def mode(self) -> str:
        return getattr(self._inner, "mode", "live")

    def __getattr__(self, name: str) -> Any:
        attr = getattr(self._inner, name)
        if name not in MODEL_METHODS:
            return attr
        inner, ledger = self._inner, self._ledger

        async def call(*args: Any, **kwargs: Any) -> Any:
            if getattr(inner, "mode", "live") != "rules":
                ledger.calls += 1
            return await attr(*args, **kwargs)

        return call


class SeededAnalyst:
    """AnalystRules with seeded wrong claims: the first claim of each seeded moment is one too
    high. A repair (``repair=True``) is not corrupted, so the Verifier's repair can fix it."""

    def __init__(self, seeded: frozenset[str]) -> None:
        self._inner = AnalystRules()
        self._seeded = seeded

    @property
    def mode(self) -> str:
        return self._inner.mode

    @property
    def agent_id(self) -> str:
        return self._inner.agent_id

    async def analyse(
        self,
        ctx: MatchContext,
        task: ProducerTask,
        *,
        repair: bool = False,
        metrics: list[str] | None = None,
    ) -> list[ClaimResult]:
        results = await self._inner.analyse(ctx, task, repair=repair, metrics=metrics)
        if repair or task.moment_id not in self._seeded or not results:
            return results
        first = results[0]
        wrong = {**first.packet, "value": first.packet["value"] + 1}
        seeded = ClaimResult(
            packet=wrong, tool_call_ids=first.tool_call_ids, formula_inputs=first.formula_inputs
        )
        return [seeded, *results[1:]]


class UncheckedVerifier:
    """The Verifier with its check bypassed: every draft passes. Content Safety still runs."""

    mode = "rules"
    agent_id = "verifier"

    async def check(
        self, ctx: MatchContext, line: DraftLine, claims: list[dict[str, Any]]
    ) -> Verdict:
        return Verdict(line_id=line.line_id, verdict="verified", checks=())


def _is_moment(event: Mapping[str, Any]) -> bool:
    return event["payload"]["type"] in MOMENT_TYPES


def _moment_id(event: Mapping[str, Any]) -> str:
    return f"m-{event['event_id']}"


def _pinned_clock(run_date: str) -> Callable[[], datetime]:
    """The workflow's clock on one run date. The history facts a run cuts at its date (the
    national-team results up to it) are then the same however many days later it runs."""
    pinned = datetime.combine(date.fromisoformat(run_date), datetime.min.time(), tzinfo=UTC)
    return lambda: pinned


async def _crew(
    match: Mapping[str, Any],
    seeded: frozenset[str],
    *,
    unchecked: bool,
    ledger: _Ledger,
    clock: Callable[[], datetime],
) -> dict[str, Any]:
    """The workflow over every event, timed per shot or goal. Lines are the aired ones."""
    verifier = UncheckedVerifier() if unchecked else VerifierRules()
    flow = MatchWorkflow(
        stream=match["roster"]["stream"],
        roster=match["roster"],
        names=match["names"],
        clubs=match["teams"],
        agents=AgentSet(
            producer=_Counted(ProducerRules(PERSONAS), ledger),
            analyst=_Counted(SeededAnalyst(seeded), ledger),
            narrator=_Counted(NarratorRules(), ledger),
            verifier=_Counted(verifier, ledger),
        ),
        config=WorkflowConfig(approval_mode="auto", personas=PERSONAS),
        clock=clock,
    )
    latencies: list[float] = []
    for event in match["events"]:
        start = time.perf_counter()
        await flow.ingest([event])
        if _is_moment(event):
            latencies.append((time.perf_counter() - start) * 1000)
    lines = []
    for line in flow.store.lines(flow.sk):
        if line.status in AIRED:
            claims = [flow.store.get_claim(flow.sk, c)["packet"] for c in line.claim_ids]
            lines.append((line.text, line.line_id, line.moment_id, claims))
    return {"lines": lines, "latency_ms": latencies, "model_calls": ledger.calls}


async def _single(
    match: Mapping[str, Any], seeded: frozenset[str], *, ledger: _Ledger
) -> dict[str, Any]:
    """One pass per shot or goal: the rules Analyst's claims, then the line written from them."""
    analyst = _Counted(SeededAnalyst(seeded), ledger)
    narrator = _Counted(NarratorRules(), ledger)
    stream = match["roster"]["stream"]
    state, prefix = MatchState(), []
    lines, latencies = [], []
    for event in match["events"]:
        state = apply(state, event)
        prefix.append(event)
        if not _is_moment(event):
            continue
        start = time.perf_counter()
        ctx = MatchContext(
            stream=stream,
            roster=match["roster"],
            names=match["names"],
            clubs=match["teams"],
            state=state,
            events=tuple(prefix),
            personas=PERSONAS,
        )
        kind = event["payload"]["type"]
        on_target = bool(event["payload"].get("on_target"))
        if kind == "goal":
            reason, priority = "goal", 1
        else:  # a shot: on target is the shot line, off target the analyst's colour line
            reason, priority = ("shot_on_target", 2) if on_target else ("colour", 3)
        task = ProducerTask(
            moment_id=_moment_id(event),
            match_id=stream["match_id"],
            event_ids=(event["event_id"],),
            up_to_sequence=event["stream_sequence"],
            priority=priority,
            personas=PERSONAS,
            reason=reason,
        )
        results = await analyst.analyse(ctx, task)
        claims = [r.packet for r in results]
        if claims:
            drafts = await narrator.write(ctx, task, claims)
            lines.extend((d.text, d.line_id, task.moment_id, claims) for d in drafts)
        latencies.append((time.perf_counter() - start) * 1000)
    return {"lines": lines, "latency_ms": latencies, "model_calls": ledger.calls}


def _allowed(match: Mapping[str, Any]) -> set[str]:
    return {n.casefold() for n in (*match["names"].values(), *match["teams"].values())}


def _rate(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


def _percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)  # nearest rank
    return round(ordered[max(0, math.ceil(q * len(ordered)) - 1)], 3)


def _report(
    key: str,
    run: Mapping[str, Any],
    match: Mapping[str, Any],
    seed: int,
    seeded_claims: frozenset[str],
) -> dict[str, Any]:
    events, allowed = match["events"], _allowed(match)
    grades = [
        grade_line(text, claims, events, allowed, line_id=line_id, clubs=match["teams"])
        for text, line_id, _moment, claims in run["lines"]
    ]
    numbers = sum(g["numbers_stated"] for g in grades)
    wrong = sum(g["wrong_numbers"] for g in grades)
    # a wrong claim is in the basis of an aired line (the Verifier's check 3 refuses such a line)
    basis = sorted(
        {c["claim_id"] for g in grades for c in g["claims"] if c["verdict"] == "incorrect"}
    )
    # aired as written: the claim's wrong value is a number the aired line itself states
    stated: set[str] = set()
    for g in grades:
        wrong_here = {n["line_value"] for n in g["numbers"] if n["verdict"] == "incorrect"}
        stated |= {
            c["claim_id"]
            for c in g["claims"]
            if c["verdict"] == "incorrect" and c["claim_value"] in wrong_here
        }
    caught = len(seeded_claims - set(stated))
    lines = len(grades)
    calls = run["model_calls"]
    run_id = hashlib.sha256(
        json.dumps(
            {
                "arm": key,
                "match": match["roster"]["stream"]["match_id"],
                "seed": seed,
                "lines": [(lid, text) for text, lid, _m, _c in run["lines"]],
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()[:12]
    latency = run["latency_ms"]
    return {
        "label": LABELS[key],
        "mode": "rules",
        "run_id": run_id,
        "lines_aired": lines,
        "wrong_lines_aired": sum(g["verdict"] == "incorrect" for g in grades),
        "accuracy": {
            "wrong_numbers_aired": wrong,
            "numbers_aired": numbers,
            "wrong_rate": _rate(wrong, numbers),
        },
        "catch_rate": {
            "caught": caught,
            "seeded": len(seeded_claims),
            "rate": _rate(caught, len(seeded_claims)),
        },
        "latency_ms": {
            "p50": _percentile(latency, 0.5),
            "p95": _percentile(latency, 0.95),
            "total": None,  # filled by the caller with the measured wall time of the arm
            "moments": len(latency),
        },
        "cost": {
            "model_calls": calls,
            "model_calls_per_line": round(calls / lines, 4) if lines else None,
            "basis": "agent calls a model served; no price applied (rules twins make no call)",
        },
        "wrong_claim_ids": basis,
        "wrong_claim_ids_stated": sorted(stated),
    }


def scoreboard(
    match: Mapping[str, Any],
    *,
    seed: int = 2026,
    rate: float = SEED_RATE,
    run_date: str | None = None,
    precomputed: Mapping[str, Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Three rules-mode arms on one match, as a JSON-serialisable dict.

    Pure in its inputs apart from the measured latencies and the run date. It runs the arms
    synchronously, so call it from a worker thread when an event loop is already running.
    ``precomputed`` arms from a recorded model run are shown with their run id and never run here.
    """
    shot_goal = {_moment_id(e): e for e in match["events"] if _is_moment(e)}
    as_of = run_date or datetime.now(UTC).date().isoformat()
    clock = _pinned_clock(as_of)
    # the seeds go only into shot and goal moments the clean crew aired, so every arm has the
    # same population of seeded claims to catch
    clean = asyncio.run(_crew(match, frozenset(), unchecked=False, ledger=_Ledger(), clock=clock))
    aired = sorted({m for _t, _l, m, _c in clean["lines"] if m in shot_goal})
    rng = random.Random(f"{seed}:seeded-claims")
    chosen = frozenset(rng.sample(aired, max(1, round(len(aired) * rate)) if aired else 0))
    seeded_claims = frozenset(f"claim-{m}-1" for m in chosen)

    arms: dict[str, Any] = {}
    for key in ARMS:
        ledger = _Ledger()
        start = time.perf_counter()
        if key == "single_agent":
            run = asyncio.run(_single(match, chosen, ledger=ledger))
        else:
            run = asyncio.run(
                _crew(
                    match,
                    chosen,
                    unchecked=key == "crew_no_verifier",
                    ledger=ledger,
                    clock=clock,
                )
            )
        total = round((time.perf_counter() - start) * 1000, 3)
        arm = _report(key, run, match, seed, seeded_claims)
        arm["latency_ms"]["total"] = total
        arms[key] = arm

    for key, value in (precomputed or {}).items():
        if "run_id" not in value:
            raise ValueError(f"precomputed arm {key} needs the run_id of its recorded run")
        arms[key] = {
            **value,
            "mode": "precomputed",
            "label": f"{value.get('label', key)} (precomputed, run {value['run_id']})",
        }

    crew_wrong = arms["full_crew"]["wrong_lines_aired"]
    no_verifier_wrong = arms["crew_no_verifier"]["wrong_lines_aired"]
    found = no_verifier_wrong > crew_wrong
    note = (
        f"The crew without the Verifier aired {no_verifier_wrong} wrong lines; the full crew "
        f"aired {crew_wrong}."
        if found
        else "No difference was found: the crew without the Verifier aired no more wrong lines "
        "than the full crew."
    )
    return {
        "kind": "crew_ablation_scoreboard",
        "match_id": match["roster"]["stream"]["match_id"],
        "run_date": as_of,
        "seed": seed,
        "seed_rate": rate,
        "moments": len(shot_goal),
        "seeded_wrong_claims": len(seeded_claims),
        "arms": arms,
        "difference": {
            "found": found,
            "crew_no_verifier_wrong_lines": no_verifier_wrong,
            "full_crew_wrong_lines": crew_wrong,
            "note": note,
        },
        "method": METHOD,
    }
