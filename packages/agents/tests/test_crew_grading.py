"""CREW-5.1 line grades against the engine log, and CREW-5.2 the three-arm scoreboard.

The grader is pure: no model call, no clock, no I/O. The scoreboard runs the three rules-mode arms
on the match fixture (no model call), so every test here is offline.
"""

import json

import pytest
from matchcast_agents.grading import grade_line, scoreboard
from matchcast_agents.messages import LineRecord

ALLOWED = ["Northgate FC", "Harbour United", "Arlo Dunne"]


def shot(seq: int, team: str, on_target: bool = False) -> dict:
    return {
        "event_id": f"e{seq}",
        "stream_sequence": seq,
        "event_time_ms": seq * 1000,
        "payload": {"type": "shot", "team_id": team, "player_id": "p1", "on_target": on_target},
    }


def claim(metric: str, value: float, seq: int, units: str = "count", cid: str = "claim-m-1"):
    return {
        "claim_id": cid,
        "metric": metric,
        "value": value,
        "units": units,
        "max_evidence_sequence": seq,
    }


LOG = [shot(1, "home"), shot(2, "home"), shot(3, "away")]


# ---- CREW-5.1: grade one line -------------------------------------------------------------


def test_a_correct_shot_count_is_graded_correct_with_its_engine_value():
    grade = grade_line(
        "Northgate FC took 2 shots.", [claim("shots:home", 2, 2)], LOG, ALLOWED, line_id="l1"
    )
    assert grade["verdict"] == "correct"
    assert grade["claims"][0]["engine_value"] == 2
    assert grade["claims"][0]["claim_value"] == 2
    assert grade["numbers"][0]["verdict"] == "correct"
    assert grade["wrong_numbers"] == 0
    assert grade["line_id"] == "l1"


def test_a_wrong_shot_count_holds_the_engine_value_the_line_value_and_an_incorrect_verdict():
    grade = grade_line("Northgate FC took 3 shots.", [claim("shots:home", 3, 2)], LOG, ALLOWED)
    assert grade["verdict"] == "incorrect"
    assert grade["claims"][0]["engine_value"] == 2  # the log says two
    assert grade["claims"][0]["claim_value"] == 3  # the claim says three
    assert grade["claims"][0]["verdict"] == "incorrect"
    assert grade["numbers"][0]["line_value"] == 3
    assert grade["numbers"][0]["verdict"] == "incorrect"
    assert grade["wrong_numbers"] == 1


def test_a_name_that_is_not_in_the_roster_makes_the_line_incorrect():
    grade = grade_line("Dario Vance has 2 shots.", [claim("shots:home", 2, 2)], LOG, ALLOWED)
    assert grade["verdict"] == "incorrect"
    assert grade["unknown_names"] == ["Dario Vance"]


def test_a_history_fact_is_unverifiable_never_correct():
    # elo is reference data, not something the engine log can count
    grade = grade_line(
        "Northgate FC are rated 1500.",
        [claim("elo:home", 1500, 2, units="count")],
        LOG,
        ALLOWED,
    )
    assert grade["claims"][0]["engine_value"] is None
    assert grade["claims"][0]["verdict"] == "unverifiable"
    assert grade["verdict"] == "unverifiable"


def test_a_line_with_no_claims_is_unverifiable_never_correct():
    grade = grade_line("Strong pressure from Northgate FC.", [], LOG, ALLOWED)
    assert grade["verdict"] == "unverifiable"


def test_a_line_record_is_graded_from_its_text_and_keeps_its_id():
    record = LineRecord(
        line_id="line-m-e2-casual-0",
        moment_id="m-e2",
        claim_ids=["claim-m-1"],
        persona="casual",
        text="Northgate FC took 2 shots.",
        status="published",
        created_at="2026-10-25T10:00:00.000Z",
        snapshot_revision=2,
    )
    grade = grade_line(record, [claim("shots:home", 2, 2)], LOG, ALLOWED)
    assert grade["line_id"] == "line-m-e2-casual-0"
    assert grade["verdict"] == "correct"


def test_grading_the_same_line_twice_gives_the_same_grade():
    args = ("Northgate FC took 3 shots.", [claim("shots:home", 3, 2)], LOG, ALLOWED)
    assert grade_line(*args) == grade_line(*args)


# ---- CREW-5.2: the scoreboard on the match fixture -----------------------------------------


@pytest.fixture(scope="module")
def board(match):
    return scoreboard(match, run_date="2026-10-25")


