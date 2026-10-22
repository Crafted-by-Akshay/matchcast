"""Pure checks on a line and its claims. Each returns one Check; the first failing one decides."""

import re
from typing import Any

from ..context import MatchContext
from ..messages import Check, DraftLine, ReasonCode
from ..state import counted

FRESH_REVISIONS = 5
FRESH_MS = 30_000
TOLERANCE = {"count": 0.0, "ratio": 0.01, "m": 0.5, "m/s": 0.5, "s": 0.5, "ms": 500.0}
MAX_NUMBERS = {"casual": 1, "analyst": 6, "broadcast": 2}
_NUMBER = re.compile(r"(?<![\w.])\d+(?:\.\d+)?(?![\w])")
# two or more capitalised words in a row, e.g. "Arlo Dunne" or "Northgate FC"
_NAME = re.compile(r"\b[A-Z][\w'’-]+(?:\s+(?:[A-Z][\w'’-]+|FC|United))+")


def extract_numbers(text: str) -> list[float]:
    return [float(m) for m in _NUMBER.findall(text)]


def extract_names(text: str) -> list[str]:
    return [m.group(0) for m in _NAME.finditer(text)]


def recompute(
    events: tuple[dict[str, Any], ...] | list[dict[str, Any]], metric: str, upto: int
) -> int:
    """Count a metric straight from the stored events up to a sequence; never from agent state."""
    name, team = metric.split(":", 1)
    total = 0
    for event in events:
        if event["stream_sequence"] > upto or event["payload"]["type"] in (
            "correction",
            "retraction",
        ):
            continue
        total += sum(1 for m, t in counted(event["payload"]) if m == name and t == team)
    return total


def check_sources(ctx: MatchContext, claims: list[dict[str, Any]]) -> Check:
    known = {(e["event_id"], e["stream_sequence"]) for e in ctx.events}
    top = max((e["stream_sequence"] for e in ctx.events), default=0)
    for claim in claims:
        src = claim["source"]
        if src["type"] == "events":
            bad = [
                r["event_id"]
                for r in src["events"]
                if (r["event_id"], r["stream_sequence"]) not in known
            ]
            if bad:
                return Check(name="sources", passed=False, detail=f"unknown event {bad[0]}")
        elif src["to_stream_sequence"] > top:
            return Check(
                name="sources", passed=False, detail="interval ends after the stored events"
            )
    return Check(name="sources", passed=True, detail="every source event exists")


def check_freshness(ctx: MatchContext, claims: list[dict[str, Any]]) -> Check:
    for claim in claims:
        snap = claim["snapshot"]
        if ctx.state.revision - snap["state_revision"] > FRESH_REVISIONS:
            return Check(
                name="freshness", passed=False, detail="claim is more than 5 revisions old"
            )
        if ctx.state.event_time_ms - snap["event_time_ms"] > FRESH_MS:
            return Check(name="freshness", passed=False, detail="claim is more than 30 s old")
    return Check(name="freshness", passed=True, detail="claims are current")


def check_numbers(ctx: MatchContext, line: DraftLine, claims: list[dict[str, Any]]) -> Check:
    for claim in claims:
        expected = recompute(ctx.events, claim["metric"], claim["max_evidence_sequence"])
        if abs(expected - claim["value"]) > TOLERANCE[claim["units"]]:
            return Check(
                name="numbers",
                passed=False,
                detail=(
                    f"{claim['metric']} is {claim['value']} in the claim but {expected} in the log"
                ),
            )
    allowed = {float(c["value"]) for c in claims}
    stray = [n for n in extract_numbers(line.text) if n not in allowed]
    if stray:
        return Check(name="numbers", passed=False, detail=f"{stray[0]:g} is not in any claim")
    return Check(
        name="numbers", passed=True, detail="claims recomputed from the log; line numbers match"
    )


def check_names(ctx: MatchContext, line: DraftLine) -> Check:
    for name in extract_names(line.text):
        if name.casefold() not in ctx.allowed_names:
            return Check(name="names", passed=False, detail=f"{name} is not in this match's roster")
    return Check(name="names", passed=True, detail="every name is in the roster")


def check_persona(line: DraftLine) -> Check:
    if len(line.text) > line.max_chars:
        return Check(
            name="persona", passed=False, detail=f"{len(line.text)} chars; limit {line.max_chars}"
        )
    if len(extract_numbers(line.text)) > MAX_NUMBERS[line.persona]:
        return Check(name="persona", passed=False, detail=f"too many numbers for {line.persona}")
    return Check(name="persona", passed=True, detail="within persona limits")


REASON: dict[str, ReasonCode] = {
    "sources": "unknown_source",
    "freshness": "stale_state",
    "numbers": "number_mismatch",
    "names": "unknown_player",
    "persona": "length_exceeded",
}


def run_checks(ctx: MatchContext, line: DraftLine, claims: list[dict[str, Any]]) -> list[Check]:
    return [
        check_sources(ctx, claims),
        check_freshness(ctx, claims),
        check_numbers(ctx, line, claims),
        check_names(ctx, line),
        check_persona(line),
    ]
