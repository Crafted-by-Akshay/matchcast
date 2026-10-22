"""Read-only season database: DuckDB views over the exported Parquet (07 §6)."""

import hashlib
import json
import os
import threading
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


ROW_LIMIT = 1000
TIMEOUT_S = 5.0
ALLOWED_FUNCTIONS = {
    "avg", "sum", "count", "count_star", "min", "max", "round", "median", "stddev", "abs",
    "lower", "upper", "floor", "ceil", "sqrt",
}  # fmt: skip


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

    # ---- Data Scientist tools (AGT-14) --------------------------------------------------

    def describe_views(self) -> dict[str, list[dict[str, str]]]:
        """Each allowed view with its columns and types."""
        out = {}
        for table in TABLES:
            rows = self._con.execute(f"DESCRIBE {table}").fetchall()
            out[table] = [{"name": r[0], "type": r[1]} for r in rows]
        return out

    def check_sql(self, sql: str) -> None:
        """One SELECT over the allowed views and allowed functions, or a SeasonError."""
        ast = json.loads(self._con.execute("SELECT json_serialize_sql(?)", [sql]).fetchone()[0])
        if ast.get("error") or len(ast.get("statements", [])) != 1:
            raise SeasonError("send exactly one SELECT statement")
        problems: list[str] = []

        def walk(node: object) -> None:
            if isinstance(node, dict):
                kind = node.get("type")
                if kind == "BASE_TABLE" and node["table_name"] not in TABLES:
                    problems.append(f"table {node['table_name']} is not allowed")
                elif kind == "TABLE_FUNCTION":
                    problems.append("table functions are not allowed")
                elif kind == "FUNCTION":
                    name = node["function_name"]
                    if name.isidentifier() and name not in ALLOWED_FUNCTIONS:
                        problems.append(f"function {name} is not allowed")
                for value in node.values():
                    walk(value)
            elif isinstance(node, list):
                for value in node:
                    walk(value)

        walk(ast["statements"][0]["node"])
        if ast["statements"][0]["node"].get("type") != "SELECT_NODE" and not problems:
            problems.append("only a plain SELECT is allowed")
        if problems:
            raise SeasonError(problems[0])

    def query(self, sql: str) -> dict[str, Any]:
        """Run one allowed SELECT: at most 1,000 rows and 5 seconds."""
        sql = sql.strip().rstrip(";")
        self.check_sql(sql)
        cursor = self._con.cursor()
        timer = threading.Timer(TIMEOUT_S, cursor.interrupt)
        timer.start()
        try:
            cursor.execute(f"SELECT * FROM ({sql}) LIMIT {ROW_LIMIT}")
            columns = [d[0] for d in cursor.description]
            rows = [list(r) for r in cursor.fetchall()]
        except Exception as error:  # noqa: BLE001 - surface any engine error as a refusal
            raise SeasonError(f"query failed: {error}") from error
        finally:
            timer.cancel()
        return {
            "sql": sql,
            "sql_hash": hashlib.sha256(sql.encode()).hexdigest()[:16],
            "columns": columns,
            "rows": rows,
        }
