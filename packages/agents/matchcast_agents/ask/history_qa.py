"""Ask over the real national-team results (martj42, CC0): deterministic, grounded, recounted.

Three questions, answered from the results file only (never the simulated match):

- a team in a year: "Argentina results in 2022", "Argentina goals in 2022"
- a team's record, all-time, in a year or against an opponent: "Brazil's record v Germany"
- the top teams by Elo in a year: "best team in 2026"

Every sentence cites what it is built from. ``[result:N]`` is one row of the results file;
``[history:...]`` is a tally, and the Verifier recounts it from the file by its key. A sentence
whose numbers do not match its recount is dropped, as the match-scoped Ask drops a sentence it
cannot check.
"""

import re
from collections import Counter
from dataclasses import dataclass
from datetime import date
from functools import lru_cache

from .. import history as hist
from ..verify.text import extract_numbers

MIN_YEAR, MAX_YEAR = 1872, 2026
TOP_TEAMS = 5
MIN_MATCHES_IN_YEAR = 5  # the intro says "five" in words: keep the two in step
SHOWN_ROWS = 5  # the newest results listed under a year's tally
SHOWN_YEARS = 10  # the newest years listed for "results by year"
ORDINAL = ("First", "Second", "Third", "Fourth", "Fifth")
ABSTAIN = "I can't find that in the national-team results."

_YEAR = re.compile(r"\b(18[7-9]\d|19\d\d|20[0-2]\d)\b")
_CITE = re.compile(r"\[(result|history):([^\]]+)\]")
# a match question, not a history one: the score, shots and cards of the game on screen
_LIVE = re.compile(
    r"\b(so far|right now|currently|at the moment|this match|tonight|the score|live)\b", re.I
)
_RECORD = re.compile(
    r"\b(record|results?|head[- ]to[- ]head|all[- ]time|history|ever|ranking|elo)\b", re.I
)
_TOP = re.compile(
    r"\b(best|top|strongest)\b.*\b(teams?|nations?|sides?|countries)\b"
    r"|\b(teams?|nations?|sides?|countries)\b.*\b(best|top|strongest)\b",
    re.I,
)
_ALIASES = {"usa": "United States"}


@dataclass(frozen=True)
class Query:
    kind: str  # record | top | by_year
    team: str | None = None
    opponent: str | None = None
    year: int | None = None


def _teams_in(question: str) -> list[str]:
    """Dataset team names in the question, in order; the longest name wins an overlap."""
    taken: list[tuple[int, int]] = []
    found: list[tuple[int, str]] = []
    spellings = {name: name for name in hist._names().values()} | _ALIASES
    for spelling, canonical in sorted(spellings.items(), key=lambda kv: -len(kv[0])):
        for m in re.finditer(rf"\b{re.escape(spelling)}\b", question, re.IGNORECASE):
            if any(m.start() < end and start < m.end() for start, end in taken):
                continue
            taken.append((m.start(), m.end()))
            found.append((m.start(), canonical))
    return [name for _, name in sorted(found)]


def parse(question: str) -> Query | None:
    """The history question in ``question``, or None when it is not one (a match question stays)."""
    if _LIVE.search(question):
        return None
    years = [int(y) for y in _YEAR.findall(question)]
    year = years[0] if years and MIN_YEAR <= years[0] <= MAX_YEAR else None
    teams = _teams_in(question)
    metric = _metric(question)
    if metric is not None and metric != "goals":
        return None  # shots, cards and the like belong to the match
    if not teams:
        return Query("top", year=year) if year is not None and _TOP.search(question) else None
    if year is None and not _RECORD.search(question):
        return None
    if len(set(teams)) >= 2:
        return Query("record", teams[0], teams[1], year)
    if year is None and re.search(r"\bresults?\b", question, re.I):
        return Query("by_year", teams[0])
    return Query("record", teams[0], None, year)


def _metric(question: str) -> str | None:
    from .assistant import _metric_in  # the match metrics, to keep match questions off history

    found = _metric_in(question)
    return found[0] if found else None


@lru_cache(maxsize=256)
def _rows(
    team: str | None, opponent: str | None, year: int | None
) -> tuple[tuple[int, tuple], ...]:
    """(row number, result) for the matches that fit, oldest first, before today."""
    cut = date.today()
    out = []
    for number, m in hist._numbered():
        if m[0] >= cut or (year is not None and m[0].year != year):
            continue
        sides = {m[1], m[2]}
        if team is not None and team not in sides:
            continue
        if opponent is not None and opponent not in sides:
            continue
        out.append((number, m))
    return tuple(out)


@lru_cache(maxsize=1)
def _by_number() -> dict[int, tuple]:
    return dict(hist._numbered())


def _tally(team: str, opponent: str | None, year: int | None) -> dict[str, int]:
    """Played, won, drawn, lost and goals for and against, from ``team``'s side."""
    tally = Counter()
    for _, m in _rows(team, opponent, year):
        mine, theirs = (m[3], m[4]) if m[1] == team else (m[4], m[3])
        tally["played"] += 1
        tally["won" if mine > theirs else "lost" if mine < theirs else "drawn"] += 1
        tally["goals_for"] += mine
        tally["goals_against"] += theirs
    return {k: tally[k] for k in ("played", "won", "drawn", "lost", "goals_for", "goals_against")}


def _score(m: tuple) -> str:
    return f"{m[1]} {m[3]}-{m[4]} {m[2]}"


