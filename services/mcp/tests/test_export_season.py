"""scripts/export_season.py writes the Parquet tables with the columns the season views expose."""

import importlib.util
import json
from pathlib import Path

import duckdb
import pytest
from matchcast_mcp.season import METRICS, TABLES, Season, SeasonError

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("export_season", ROOT / "scripts/export_season.py")
export_season = importlib.util.module_from_spec(spec)
spec.loader.exec_module(export_season)


def _match(match_id: str, home: str, away: str) -> dict:
    stat = lambda a, b: [a, b]  # noqa: E731
    return {
        "id": match_id,
        "date": "2026-01-01",
        "home": home,
        "away": away,
        "score": [2, 1],
        "setup": {"stadium": "London"},
        "sum": {
            "shots": stat(10, 7), "xg": stat(1.8, 0.9), "passes": stat(400, 350),
            "passesCompleted": stat(340, 280), "possessionPct": stat(55, 45), "fouls": stat(9, 11),
            "yellowCards": stat(1, 2), "redCards": stat(0, 0), "offsides": stat(2, 1),
            "playerTracking": [
                {"name": "A One", "team": home, "passesAttempted": 40, "passesCompleted": 35,
                 "tackles": 3, "shots": 2, "xg": 0.4, "distanceKm": 10.1},
            ],
        },
    }  # fmt: skip


@pytest.fixture
def exported(tmp_path: Path) -> tuple[Path, dict[str, int]]:
    source = tmp_path / "src"
    source.mkdir()
    for i, (h, a) in enumerate([("AAA", "BBB"), ("CCC", "AAA")]):
        (source / f"M{i:02d}.json").write_text(json.dumps(_match(f"M{i:02d}", h, a)))
    out = tmp_path / "out"
    return out, export_season.export(out, source)


def test_counts_and_files(exported: tuple[Path, dict[str, int]]) -> None:
    out, counts = exported
    assert counts == {"matches": 2, "team_match_stats": 4, "player_match_stats": 2}
    # no scratch JSON is left behind
    assert sorted(p.name for p in out.iterdir()) == sorted(f"{t}.parquet" for t in TABLES)


def test_columns_cover_every_queryable_metric(exported: tuple[Path, dict[str, int]]) -> None:
    out, _ = exported
    con = duckdb.connect()
    for table, scope in (("team_match_stats", "team"), ("player_match_stats", "player")):
        path = out / f"{table}.parquet"
        cols = {r[0] for r in con.execute(f"DESCRIBE SELECT * FROM '{path}'").fetchall()}
        assert set(METRICS[scope]) <= cols
        assert {"match_id", "team_id"} <= cols


def test_season_reads_exported_files(exported: tuple[Path, dict[str, int]]) -> None:
    season = Season(exported[0])
    assert season.matches == 2
    assert season.compare("shots", "team", 8, "AAA")["of"] == 2


def test_missing_season_files_raise_season_error(tmp_path: Path) -> None:
    with pytest.raises(SeasonError):
        Season(tmp_path)
