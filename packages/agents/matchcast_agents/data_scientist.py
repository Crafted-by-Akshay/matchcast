"""Data Scientist agent in rules mode (AGT-14): a season question becomes one SELECT, a table
and a Vega-Lite chart; the Verifier re-runs the SQL and compares every cell (F10). The re-run
catches non-determinism and tampering between runs, not wrong SQL.

Runs only when the analyst asks. The tools are ``query`` and ``describe_views`` of the season
database; with a model, the question-to-SQL step is the only thing that changes.
"""

import re
from dataclasses import dataclass, field
from typing import Any, Protocol

UNVERIFIED = "Could not verify this result."
ABSTAIN = "I can't build a season query for that question."
TEAM_METRICS = {
    "xg": "xg", "expected goals": "xg", "goals": "goals", "shots": "shots", "passes": "passes",
    "possession": "possession_pct", "fouls": "fouls", "yellow cards": "yellow_cards",
    "red cards": "red_cards", "offsides": "offsides", "passes completed": "passes_completed",
    "completed passes": "passes_completed",
}  # fmt: skip
PLAYER_METRICS = {
    "xg": "xg", "expected goals": "xg", "shots": "shots", "tackles": "tackles",
    "passes": "passes", "distance": "distance_km", "passes completed": "passes_completed",
    "completed passes": "passes_completed",
}  # fmt: skip
AVERAGE = re.compile(r"\b(average|avg|mean|per match|per game)\b", re.IGNORECASE)
PLAYER = re.compile(r"\b(player|players|who)\b", re.IGNORECASE)
TOLERANCE = 1e-9


class SeasonDb(Protocol):
    matches: int

    def query(self, sql: str) -> dict[str, Any]: ...

    def describe_views(self) -> dict[str, list[dict[str, str]]]: ...


@dataclass
class DsAnswer:
    answer: str
    verdict: str  # verified | rejected | abstained
    sql: str | None = None
    columns: list[str] = field(default_factory=list)
    rows: list[list[Any]] = field(default_factory=list)
    chart_spec: dict[str, Any] | None = None
    mismatch: str | None = None


def _metric(question: str, table: dict[str, str]) -> str | None:
    lowered = question.casefold()
    for phrase in sorted(table, key=len, reverse=True):
        if re.search(rf"\b{re.escape(phrase)}\b", lowered):
            return table[phrase]
    return None


def build_sql(question: str) -> tuple[str, str, str] | None:
    """(sql, label column, value column) for the question, or None when it is not a season query."""
    players = bool(PLAYER.search(question)) and not re.search(r"\bteam", question, re.IGNORECASE)
    metric = _metric(question, PLAYER_METRICS if players else TEAM_METRICS)
    if metric is None:
        return None
    order = (
        "ASC" if re.search(r"\b(lowest|fewest|least|worst)\b", question, re.IGNORECASE) else "DESC"
    )
    average = bool(AVERAGE.search(question))
    agg = f"round(avg({metric}), 3)" if average else f"round(sum({metric}), 3)"
    value = f"{'avg' if average else 'total'}_{metric}"
    table, key = ("player_match_stats", "player") if players else ("team_match_stats", "team_id")
    sql = (
        f"SELECT {key}, {agg} AS {value} FROM {table} GROUP BY {key} "
        f"ORDER BY {value} {order}, {key} LIMIT 10"
    )
    return sql, key, value


def chart(label: str, value: str, rows: list[list[Any]]) -> dict[str, Any]:
    return {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "data": {"values": [{label: r[0], value: r[1]} for r in rows]},
        "mark": "bar",
        "encoding": {
            "x": {"field": label, "type": "nominal", "sort": None},
            "y": {"field": value, "type": "quantitative"},
        },
    }


def same_numbers(first: list[list[Any]], second: list[list[Any]]) -> str | None:
    if len(first) != len(second):
        return f"row count {len(first)} vs {len(second)}"
    for i, (a, b) in enumerate(zip(first, second, strict=True)):
        if len(a) != len(b):
            return f"row {i + 1}: {len(a)} columns vs {len(b)}"
        for x, y in zip(a, b, strict=True):
            numeric = isinstance(x, int | float) and isinstance(y, int | float)
            if (numeric and abs(x - y) > TOLERANCE) or (not numeric and x != y):
                return f"row {i + 1}: {x!r} vs {y!r}"
    return None


def ask(question: str, season: SeasonDb) -> DsAnswer:
    """Answer one season question; the answer is shown only when the re-run matches."""
    built = build_sql(question)
    if built is None:
        return DsAnswer(ABSTAIN, "abstained")
    sql, label, value = built
    result = season.query(sql)  # SeasonError for anything that is not one allowed SELECT
    rerun = season.query(result["sql"])  # the Verifier runs the same SQL again
    mismatch = (
        same_numbers(result["rows"], rerun["rows"])
        or ("columns changed" if rerun["columns"] != result["columns"] else None)
        or ("sql changed" if rerun["sql"] != result["sql"] else None)
    )
    if mismatch or not result["rows"]:
        return DsAnswer(UNVERIFIED, "rejected", sql, mismatch=mismatch or "no rows")
    top = result["rows"][0]
    tied = [r[0] for r in result["rows"] if r[1] == top[1]]
    first = f"{top[0]} is first" if len(tied) == 1 else f"{len(tied)} are tied for first"
    metric = value.replace("_", " ")
    text = f"{first} with {top[1]} ({metric}) across the {season.matches}-match season."
    return DsAnswer(
        text,
        "verified",
        result["sql"],
        result["columns"],
        result["rows"],
        chart(label, value, result["rows"]),
    )
