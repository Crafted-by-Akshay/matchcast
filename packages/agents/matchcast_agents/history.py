"""Pre-match history for two national teams, from the martj42 international results (CC0).

Head-to-head, a simple Elo rating and the last five results. It reads real past results only, never
the simulated match, and it is computed once at kick-off (see docs/architecture/adr/0020).
"""

from __future__ import annotations

import csv
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any

# date, home, away, home goals, away goals, competition, neutral
Match = tuple[date, str, str, int, int, str, bool]

RESULTS = Path(__file__).resolve().parents[3] / "data/history/results.csv"
START_ELO = 1500.0
HOME_EDGE = 100.0
K = 30.0
FORM_LENGTH = 5


@lru_cache(maxsize=1)
def _matches() -> tuple[Match, ...]:
    """Every result, oldest first."""
    rows = []
    with RESULTS.open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            rows.append(
                (
                    date.fromisoformat(r["date"]),
                    r["home_team"],
                    r["away_team"],
                    int(r["home_score"]),
                    int(r["away_score"]),
                    r["tournament"],
                    r["neutral"] == "TRUE",
                )
            )
    return tuple(rows)


def _before(on: date) -> list[Match]:
    return [m for m in _matches() if m[0] < on]


def _elo_ratings(matches) -> dict[str, float]:
    """A plain Elo over the results: K 30, a goal-difference multiplier and a home edge.

    Our approximation, not the official World Football Elo."""
    ratings: dict[str, float] = {}
    for _, home, away, home_goals, away_goals, _, neutral in matches:
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


def _winner(m) -> str | None:
    return m[1] if m[3] > m[4] else m[2] if m[4] > m[3] else None


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
                "competition": last[5],
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
    """The history block for MatchContext.extra["history"], from real results up to `on`.

    `on` defaults to today.

    Team names use the dataset spelling, such as "England" or "Ivory Coast". A team the
    dataset does not know gets no Elo and an empty form; its head-to-head reads zero games.
    """
    matches = _before(on or date.today())
    ratings = _elo_ratings(matches)
    names = {m[1] for m in matches} | {m[2] for m in matches}
    return {
        "source": "martj42 international results, CC0",
        "h2h": _h2h(home, away, matches),
        "elo": {
            "home": round(ratings[home], 1) if home in names else None,
            "away": round(ratings[away], 1) if away in names else None,
        },
        "recent_form": {"home": _form(home, matches), "away": _form(away, matches)},
    }
