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


def _frozen():
    import sys

    sys.path.insert(0, str(Path(compare.__file__).parent))
    import frozen

    return frozen


def test_frozen_set_is_thirty_moments_across_many_matches():
    rows = _frozen().frozen()
    assert len(rows) == 30
    assert sum(r["type"] == "goal" for r in rows) == 10
    assert len({r["match"] for r in rows}) >= 15
    assert max(sum(r["match"] == m for r in rows) for m in {r["match"] for r in rows}) <= 3


def test_frozen_set_matches_the_season_and_converter():
    """A change to the season data or the event converter must be a reviewed re-freeze."""
    frozen = _frozen()
    assert frozen.draw(compare.moments) == frozen.frozen()


def test_frozen_moments_carry_the_true_state_the_judge_uses():
    frozen = _frozen()
    row = next(r for r in frozen.frozen() if r["type"] == "goal")
    match = frozen.load_season_match(row["match"])
    m = next(x for x in compare.moments(match) if x["event_id"] == row["event_id"])
    assert {k: m[k] for k in row if k != "match"} == {k: v for k, v in row.items() if k != "match"}
    club = match["teams"][m["team_id"]]
    line = (
        f"Goal! {match['names'][m['player_id']]} ({club}) scores. It is {m['score'][m['team_id']]}."
    )
    assert compare.judge(line, m, match)["bad_numbers"] == 0
