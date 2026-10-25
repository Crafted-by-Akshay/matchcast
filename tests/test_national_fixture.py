"""Watch can play Argentina v Brazil: national clubs and one flagged fixture, synthetic squads."""

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = _load(ROOT / "apps/unified/build.py", "unified_build")
guard = _load(ROOT / "tests/test_synthetic_names.py", "test_synthetic_names")
SEASON = [
    {
        "stIndex": 4,
        "setup": {
            "stadium": "Venue Four",
            "city": "City Four",
            "month": 5,
            "kickoff": "15:00",
            "seed": 1,
            "half": 45,
        },
        "formations": ["4-3-3", "4-4-2"],
        "styles": ["balanced", "press"],
    },
    {
        "stIndex": 0,
        "setup": {
            "stadium": "Venue One",
            "city": "City One",
            "month": 6,
            "kickoff": "18:00",
            "seed": 2,
            "half": 45,
        },
        "formations": ["4-2-3-1", "3-5-2"],
        "styles": ["counter", "balanced"],
    },
]


def test_national_clubs_are_argentina_and_brazil_with_23_synthetic_players_each() -> None:
    clubs = {c["key"]: c for c in build.national_clubs()}
    assert set(clubs) == {"ARG", "BRA"}
    assert clubs["ARG"]["club"] == "Argentina" and clubs["BRA"]["club"] == "Brazil"
    for club in clubs.values():
        assert club["label"] == "synthetic squad"
        assert [p["num"] for p in club["squad"]] == list(range(1, 24))
        assert all(p["synthetic"] for p in club["squad"])
        assert {"name", "num", "pos", "rating"} <= set(club["squad"][0])


def test_national_players_have_no_real_footballer_surnames() -> None:
    for club in build.national_clubs():
        for p in club["squad"]:
            assert not guard.surnames([p["name"]]) & guard.BLOCKLIST, p["name"]


def test_argentina_v_brazil_is_one_flagged_fixture_on_a_known_stadium() -> None:
    (fx,) = build.national_fixtures(SEASON)
    assert fx["id"] == "N001" and fx["national"] is True
    assert fx["home"]["club"] == "Argentina" and fx["away"]["club"] == "Brazil"
    assert fx["label"] == "synthetic squad"
    assert fx["stIndex"] == build.MSI_STADIUM["mexico"] == 4
    assert fx["setup"]["stadium"] == "Venue Four" and fx["setup"]["city"] == "City Four"
    assert fx["setup"]["seed"] == build.NATIONAL_SEED
    assert fx["formations"] == SEASON[0]["formations"] and fx["styles"] == SEASON[0]["styles"]


def test_no_recorded_match_is_claimed_for_argentina_v_brazil() -> None:
    # the shell needs a score array, so [0, 0] is a placeholder; no result is recorded
    (fx,) = build.national_fixtures(SEASON)
    assert fx["score"] == [0, 0]
    assert fx["result"] is None


def test_the_web_build_reads_only_files_inside_apps_unified() -> None:
    # the web image's Docker context is apps/unified, so data/history is not there at build time
    for path in (build.NATIONAL_SQUADS, build.NATIONAL_HISTORY):
        assert Path(path).is_relative_to(build.U) and Path(path).exists(), path


def test_the_web_copies_match_the_builder() -> None:
    builder = _load(ROOT / "scripts/build_national_squads.py", "build_national_squads")
    squads = json.loads(Path(build.NATIONAL_SQUADS).read_text(encoding="utf-8"))
    assert squads == builder.build()
    history = json.loads(Path(build.NATIONAL_HISTORY).read_text(encoding="utf-8"))
    assert history == builder.fixture_history()


def test_the_fixture_carries_the_real_head_to_head() -> None:
    (fx,) = build.national_fixtures(SEASON)
    assert fx["history"]["h2h"]["played"] > 0
    assert (
        fx["history"]["h2h"]["home_wins"]
        + fx["history"]["h2h"]["draws"]
        + fx["history"]["h2h"]["away_wins"]
        == fx["history"]["h2h"]["played"]
    )
