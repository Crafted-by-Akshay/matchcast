"""Pure checks on a line and its claims. Each returns one Check; the first failing one decides."""

import re
from collections import Counter
from typing import Any

from ..context import MatchContext
from ..messages import Check, DraftLine, ReasonCode
from ..metrics_spec import METRIC_UNITS, TOLERANCE, derivation_version
from ..personas import max_numbers
from ..state import counted
from ..vision import engine_count
from ..xg import team_xg

FRESH_REVISIONS = 5
FRESH_MS = 30_000
EPSILON = 1e-9  # float noise: abs(0.35 - 0.34) is 0.010000000000000009
_NUMBER = re.compile(r"(?<![\w.])\d+(?:\.\d+)?(?![\w])")
# two or more capitalised words in a row, e.g. "Arlo Dunne" or "Northgate FC"
_NAME = re.compile(r"\b[A-Z][\w'’-]+(?:\s+(?:[A-Z][\w'’-]+|FC|United))+")


def extract_numbers(text: str) -> list[float]:
    return [float(m) for m in _NUMBER.findall(text)]


_POSSESSIVE = re.compile(r"['’]s?$")  # "Harbour United's", "Joel Ellis'"


def extract_names(text: str) -> list[str]:
    """Runs of capitalised words, without a possessive ("Harbour United's" is Harbour United)."""
    return [_POSSESSIVE.sub("", m.group(0)) for m in _NAME.finditer(text)]


# capitalised words a commentary line may open a sentence with before a club name
OPENERS = frozenset(
    "strong great good big another second early late sharp quick brilliant dangerous careful "
    "tight tough busy relentless constant steady fresh rare late first next both still just now "
    "again here more less all only even".split()
)


def _unknown_name(text: str, allowed: set[str]) -> str | None:
    """The first name run that is not a roster name. A run that only has a capitalised sentence
    opener in front of a roster name ("Strong Harbour United pressure") is that roster name."""
    for match in _NAME.finditer(text):
        name = _POSSESSIVE.sub("", match.group(0))
        if name.casefold() in allowed:
            continue
        opener, _, rest = name.partition(" ")
        starts_sentence = match.start() == 0 or text[: match.start()].rstrip().endswith(
            (".", "!", "?")
        )
        if starts_sentence and opener.casefold() in OPENERS and rest.casefold() in allowed:
            continue
        return name
    return None


def recompute(
    events: tuple[dict[str, Any], ...] | list[dict[str, Any]],
    metric: str,
    upto: int,
    home: str = "",
) -> float:
    """Count a metric straight from the stored events up to a sequence; never from agent state."""
    name, team = metric.split(":", 1)
    if name == "xg":
        return team_xg(events, team, upto)
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
        name = claim["metric"].split(":", 1)[0]
        if (
            METRIC_UNITS.get(name) != claim["units"]
            or derivation_version(name) != claim["derivation_version"]
        ):
            return Check(
                name="numbers",
                passed=False,
                detail=f"{claim['metric']} must be {METRIC_UNITS.get(name)} v"
                f"{derivation_version(name)}, not {claim['units']} v{claim['derivation_version']}",
            )
        expected = recompute(ctx.events, claim["metric"], claim["max_evidence_sequence"])
        if abs(expected - claim["value"]) > TOLERANCE[claim["units"]] + EPSILON:
            return Check(
                name="numbers",
                passed=False,
                detail=(
                    f"{claim['metric']} is {claim['value']} in the claim but {expected} in the log"
                ),
            )
    # each claim backs one number in the line: "Northgate FC 1, Harbour United 1" is refused
    # when the claims are 0 and 1, which a plain set of allowed values would let through
    spare = Counter(float(c["value"]) for c in claims)
    for number in extract_numbers(line.text):
        if spare[number] <= 0:
            known = number in {float(c["value"]) for c in claims}
            why = "is used more often than the claims allow" if known else "is not in any claim"
            return Check(name="numbers", passed=False, detail=f"{number:g} {why}")
        spare[number] -= 1
    return Check(
        name="numbers", passed=True, detail="claims recomputed from the log; line numbers match"
    )


# lines that are not about one moment: the Ask answer and the full-time recap
NOT_A_MOMENT = ("ask", "line-recap")
# events whose lines are about one side's player; summaries and period ends are about both
PLAYER_MOMENTS = ("goal", "card", "shot", "tackle", "foul")


