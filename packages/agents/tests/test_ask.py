"""Assistant in rules mode (AGT-16): route, cited answers, abstain, drop on bad citations."""

from pathlib import Path

import pytest
from conftest import run
from matchcast_agents.ask import Assistant, Bm25Index, load_kb
from matchcast_agents.ask.assistant import ABSTAIN, OUT_OF_SCOPE, WORD_LIMIT, check_citations, route

KB = Path(__file__).parents[3] / "kb"


@pytest.fixture(scope="module")
def assistant():
    return Assistant(Bm25Index(load_kb(KB)))


@pytest.fixture
def flow(make_workflow, match):
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    return flow


def ask(assistant, flow, question, persona="casual"):
    return run(assistant.ask(flow, question, persona))


def test_live_question_is_answered_from_claims(assistant, flow) -> None:
    result = ask(assistant, flow, "How many shots has Northgate FC had so far?")
    assert result.intent == "live" and not result.abstained
    assert "Northgate FC" in result.answer
    assert all(c["type"] == "claim" for c in result.citations)
    assert flow.store.get_claim(flow.sk, result.citations[0]["id"])


def test_knowledge_question_cites_the_kb(assistant, flow) -> None:
    result = ask(assistant, flow, "How is xG worked out?")
    assert result.intent == "knowledge" and not result.abstained
    assert result.citations and result.citations[0]["id"].startswith("metrics:xg")


def test_both_question_mixes_claim_and_kb(assistant, flow) -> None:
    result = ask(assistant, flow, "How many shots on target so far, and what counts as one?")
    assert result.intent == "both"
    assert {c["type"] for c in result.citations} == {"claim", "kb"}


def test_out_of_scope_and_unanswerable(assistant, flow) -> None:
    assert ask(assistant, flow, "What is the capital of France?").answer == OUT_OF_SCOPE
    result = ask(assistant, flow, "Who will win the match tomorrow?")
    assert result.abstained and result.answer in (OUT_OF_SCOPE, ABSTAIN)


def test_answers_fit_persona_word_limits(assistant, flow) -> None:
    for persona, limit in WORD_LIMIT.items():
        result = ask(assistant, flow, "What is offside?", persona)
        plain = " ".join(w for w in result.answer.split() if not w.startswith("[kb:"))
        assert len(plain.split()) <= max(limit, 40)


def test_citation_check_rejects_missing_unknown_and_foreign_numbers() -> None:
    kb = {"a:b:1": "A tackle is won when the team gets the ball. Ten players."}
    claims = {"c1": {"value": 7}}
    assert check_citations("No cite here.", kb, claims) == (False, "citation_missing")
    assert check_citations("Hi [kb:zzz]", kb, claims) == (False, "unknown_source")
    assert check_citations("Shots 7. [claim:c1]", kb, claims)[0]
    assert check_citations("Shots 8. [claim:c1]", kb, claims) == (False, "number_mismatch")


def test_route_is_deterministic(assistant, flow) -> None:
    ctx = flow._ctx()
    a = route(ctx, "How many fouls so far?", assistant.index)
    assert a == route(ctx, "How many fouls so far?", assistant.index)
    assert a.intent == "live"


def test_golden_set_meets_the_quality_gate(assistant, flow) -> None:
    """05 §9 gate: 40 questions, 5/5 unanswerable abstained, every answer cited and verified."""
    import json

    rows = [
        json.loads(line)
        for line in (KB.parent / "eval" / "ask_golden.jsonl").read_text().splitlines()
    ]
    assert len(rows) == 40
    hits = answered = 0
    for row in rows:
        result = ask(assistant, flow, row["q"])
        if row["kind"] == "unanswerable":
            assert result.abstained, row["q"]
            continue
        assert not result.abstained, row["q"]
        assert result.citations, row["q"]
        answered += 1
        if row["kind"] == "knowledge":
            hits += any(c["id"].startswith(row["expect_kb"]) for c in result.citations)
        if row["kind"] == "live":
            assert result.intent == "live", row["q"]
    knowledge = sum(r["kind"] == "knowledge" for r in rows)
    assert hits / knowledge >= 0.90
    assert answered == 35
