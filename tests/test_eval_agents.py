"""The per-agent eval must run offline, hold its floors, and match the committed report."""

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("agents_eval", ROOT / "eval" / "agents_eval.py")
agents_eval = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agents_eval)


@pytest.fixture(scope="module")
def result():
    return agents_eval.evaluate(agents_eval.rules_agents, "rules")


def test_rules_agents_hold_the_floor(result):
    assert result["producer"]["must_cover_recall"] == 1.0
    assert result["analyst"]["claim_accuracy"] == 1.0
    assert result["narrator"]["first_draft_faithful_rate"] == 1.0
    assert result["seeded_bad_claim"]["injected"] == result["seeded_bad_claim"]["trials"]
    assert result["seeded_bad_claim"]["caught_rate"] == 1.0
    assert result["seeded_bad_claim"]["wrong_claims_shown_total"] == 0
    assert result["verifier"]["false_reject_rate_on_clean"] == 0.0
    assert result["verifier"]["catch_rate"] >= 0.95
    assert result["ask"]["unanswerable_refusal_rate"] == 1.0
    assert result["ask"]["redteam_stopped_rate"] == 1.0
    assert result["ask"]["redteam_missed"] == []


def test_the_blind_spot_is_reported_not_hidden(result):
    spot = result["verifier"]["known_blind_spot_other_team_player"]
    assert spot["tried"] > 0 and spot["rate"] is not None  # listed; fixing it only raises the rate


def test_every_mutation_kind_is_exercised(result):
    kinds = set(result["verifier"]["by_mutation"])
    assert kinds >= {
        "number_in_text_changed",
        "claim_value_off_by_one",
        "wrong_unit",
        "invented_player",
        "claim_stale",
        "line_too_long",
        "source_forged",
    }
    assert all(d["rate"] == 1.0 for k, d in result["verifier"]["by_mutation"].items()
               if k != "number_in_text_changed")  # fmt: skip


def test_committed_results_are_current(result):
    committed = json.loads((ROOT / "eval" / "results" / "agents.json").read_text())
    assert committed == json.loads(json.dumps(result)), "run: python eval/agents_eval.py"
    assert (ROOT / "docs" / "eval" / "agents-eval.md").read_text() == agents_eval.report(result)