def moment_team_problem(
    ctx: MatchContext, line: DraftLine, claims: list[dict[str, Any]]
) -> str | None:
    """A player named in a moment line must be one the moment's event names (scorer, assist, ...).

    The moment is the event at the claims' evidence sequence (the latest revision of it).
    Names are matched whole and longest first, so "Ben Cole" is not found inside "Ben Coleman".
    Returns the offending name."""
    if line.line_id.startswith(NOT_A_MOMENT) or not claims:
        return None
    seq = max(c["max_evidence_sequence"] for c in claims)
    event = next((e for e in reversed(ctx.events) if e["stream_sequence"] == seq), None)
    if event is None or event["payload"]["type"] not in PLAYER_MOMENTS:
        return None
    payload = event["payload"]
    allowed = {v for v in payload.values() if isinstance(v, str) and v in ctx.names}
    team = payload.get("team_id")
    if team and not allowed:  # an event that names no player: any player of its team
        allowed = {p["player_id"] for p in ctx.roster["players"] if p["team_id"] == team}
    ok = {ctx.names[pid].casefold() for pid in allowed}
    text = line.text.casefold()
    for name in sorted(ctx.names.values(), key=len, reverse=True):
        folded = name.casefold()
        pattern = rf"(?<![\w]){re.escape(folded)}(?![\w])"
        if re.search(pattern, text):
            if folded not in ok:
                return name
            text = re.sub(pattern, " ", text)  # consume it, so a shorter name inside is not seen
    return None


def check_names(ctx: MatchContext, line: DraftLine, claims: list[dict[str, Any]]) -> Check:
    name = _unknown_name(line.text, ctx.allowed_names)
    if name:
        return Check(name="names", passed=False, detail=f"{name} is not in this match's roster")
    stray = moment_team_problem(ctx, line, claims)
    if stray:
        return Check(
            name="names", passed=False, detail=f"{stray} is not on the team in this moment"
        )
    return Check(name="names", passed=True, detail="every name is in the roster and in the moment")


def check_persona(line: DraftLine) -> Check:
    if len(line.text) > line.max_chars:
        return Check(
            name="persona", passed=False, detail=f"{len(line.text)} chars; limit {line.max_chars}"
        )
    if len(extract_numbers(line.text)) > max_numbers(line.persona):
        return Check(name="persona", passed=False, detail=f"too many numbers for {line.persona}")
    return Check(name="persona", passed=True, detail="within persona limits")


REASON: dict[str, ReasonCode] = {
    "sources": "unknown_source",
    "freshness": "stale_state",
    "numbers": "number_mismatch",
    "names": "unknown_player",
    "persona": "length_exceeded",
}


def check_vision(ctx: MatchContext, claims: list[dict[str, Any]]) -> Check:
    """Vision's pass counts against the engine's own passes (ADR-0020). It reports the agreement
    and does not block the line: the number itself was recounted from Vision's passes by check 3."""
    counts = [c for c in claims if c["metric"].startswith("passes:")]
    if not counts:
        return Check(name="vision", passed=True, detail="no Vision count in this line")
    if not ctx.truth:
        return Check(name="vision", passed=True, detail="no engine truth on this stream")
    parts = []
    for claim in counts:
        team = claim["metric"].split(":", 1)[1]
        cut = claim["source"]["to_event_time_ms"]
        seen, real = claim["value"], engine_count(ctx.truth, team, cut)
        top = max(seen, real)
        share = 100 if top == 0 else round(100 * min(seen, real) / top)
        parts.append(
            f"Vision counted {seen:g} passes for {team}, the engine {real} ({share}% agree)"
        )
    return Check(name="vision", passed=True, detail="; ".join(parts))


def run_checks(ctx: MatchContext, line: DraftLine, claims: list[dict[str, Any]]) -> list[Check]:
    checks = [
        check_sources(ctx, claims),
        check_freshness(ctx, claims),
        check_numbers(ctx, line, claims),
        check_names(ctx, line, claims),
        check_persona(line),
    ]
    # only a line that carries a Vision count gets the check
    if any(c["metric"].startswith("passes:") for c in claims):
        checks.append(check_vision(ctx, claims))
    return checks
