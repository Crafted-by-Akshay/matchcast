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
    def generated(root: Path) -> set[str]:
        return {p.relative_to(root).as_posix() for c in build_profiles.GENERATED
                for p in (root / c).glob("*.md")}  # fmt: skip

    assert generated(built) == generated(ROOT / "kb")
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
        "SELECT sum(shots) FROM player_match_stats WHERE team_id='HAR' AND player='N. Navlano'"
    )["rows"][0][0]
    assert re.search(rf"{shots} shots", (built / "players/har-n-navlano.md").read_text())


def test_a_stale_page_is_removed(tmp_path) -> None:
    build_profiles.build(kb=tmp_path)
    (tmp_path / "players/gone-player.md").write_text("old")
    build_profiles.build(kb=tmp_path)
    assert not (tmp_path / "players/gone-player.md").exists()


def test_pages_add_no_banner_chunk(built) -> None:
    assert all(
        c.section or c.text.strip()
        for c in load_kb(ROOT / "kb")
        if c.corpus in {"clubs", "players"}
    )
    assert "<!--" not in (built / "clubs/har.md").read_text()


def test_one_page_per_match_and_the_chunks_are_retrievable(built) -> None:
    assert len(list((built / "season").glob("*.md"))) == 28
    index = Bm25Index(load_kb(ROOT / "kb"))
    hit = index.search("who coaches Harbor City", k=3)
    assert any(h.chunk.id.startswith("clubs:har") for h in hit)


def test_unnamed_questions_never_return_entity_pages() -> None:
    index = Bm25Index(load_kb(ROOT / "kb"))
    for question in ("what is pass completion", "possession", "home advantage", "average goals"):
        assert not {h.chunk.corpus for h in index.search(question, k=8)} & {
            "clubs",
            "players",
            "season",
        }, question


@pytest.mark.parametrize(
    ("question", "prefix"),
    [
        ("how is average xG worked out", "metrics:xg"),
        ("what is synthetic data", "app:"),
        ("who coaches Harbor City", "clubs:har"),
        ("tell me about N. Navlano", "players:har-n-navlano"),
        ("what happened in M001", "season:m001"),
    ],
)
def test_entity_pages_answer_only_when_named(question, prefix) -> None:
    index = Bm25Index(load_kb(ROOT / "kb"))
    top = index.search(question, k=3)
    assert top and top[0].chunk.id.startswith(prefix), [h.chunk.id for h in top]
