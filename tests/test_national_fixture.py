"""Watch can play Argentina v Brazil: national clubs and one flagged fixture, synthetic squads."""

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = _load(ROOT / "apps/unified/build.py", "unified_build")
guard = _load(ROOT / "tests/test_synthetic_names.py", "test_synthetic_names")
TEMPLATE = {
    "setup": {
        "stadium": "Stadium",
        "city": "City",
        "month": 5,
        "kickoff": "15:00",
        "seed": 1,
        "half": 45,
    },
    "formations": ["4-3-3", "4-4-2"],
    "styles": ["balanced", "press"],
}


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
    (fx,) = build.national_fixtures(TEMPLATE)
    assert fx["id"] == "N001" and fx["national"] is True
    assert fx["home"]["club"] == "Argentina" and fx["away"]["club"] == "Brazil"
    assert fx["label"] == "synthetic squad"
    assert fx["stIndex"] == build.MSI_STADIUM["mexico"]
    assert fx["setup"]["seed"] == build.NATIONAL_SEED
    assert fx["formations"] == TEMPLATE["formations"] and fx["styles"] == TEMPLATE["styles"]