def _when(m: tuple) -> str:
    return f"{m[0].day} {m[0]:%b} {m[0].year}"


def _record_sentence(team: str, opponent: str | None, year: int | None) -> tuple[str, str]:
    tally = _tally(team, opponent, year)
    when = f" in {year}" if year is not None else " all-time"
    key = f"record|{team}|{opponent or ''}|{year or ''}"
    if opponent is None:
        text = (
            f"{team} played {tally['played']}{when}: {tally['won']} won, {tally['drawn']} drawn, "
            f"{tally['lost']} lost, scoring {tally['goals_for']} and conceding "
            f"{tally['goals_against']}."
        )
        return text, key
    text = (
        f"{team} and {opponent} have met {tally['played']} times{when}: {team} have won "
        f"{tally['won']}, {opponent} have won {tally['lost']}, and {tally['drawn']} were drawn."
    )
    return text, key


def _row_sentence(number: int, m: tuple) -> str:
    comp = hist._competition(m[5])
    return f"{_when(m)}: {_score(m)}, {comp}. [result:{number}]"


def _answer_sentences(query: Query) -> list[str]:
    """Each sentence with its citations; empty when the file has nothing for the question."""
    if query.kind == "by_year":
        years = sorted({m[0].year for _, m in _rows(query.team, None, None)}, reverse=True)
        out = []
        for year in years[:SHOWN_YEARS]:
            text, key = _record_sentence(query.team, None, year)
            out.append(f"{text} [history:{key}]")
        return out
    if query.kind == "top":
        return _top_sentences(query.year)
    text, key = _record_sentence(query.team, query.opponent, query.year)
    out = [f"{text} [history:{key}]"]
    rows = _rows(query.team, query.opponent, query.year)
    if query.opponent is not None and rows:
        number, last = rows[-1]
        comp = hist._competition(last[5])
        out.append(f"The last meeting was {_when(last)}: {_score(last)}, {comp}. [result:{number}]")
    elif rows:
        out.extend(_row_sentence(number, m) for number, m in reversed(rows[-SHOWN_ROWS:]))
    return out


def _top_sentences(year: int) -> list[str]:
    matches = _rows(None, None, year)
    if not matches:
        return []
    counts = Counter(team for _, m in matches for team in (m[1], m[2]))
    ratings = hist._elo_ratings(date(year + 1, 1, 1))
    eligible = [t for t, n in counts.items() if n >= MIN_MATCHES_IN_YEAR and t in ratings]
    ranked = sorted(eligible, key=lambda t: ratings[t], reverse=True)[:TOP_TEAMS]
    if not ranked:
        return []
    intro = (
        f"The top teams by our Elo rating after the {year} matches, among teams that played at "
        f"least five that year. This is our approximation, not the official World Football Elo. "
        f"[history:year|{year}]"
    )
    out = [intro]
    for place, team in zip(ORDINAL, ranked, strict=False):
        tally = _tally(team, None, year)
        out.append(
            f"{place}: {team}, Elo {round(ratings[team])}, {tally['played']} matches in {year} "
            f"({tally['won']} won, {tally['drawn']} drawn, {tally['lost']} lost). "
            f"[history:elo|{year}|{team}] [history:record|{team}||{year}]"
        )
    return out


def _recount(kind: str, body: str) -> set[float] | None:
    """The numbers a citation supports, recounted from the results file; None when it is unknown."""
    parts = body.split("|")
    if kind == "result":
        rows = _by_number()
        if not body.isdigit() or int(body) not in rows:
            return None
        m = rows[int(body)]
        return {float(m[0].day), float(m[0].year), float(m[3]), float(m[4])}
    if parts[0] == "record" and len(parts) == 4:
        _, team, opponent, year = parts
        known = set(hist._names().values())
        if team not in known or (opponent and opponent not in known):
            return None
        y = int(year) if year else None
        tally = _tally(team, opponent or None, y)
        if tally["played"] == 0:
            return None
        counts = {float(v) for v in tally.values()}
        return counts | {float(y)} if y is not None else counts
    if parts[0] == "elo" and len(parts) == 3:
        year, team = int(parts[1]), parts[2]
        ratings = hist._elo_ratings(date(year + 1, 1, 1))
        return {float(round(ratings[team]))} if team in ratings else None
    if parts[0] == "year" and len(parts) == 2:
        year = int(parts[1])
        return {float(year), float(len(_rows(None, None, year)))}
    return None


def verified(sentence: str) -> bool:
    """Every citation is real, and every number in the sentence is one its citations recount."""
    cites = _CITE.findall(sentence)
    if not cites:
        return False
    allowed: set[float] = set()
    for kind, body in cites:
        got = _recount(kind, body)
        if got is None:
            return False
        allowed |= got
    plain = _CITE.sub("", sentence)
    return all(n in allowed for n in extract_numbers(plain))


def answer(question: str) -> tuple[str, bool, list[dict[str, str]], int]:
    """(answer, abstained, citations, dropped) for a history question; abstains if none checks."""
    query = parse(question)
    if query is None:
        return ABSTAIN, True, [], 0
    sentences = _answer_sentences(query)
    kept = [s for s in sentences if verified(s)]
    dropped = len(sentences) - len(kept)
    if not kept:
        return ABSTAIN, True, [], dropped
    citations = [
        {"type": kind, "id": body} for kind, body in dict.fromkeys(_CITE.findall(" ".join(kept)))
    ]
    return " ".join(kept), False, citations, dropped
