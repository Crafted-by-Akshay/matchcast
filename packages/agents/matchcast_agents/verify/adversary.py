"""The adversarial pass (CREW-4.1): deterministic attempts to falsify a line against its claims.

Each attempt is one recorded check named ``adversary:<attempt>``, so the audit shows what was
tried, whether or not it found a counterexample. The attempts run after checks 1 to 7 pass, on
every line about one moment (an Ask answer or a recap is not put to them). No model call is made.
An attempt that cannot decide fails closed: the line is refused with that attempt's reason code.
"""

import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from ..context import MatchContext
from ..messages import Check, DraftLine, ReasonCode
from ..metrics_spec import TOLERANCE
from .moment import NOT_A_MOMENT, moment_event, moment_players
from .text import EPSILON, extract_numbers

Attack = Callable[[MatchContext, DraftLine, list[dict[str, Any]]], str | None]

# "minute 12", "12th minute", "12'": the minute the line names
_MINUTE = re.compile(
    r"\bminute\s+(\d{1,3})(?!\d)|\b(\d{1,3})(?:st|nd|rd|th)\s+minute\b|\b(\d{1,3})'",
    re.IGNORECASE,
)
_CAPITALISED = re.compile(r"[A-Z][\w'’-]*")
_POSSESSIVE = re.compile(r"['’]s?$")


def _within(number: float, claim: dict[str, Any]) -> bool:
    return abs(number - float(claim["value"])) <= TOLERANCE[claim["units"]] + EPSILON


def score_attribution(
    ctx: MatchContext, draft: DraftLine, claims: list[dict[str, Any]]
) -> str | None:
    """A number written straight after a club's name must be a claim about that club. Check 3
    only asks that each number is some claim's value, so "Harbour United 1" would pass for a
    score of Northgate FC 1, Harbour United 0 that has its two sides swapped."""
    for team, club in ctx.clubs.items():
        # a meetings count is about the pair, not a score of either side, so it is never "own"
        own = [
            c
            for c in claims
            if c["metric"].split(":", 1)[1] == team and not c["metric"].startswith("h2h_")
        ]
        pattern = rf"(?<!\w){re.escape(club)}\s+(\d+(?:\.\d+)?)(?!\w)(?!\.\d)"
        for match in re.finditer(pattern, draft.text):
            if not any(_within(float(match.group(1)), c) for c in own):
                return f"{match.group(1)} after {club} is not a claim about {club}"
    return None


def named_minute(ctx: MatchContext, draft: DraftLine, claims: list[dict[str, Any]]) -> str | None:
    """A minute the line names must be within a minute of a time some claim carries."""
    times = [c["snapshot"]["event_time_ms"] for c in claims]
    times += [c["source"]["to_event_time_ms"] for c in claims if "to_event_time_ms" in c["source"]]
    for match in _MINUTE.finditer(draft.text):
        named = int(next(g for g in match.groups() if g))
        if not any(abs(named - t / 60_000) <= 1 for t in times):
            return f"minute {named} is not a minute any claim carries"
    return None


def surname_alone(ctx: MatchContext, draft: DraftLine, claims: list[dict[str, Any]]) -> str | None:
    """A capitalised first name or surname of a roster player who is not in the moment. Check 4
    only reads whole names (two or more words), so "Cato is in the box" passes it."""
    if moment_event(ctx, claims) is None:  # cannot tell whose player it is: refuse, do not guess
        raise LookupError("no stored event at the moment's evidence sequence")
    allowed = moment_players(ctx, claims)
    if allowed is None:  # a summary or period end is about both sides: not put to this attempt
        return None
    club_words = {w.casefold() for club in ctx.clubs.values() for w in club.split()}
    allowed_parts = {p.casefold() for name in allowed for p in name.split()}
    forbidden = {
        p.casefold()
        for name in ctx.names.values()
        if name.casefold() not in allowed
        for p in name.split()
    }
    forbidden -= allowed_parts | club_words
    text = draft.text
    for name in sorted((*ctx.names.values(), *ctx.clubs.values()), key=len, reverse=True):
        text = re.sub(rf"(?<!\w){re.escape(name)}(?!\w)", " ", text)  # whole names are check 4's
    for word in _CAPITALISED.finditer(text):
        token = _POSSESSIVE.sub("", word.group(0))
        if token.casefold() in forbidden:
            return f"{token} is a name of a player who is not in this moment"
    return None


def unclaimed_number(
    ctx: MatchContext, draft: DraftLine, claims: list[dict[str, Any]]
) -> str | None:
    """Every number in the text is some claim's value (check 3 too; recorded as its own attempt)."""
    carried = {float(c["value"]) for c in claims}
    for number in extract_numbers(draft.text):
        if number not in carried:
            return f"{number:g} is not in any claim"
    return None


def repeated_value(ctx: MatchContext, draft: DraftLine, claims: list[dict[str, Any]]) -> str | None:
    """No claim value is stated more often than claims carry it (also check 3; its own attempt)."""
    carried = Counter(float(c["value"]) for c in claims)
    for number, times in Counter(extract_numbers(draft.text)).items():
        if times > carried[number]:
            return f"{number:g} is used more often than the claims allow"
    return None


@dataclass(frozen=True)
class Attempt:
    name: str
    reason: ReasonCode
    attack: Attack


ATTEMPTS: tuple[Attempt, ...] = (
    Attempt("score_attribution", "number_mismatch", score_attribution),
    Attempt("named_minute", "number_mismatch", named_minute),
    Attempt("surname_alone", "unknown_player", surname_alone),
    Attempt("unclaimed_number", "number_mismatch", unclaimed_number),
    Attempt("repeated_value", "number_mismatch", repeated_value),
)
REASON_BY_CHECK: dict[str, ReasonCode] = {f"adversary:{a.name}": a.reason for a in ATTEMPTS}


def adversary_checks(
    ctx: MatchContext, draft: DraftLine, claims: list[dict[str, Any]]
) -> list[Check]:
    """One recorded check per attempt, in order. Nothing for an Ask answer or a recap. A moment
    line with no claim cannot be tried against anything, so every attempt refuses it."""
    if draft.line_id.startswith(NOT_A_MOMENT):
        return []
    if not claims:
        return [
            Check(name=f"adversary:{a.name}", passed=False, detail="could not decide: no claim")
            for a in ATTEMPTS
        ]
    checks = []
    for attempt in ATTEMPTS:
        name = f"adversary:{attempt.name}"
        try:
            counterexample = attempt.attack(ctx, draft, claims)
        except Exception as error:  # fail closed: an attempt that cannot decide refuses the line
            checks.append(
                Check(name=name, passed=False, detail=f"could not decide: {type(error).__name__}")
            )
            continue
        if counterexample is None:
            checks.append(Check(name=name, passed=True, detail="tried: no counterexample"))
        else:
            checks.append(Check(name=name, passed=False, detail=f"falsified: {counterexample}"))
    return checks
