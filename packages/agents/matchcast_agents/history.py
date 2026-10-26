"""Pre-match history for two national teams, from the martj42 international results (CC0).

Head-to-head, a simple Elo rating and the last five results. It reads real past results only, never
the simulated match. It is computed when the match is created, with results cut at today's date
(the fixture's own date is not known yet). See docs/architecture/adr/0020.
"""

from __future__ import annotations

import csv
import logging
import re
import unicodedata
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# date, home, away, home goals, away goals, competition, neutral
Match = tuple[date, str, str, int, int, str, bool]

RESULTS = Path(__file__).resolve().parents[3] / "data/history/results.csv"
START_ELO = 1500.0
HOME_EDGE = 100.0
K = 30.0
FORM_LENGTH = 5
# federation names are trademarks; ADR-0020 keeps them out of what we show
_FEDERATION = re.compile(r"\b(FIFA|UEFA|IFAB|CONMEBOL|CONCACAF|CAF|AFC|OFC|OFC)\b")


@lru_cache(maxsize=1)
def _numbered() -> tuple[tuple[int, Match], ...]:
    """Every result with its row number in the file (the first result is row 1), oldest first."""
    rows = []
    with RESULTS.open(newline="", encoding="utf-8") as fh:
        for number, r in enumerate(csv.DictReader(fh), start=1):
            match = (
                date.fromisoformat(r["date"]),
                r["home_team"],
                r["away_team"],
                int(r["home_score"]),
                int(r["away_score"]),
                r["tournament"],
                r["neutral"] == "TRUE",
            )
            rows.append((number, match))
    return tuple(rows)


@lru_cache(maxsize=1)
def _matches() -> tuple[Match, ...]:
    """Every result, oldest first."""
    return tuple(match for _, match in _numbered())


def meeting_rows(home: str, away: str, on: date | None = None) -> list[int]:
    """The results-file row numbers of every past meeting of two nations, cut at `on`."""
    cut = on or date.today()
    home_name, away_name = resolve_team(home) or home, resolve_team(away) or away
    return [
        number for number, m in _numbered() if m[0] < cut and {m[1], m[2]} == {home_name, away_name}
    ]


@lru_cache(maxsize=1)
def _names() -> dict[str, str]:
    """Dataset spelling by folded name, so "Bosnia And Herzegovina" still matches."""
    names = {m[1] for m in _matches()} | {m[2] for m in _matches()}
    return {_key(n): n for n in names}


def _key(name: str) -> str:
    """Letters and digits only, lower case, no accents: "Côte d'Ivoire" matches "cote-d-ivoire"."""
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", plain.casefold())


# the spellings other sources use, keyed by _key, including the default slug names the API makes
_ALIASES = {
    _key(spelling): canonical
    for spelling, canonical in {
        "Côte d'Ivoire": "Ivory Coast",
        "Cote d'Ivoire": "Ivory Coast",
        "C Te D Ivoire": "Ivory Coast",
        "Korea Republic": "South Korea",
        "St Kitts and Nevis": "Saint Kitts and Nevis",
        "Cura Ao": "Curaçao",
        "S o Tom and Pr ncipe": "São Tomé and Príncipe",
    }.items()
}


def resolve_team(name: str) -> str | None:
    """The dataset spelling of a nation, ignoring case, accents and punctuation; None if unknown."""
    key = _key(name)
    if key in _ALIASES:
        key = _key(_ALIASES[key])
    return _names().get(key)


@lru_cache(maxsize=8)
def _before(on: date) -> tuple[Match, ...]:
    return tuple(m for m in _matches() if m[0] < on)


