"""DAT-5 scene dataset: fixed labelling rules, the danger label and its time window, no leakage,
and byte-identical output for the same inputs. Runs on hand-made events, no simulator."""

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pyarrow.parquet as pq
import pytest

SPEC = importlib.util.spec_from_file_location(
    "generate_scenes", Path(__file__).parents[1] / "scripts" / "generate_scenes.py"
)
scenes = importlib.util.module_from_spec(SPEC)
sys.modules["generate_scenes"] = scenes
SPEC.loader.exec_module(scenes)


def ev(t: float, etype: str, team: str = "home", **extra) -> dict:
    return {"simT": t, "minute": round(t / 60, 2), "type": etype, "team": team, **extra}


def test_set_piece_wins_over_every_other_rule() -> None:
    window = [ev(0, "pass", phase="counter"), ev(1, "pass", phase="counter"), ev(2, "corner")]
    assert scenes.classify(window) == "set_piece"
    assert scenes.classify([ev(0, "freekick")]) == "set_piece"


def test_counter_attack_needs_two_counter_passes() -> None:
    one = [ev(0, "pass", phase="counter"), ev(1, "pass")]
    two = [ev(0, "pass", phase="counter"), ev(1, "pass", phase="counter")]
    assert scenes.classify(one) != "counter_attack"
    assert scenes.classify(two) == "counter_attack"


def test_high_press_chaos_possession_and_quiet() -> None:
    press = [ev(0, "turnover", ownX=70), ev(1, "turnover", ownX=66)]
    assert scenes.classify(press) == "high_press"
    chaos = [ev(i, "turnover", ownX=10) for i in range(6)]
    assert scenes.classify(chaos) == "chaotic_scramble"
    build = [ev(i, "pass") for i in range(12)] + [ev(13, "turnover", ownX=10)]
    assert scenes.classify(build) == "possession_build_up"
    quiet = [ev(i, "pass") for i in range(5)]
    assert scenes.classify(quiet) == "quiet_spell"
    assert scenes.classify([ev(0, "shot")]) == ""  # a shot spoils a quiet spell
    assert (
        scenes.classify(
            [ev(i, "pass") for i in range(13)]
            + [ev(14, "turnover"), ev(15, "turnover"), ev(16, "turnover")]
        )
        == ""
    )


def test_windows_cut_30_second_blocks_and_skip_empty_ones() -> None:
    events = [ev(0, "pass"), ev(10, "pass"), ev(31, "pass"), ev(95, "pass"), ev(96, "throw_in")]
    cut = scenes.windows(events)
    assert [[e["simT"] for e in w] for w in cut] == [[0, 10], [31], [95, 96]]
    assert scenes.windows([ev(1, "dribble")]) == []  # not an event type the dataset keeps


def test_danger_is_the_same_teams_shot_in_the_next_ten_seconds() -> None:
    context = [
        ev(0, "pass", "home"),
        ev(5, "pass", "away"),
        ev(9, "shot", "home"),  # within 10 s of t=0 and t=5
        ev(20, "shot", "home"),  # more than 10 s after t=9
        ev(25, "shot", "away"),
    ]
    rows = scenes.rows_for("s", "quiet_spell", 1, context[:3], context)
    assert [r["danger"] for r in rows] == [1, 0, 0]  # away's pass at 5 has no away shot by 15
    late = scenes.rows_for("s", "quiet_spell", 1, [context[3]], context)
    assert late[0]["danger"] == 0  # a shot's own row is not danger: it looks strictly after


def test_features_look_back_only_and_never_include_the_label_window() -> None:
    context = [ev(0, "pass"), ev(4, "turnover"), ev(8, "shot"), ev(12, "pass"), ev(16, "shot")]
    row = scenes.rows_for("s", "quiet_spell", 1, [context[3]], context)[0]
    assert (row["passes_prev_10s"], row["turnovers_prev_10s"], row["shots_prev_10s"]) == (0, 1, 1)
    assert row["danger"] == 1  # the shot at 16 is the label; it is not in any feature


def test_schema_covers_every_row_key() -> None:
    row = scenes.rows_for("s", "quiet_spell", 1, [ev(0, "pass")], [ev(0, "pass")])[0]
    assert set(row) == set(scenes.SCHEMA.names)


def write_log(folder: Path, seed: int) -> None:
    events = []
    for k in range(40):  # a spread of passes and turnovers over 20 minutes
        t = k * 31.0
        events += [ev(t, "pass", phase="counter"), ev(t + 1, "pass", phase="counter")]
        events += [ev(t + 2, "shot" if k % 3 == 0 else "pass")]
    for k in range(10):
        events += [ev(5000 + k * 40, "corner")]
    (folder / f"{seed}.json").write_text(json.dumps({"seed": seed, "events": events}))


def run(folder: Path, out: Path, monkeypatch: pytest.MonkeyPatch) -> dict:
    monkeypatch.setattr(
        sys, "argv",
        ["generate_scenes", "--count", "12", "--events-dir", str(folder), "--out", str(out)],
    )  # fmt: skip
    scenes.main()
    return json.loads((out / "manifest.json").read_text())


def test_same_events_give_byte_identical_files(tmp_path, monkeypatch) -> None:
    logs = tmp_path / "logs"
    logs.mkdir()
    for seed in (2026, 2027):
        write_log(logs, seed)
    first = run(logs, tmp_path / "a", monkeypatch)
    second = run(logs, tmp_path / "b", monkeypatch)
    for name in ("scenes.parquet", "manifest.json"):
        digest = [hashlib.sha256((tmp_path / d / name).read_bytes()).hexdigest() for d in "ab"]
        assert digest[0] == digest[1], name
    assert first == second and first["rows"] > 0
    table = pq.read_table(tmp_path / "a" / "scenes.parquet")
    assert table.schema.names == scenes.SCHEMA.names
    assert set(table.column("family").to_pylist()) <= set(scenes.FAMILIES)
    assert first["scenes_per_family"]["counter_attack"] <= 2  # count 12 over 6 families