def test_the_scoreboard_has_three_arms_with_the_metrics_and_the_run_date(board):
    assert set(board) == {
        "kind",
        "match_id",
        "run_date",
        "seed",
        "seed_rate",
        "moments",
        "seeded_wrong_claims",
        "arms",
        "difference",
        "method",
    }
    assert board["run_date"] == "2026-10-25"
    assert set(board["arms"]) == {"full_crew", "single_agent", "crew_no_verifier"}
    for arm in board["arms"].values():
        assert set(arm) == {
            "label",
            "mode",
            "run_id",
            "lines_aired",
            "wrong_lines_aired",
            "accuracy",
            "catch_rate",
            "latency_ms",
            "cost",
            "wrong_claim_ids",
            "wrong_claim_ids_stated",
        }
        assert set(arm["accuracy"]) == {"wrong_numbers_aired", "numbers_aired", "wrong_rate"}
        assert set(arm["catch_rate"]) == {"caught", "seeded", "rate"}
        assert set(arm["latency_ms"]) == {"p50", "p95", "total", "moments"}
        assert arm["mode"] == "live"  # rules-mode arms run live on each request
        assert arm["run_id"]


def test_the_scoreboard_is_json_serialisable(board):
    assert json.loads(json.dumps(board))["arms"].keys() == board["arms"].keys()


def test_the_full_crew_catches_every_seeded_wrong_number_the_no_verifier_arm_lets_through(board):
    arms = board["arms"]
    let_through = set(arms["crew_no_verifier"]["wrong_claim_ids_stated"])
    assert let_through, "the seeded wrong claims must reach an aired line without the Verifier"
    assert let_through <= set(arms["crew_no_verifier"]["wrong_claim_ids"])
    assert arms["full_crew"]["wrong_claim_ids_stated"] == []
    assert arms["full_crew"]["wrong_claim_ids"] == []
    assert arms["full_crew"]["catch_rate"]["caught"] == board["seeded_wrong_claims"]
    no_verifier = arms["crew_no_verifier"]["catch_rate"]
    assert no_verifier["caught"] == board["seeded_wrong_claims"] - len(let_through)


def test_the_no_verifier_arm_airs_more_wrong_lines_or_the_page_says_no_difference(board):
    diff = board["difference"]
    assert (
        diff["crew_no_verifier_wrong_lines"]
        == board["arms"]["crew_no_verifier"]["wrong_lines_aired"]
    )
    if diff["found"]:
        assert diff["crew_no_verifier_wrong_lines"] > diff["full_crew_wrong_lines"]
    else:
        assert "No difference was found" in diff["note"]
    assert diff["found"] is True  # the fixture seeds wrong claims, so this arm does air some


def test_cost_is_counted_from_model_calls_and_no_price_is_applied(board):
    for arm in board["arms"].values():
        assert set(arm["cost"]) == {"model_calls", "model_calls_per_line", "basis"}
        assert arm["cost"]["model_calls"] == 0  # rules twins make no model call
        assert arm["cost"]["model_calls_per_line"] in (0.0, None)
        assert "no price" in arm["cost"]["basis"]  # a call count, never a made-up price


def test_the_same_seed_gives_the_same_seeded_claims_grades_and_run_ids(board, match):
    again = scoreboard(match, run_date="2026-10-25")
    for key in board["arms"]:
        a, b = board["arms"][key], again["arms"][key]
        for field in ("run_id", "lines_aired", "wrong_lines_aired", "accuracy", "catch_rate"):
            assert a[field] == b[field], (key, field)
        assert a["wrong_claim_ids"] == b["wrong_claim_ids"]


def test_a_precomputed_arm_is_labelled_precomputed_with_its_run_id(match):
    recorded = {
        "model_crew": {
            "label": "Full crew on Foundry",
            "run_id": "rec-2026-10-22-a",
            "lines_aired": 4,
            "wrong_lines_aired": 0,
            "accuracy": {"wrong_numbers_aired": 0, "numbers_aired": 6, "wrong_rate": 0.0},
            "catch_rate": {"caught": 0, "seeded": 0, "rate": None},
            "latency_ms": {"p50": 1.0, "p95": 2.0, "total": 3.0, "moments": 4},
            "cost": {"model_calls": 16, "model_calls_per_line": 4.0, "basis": "recorded run"},
            "wrong_claim_ids": [],
        }
    }
    out = scoreboard(match, run_date="2026-10-25", precomputed=recorded)
    arm = out["arms"]["model_crew"]
    assert arm["mode"] == "precomputed"
    assert "precomputed" in arm["label"] and "rec-2026-10-22-a" in arm["label"]


def test_a_precomputed_arm_without_a_run_id_is_refused(match):
    with pytest.raises(ValueError):
        scoreboard(match, precomputed={"model_crew": {"label": "x"}})
