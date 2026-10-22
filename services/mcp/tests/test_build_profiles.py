"""scripts/build_profiles.py: pages agree with the season data, are deterministic and committed."""

import importlib.util
import re
from pathlib import Path

import pytest
from matchcast_agents.ask import Bm25Index, load_kb
from matchcast_mcp.season import Season

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("build_profiles", ROOT / "scripts/build_profiles.py")
build_profiles = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_profiles)


@pytest.fixture(scope="module")
def built(tmp_path_factory) -> Path:
    kb = tmp_path_factory.mktemp("kb")
    build_profiles.build(kb=kb)
    return kb


def test_committed_pages_are_up_to_date(built) -> None:
    for path in built.rglob("*.md"):
        assert (ROOT / "kb" / path.relative_to(built)).read_text() == path.read_text(), path.name


def test_a_second_run_changes_nothing(built) -> None:
    before = {p: p.stat().st_mtime_ns for p in built.rglob("*.md")}
    build_profiles.build(kb=built)
    assert before == {p: p.stat().st_mtime_ns for p in built.rglob("*.md")}


def test_club_record_matches_the_season_query(built) -> None:
    season = Season()
    won, goals_for = season.query(
        "SELECT sum(CASE WHEN t.goals > o.goals THEN 1 ELSE 0 END), sum(t.goals) "
        "FROM team_match_stats t JOIN team_match_stats o "
        "ON o.match_id = t.match_id AND o.team_id <> t.team_id WHERE t.team_id = 'HAR'"
    )["rows"][0]
    text = (built / "clubs/har.md").read_text()
    assert f"won {won}," in text and f"Goals for {goals_for}," in text


def test_player_pages_cover_the_squads_and_use_season_totals(built) -> None:
    season = Season()
    pages = list((built / "players").glob("*.md"))
    assert len(pages) == 88
    shots = season.query(
        "SELECT sum(shots) FROM player_match_stats WHERE team_id='HAR' AND player='N. Brennan'"
    )["rows"][0][0]
    assert re.search(rf"{shots} shots", (built / "players/har-n-brennan.md").read_text())


def test_one_page_per_match_and_the_chunks_are_retrievable(built) -> None:
    assert len(list((built / "season").glob("*.md"))) == 28
    index = Bm25Index(load_kb(ROOT / "kb"))
    hit = index.search("who coaches Harbor City", k=3)
    assert any(h.chunk.id.startswith("clubs:har") for h in hit)
