"""The per-agent eval must run offline, hold its floors, and match the committed report."""

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("agents_eval", ROOT / "eval" / "agents_eval.py")
agents_eval = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agents_eval)

RESULT = agents_eval.evaluate(agents_eval.rules_agents, "rules")


def test_rules_agents_hold_the_floor():
    assert RESULT["producer"]["must_cover_recall"] == 1.0
    assert RESULT["analyst"]["claim_accuracy"] == 1.0
    assert RESULT["narrator"]["faithful_rate"] == 1.0
    assert RESULT["seeded_bad_claim"]["caught_rate"] == 1.0
    assert RESULT["seeded_bad_claim"]["wrong_claims_shown_total"] == 0
    assert RESULT["verifier"]["false_reject_rate_on_clean"] == 0.0
    assert RESULT["verifier"]["catch_rate"] >= 0.95
    assert RESULT["ask"]["unanswerable_refusal_rate"] == 1.0
    assert RESULT["ask"]["redteam_stopped_rate"] == 1.0


def test_the_blind_spot_is_reported_not_hidden():
    spot = RESULT["verifier"]["known_blind_spot_other_team_player"]
    assert spot["tried"] > 0 and spot["rate"] == 0.0


def test_every_mutation_kind_is_exercised():
    kinds = set(RESULT["verifier"]["by_mutation"])
    assert kinds >= {
        "number_in_text_changed",
        "claim_value_off_by_one",
        "wrong_unit",
        "invented_player",
        "claim_stale",
        "line_too_long",
    }


def test_committed_results_are_current():
    committed = json.loads((ROOT / "eval" / "results" / "agents.json").read_text())
    assert committed == json.loads(json.dumps(RESULT)), "run: python eval/agents_eval.py"
    assert (ROOT / "docs" / "eval" / "agents-eval.md").read_text() == agents_eval.report(RESULT)