@lru_cache(maxsize=8)
def _elo_ratings(on: date) -> dict[str, float]:
    """A plain Elo over the results before `on`: K 30, a goal-difference multiplier and a home edge.

    Our approximation, not the official World Football Elo.
    """
    ratings: dict[str, float] = {}
    for _, home, away, home_goals, away_goals, _, neutral in _before(on):
        rh, ra = ratings.get(home, START_ELO), ratings.get(away, START_ELO)
        edge = 0.0 if neutral else HOME_EDGE
        expected = 1 / (1 + 10 ** ((ra - (rh + edge)) / 400))
        result = 1.0 if home_goals > away_goals else 0.0 if home_goals < away_goals else 0.5
        gd = abs(home_goals - away_goals)
        mult = 1.0 if gd <= 1 else 1.5 if gd == 2 else (11 + gd) / 8
        shift = K * mult * (result - expected)
        ratings[home], ratings[away] = rh + shift, ra - shift
    return ratings


def _meetings(home: str, away: str, matches) -> list[Match]:
    return [m for m in matches if {m[1], m[2]} == {home, away}]


def _winner(m: Match) -> str | None:
    return m[1] if m[3] > m[4] else m[2] if m[4] > m[3] else None


def _competition(name: str) -> str:
    """The competition as we may show it: a federation-named one becomes a generic label."""
    return "International competition" if _FEDERATION.search(name) else name


def _h2h(home: str, away: str, matches) -> dict[str, Any]:
    games = _meetings(home, away, matches)
    home_w = sum(1 for m in games if _winner(m) == home)
    away_w = sum(1 for m in games if _winner(m) == away)
    last = games[-1] if games else None
    return {
        "played": len(games),
        "home_wins": home_w,
        "draws": len(games) - home_w - away_w,
        "away_wins": away_w,
        "last_meeting": (
            {
                "date": last[0].isoformat(),
                "score": f"{last[3]}-{last[4]}" if last[1] == home else f"{last[4]}-{last[3]}",
                "competition": _competition(last[5]),
            }
            if last
            else None
        ),
    }


def _form(team: str, matches) -> list[str]:
    """The last results for one team, newest first, as W, D or L from its own side."""
    out: list[str] = []
    for m in reversed(matches):
        if team not in (m[1], m[2]):
            continue
        mine, theirs = (m[3], m[4]) if m[1] == team else (m[4], m[3])
        out.append("W" if mine > theirs else "L" if mine < theirs else "D")
        if len(out) == FORM_LENGTH:
            break
    return out


def pre_match(home: str, away: str, on: date | None = None) -> dict[str, Any]:
    """The history block for MatchContext.extra["history"], from real results before `on`.

    `on` defaults to today. Names are matched to the dataset spelling without regard to case;
    a nation the dataset does not know gets no Elo and an empty form, and its head-to-head is zero.
    """
    cut = on or date.today()
    home_name, away_name = resolve_team(home) or home, resolve_team(away) or away
    matches = _before(cut)
    ratings = _elo_ratings(cut)
    return {
        "source": "martj42 international results, CC0",
        "h2h": _h2h(home_name, away_name, matches),
        "elo": {
            "home": round(ratings[home_name], 1) if home_name in ratings else None,
            "away": round(ratings[away_name], 1) if away_name in ratings else None,
        },
        "recent_form": {
            "home": _form(home_name, matches),
            "away": _form(away_name, matches),
        },
    }


def for_match(home_team: str, away_team: str, on: date | None = None) -> dict[str, Any] | None:
    """The block for two nations, or None unless both are nations in the dataset.

    Requiring both sides keeps a fictional club from getting one side's real data. Also None
    when the results file is missing from the deployed image, which is logged.
    """
    if resolve_team(home_team) is None or resolve_team(away_team) is None:
        return None
    try:
        block = pre_match(home_team, away_team, on)
    except OSError:
        log.warning("national-team history unavailable: %s is missing", RESULTS)
        return None
    if (
        block["h2h"]["played"] == 0
        and block["elo"]["home"] is None
        and block["elo"]["away"] is None
    ):
        return None
    return block


def history_for_roster(
    team_ids: list[str] | None, clubs: dict[str, str] | None, on: date | None = None
) -> dict[str, Any] | None:
    """The block for a roster's two teams, named by `clubs`; None unless there are two."""
    if not team_ids or len(team_ids) != 2 or not clubs:
        return None
    home, away = (clubs.get(t) for t in team_ids)
    if not home or not away:
        return None
    return for_match(home, away, on)
