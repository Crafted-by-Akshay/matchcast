"""National squads are synthetic: fictional names, 23 players, strength from the results."""

import importlib.util
import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQUADS = ROOT / "data/history/national_squads.json"


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


builder = _load(ROOT / "scripts/build_national_squads.py", "build_national_squads")
guard = _load(ROOT / "tests/test_synthetic_names.py", "test_synthetic_names")


def test_committed_squads_match_the_builder() -> None:
    assert json.loads(SQUADS.read_text(encoding="utf-8")) == builder.build()


def test_every_squad_is_labelled_and_has_23_numbered_players() -> None:
    for nation, squad in json.loads(SQUADS.read_text(encoding="utf-8")).items():
        assert squad["label"] == "synthetic squad", nation
        numbers = [p["shirt"] for p in squad["players"]]
        assert numbers == list(range(1, 24)), nation
        assert all(p["synthetic"] for p in squad["players"]), nation


def test_no_player_has_a_real_footballer_surname() -> None:
    for squad in json.loads(SQUADS.read_text(encoding="utf-8")).values():
        for p in squad["players"]:
            assert not guard.surnames([p["name"]]) & guard.BLOCKLIST, p["name"]
            assert not builder._is_real(p["name"]), p["name"]


def test_strength_follows_elo() -> None:
    squads = builder.build(date(2026, 10, 25))
    argentina, brazil = squads["Argentina"], squads["Brazil"]
    assert argentina["elo"] > brazil["elo"]
    mean = lambda s: sum(p["rating"] for p in s["players"]) / len(s["players"])  # noqa: E731
    assert mean(argentina) > mean(brazil)
