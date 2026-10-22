"""Read-only season database: DuckDB views over the exported Parquet (07 §6)."""

import os
from pathlib import Path
from typing import Any

import duckdb

TABLES = ("matches", "team_match_stats", "player_match_stats")
METRICS = {
    "team": ("goals", "shots", "xg", "passes", "passes_completed", "possession_pct", "fouls",
             "yellow_cards", "red_cards", "offsides"),
    "player": ("passes", "passes_completed", "tackles", "shots", "xg", "distance_km"),
}  # fmt: skip
SCOPE_TABLE = {"team": "team_match_stats", "player": "player_match_stats"}


class SeasonError(ValueError):
    """The question cannot be answered from the season data."""


def default_root() -> Path:
    env = os.environ.get("MATCHCAST_SEASON_DIR")
    if env:
        return Path(env)
    return next(
        p / "data/season/v1" for p in Path(__file__).resolve().parents if (p / "data").is_dir()
    )


class Season:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or default_root()
        self._con = duckdb.connect()
        for table in TABLES:
            path = self.root / f"{table}.parquet"
            self._con.execute(f"CREATE VIEW {table} AS SELECT * FROM read_parquet('{path}')")

    @property
    def matches(self) -> int:
        return self._con.execute("SELECT count(*) FROM matches").fetchone()[0]

    def compare(
        self, metric: str, scope: str, value: float, team_id: str | None = None
    ) -> dict[str, Any]:
        """Where ``value`` sits among the season's team (or player) match performances."""
        if scope not in SCOPE_TABLE:
            raise SeasonError(f"scope must be team or player, not {scope!r}")
        if metric not in METRICS[scope]:
            raise SeasonError(f"unknown {scope} metric {metric!r}")
        table = SCOPE_TABLE[scope]
        where, args = ("WHERE team_id = ?", [team_id]) if team_id else ("", [])
        average, n = self._con.execute(
            f"SELECT avg({metric}), count(*) FROM {table} {where}", args
        ).fetchone()
        better = self._con.execute(
            f"SELECT count(*) FROM {table} {'WHERE team_id = ? AND' if team_id else 'WHERE'} "
            f"{metric} > ?",
            [*args, value],
        ).fetchone()[0]
        if n == 0:
            raise SeasonError(f"no {scope} rows for team {team_id!r}")
        return {
            "metric": metric,
            "scope": scope,
            "team_id": team_id,
            "value": value,
            "season_average": round(average, 2) if average is not None else None,
            "rank": better + 1,
            "of": n,
            "matches": self.matches,
        }
