"""The A/B harness must judge independently of the Verifier and catch a sloppy single model."""

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "compare", Path(__file__).resolve().parent.parent / "eval" / "compare.py"
)
compare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compare)


def test_moments_are_frozen_and_counted():
    match = compare.load_match()
    ms = compare.moments(match)
    assert len(ms) == 22
    assert ms[-1]["score"] == {"home": 1, "away": 2} or sum(ms[-1]["score"].values()) == 3


def test_judge_flags_wrong_number_and_unknown_name():
    match = compare.load_match()
    m = next(x for x in compare.moments(match) if x["type"] == "goal")
    club = match["teams"][m["team_id"]]
    player = match["names"][m["player_id"]]
    good = f"Goal! {player} ({club}) scores. It is {m['score'][m['team_id']]}-0."
    assert compare.judge(good, m, match) == {"bad_numbers": 0, "bad_names": 0}
    bad = f"Goal! Dario Vance ({club}) scores. It is 7-0."
    out = compare.judge(bad, m, match)
    assert out["bad_numbers"] >= 1 and out["bad_names"] == 1


def test_four_agent_arm_is_clean_and_beats_a_slipping_model():
    result = compare.compare(runs=2, slip=0.3)
    four = result["arms"]["four_agent_rules"]
    single = result["arms"]["single_agent"]
    assert four["bad_numbers_per_100_lines"]["max"] == 0
    assert four["bad_names_per_100_lines"]["max"] == 0
    assert single["wrong_line_rate"]["mean"] > four["wrong_line_rate"]["mean"]
