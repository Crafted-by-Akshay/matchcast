"""Live agents with recorded model answers: verified lines, a bad draft, outages, fallback."""

import json

from conftest import fixed_clock, run
from matchcast_agents import MatchWorkflow, WorkflowConfig
from matchcast_agents.live import ScriptedModelClient, live_agents
from matchcast_agents.resilience import ModelError, ModelTimeout


def answer(system: str, user: str, *, narrator=None, verifier=None, analyst=None):
    facts = json.loads(user)
    if "personas" in facts:
        return (narrator or good_narrator)(facts)
    if "metrics_available" in facts:
        return (analyst or good_analyst)(facts)
    return (verifier or good_verifier)(facts)


def good_analyst(facts):
    wanted = [m for m in facts["metrics_available"] if m.startswith(("shots:", "goals:"))]
    return {"metrics": wanted[:2]}


def good_narrator(facts):
    values = {c["metric"]: c["value"] for c in facts["claims"]}
    first = next(iter(values))
    team = first.split(":")[1]
    club = facts["clubs"][team]
    metric = first.split(":")[0].replace("_", " ")
    text = f"{club} {metric}: {values[first]}."
    return {"lines": [{"persona": p, "text": text} for p in facts["personas"]]}


def good_verifier(facts):
    return {"judgement": "supported", "detail": "matches the claim"}


def build(match, client):
    config = WorkflowConfig()
    return MatchWorkflow(
        stream=match["roster"]["stream"], roster=match["roster"], names=match["names"],
        clubs=match["teams"], agents=live_agents(client, config.personas), config=config,
        clock=fixed_clock(),
    )  # fmt: skip


def actions(flow):
    return [r["action"] for r in flow.store.audit_records(flow.sk)]


def test_model_written_lines_pass_the_checks_and_publish(match) -> None:
    client = ScriptedModelClient(lambda s, u: answer(s, u))
    flow = build(match, client)
    run(flow.ingest(match["events"]))
    lines = flow.store.lines(flow.sk)
    assert lines and all(ln.origin == "model" for ln in lines)
    assert {ln.status for ln in lines} <= {"published", "approved", "verified"}
    assert flow.status == "live" and "fallback_used" not in actions(flow)
    meaning = [c for ln in lines for c in ln.checks if c.name == "meaning"]
    assert meaning and all(c.passed for c in meaning)


def test_a_wrong_number_in_a_model_line_is_rejected_and_repaired(match) -> None:
    drafts = {"n": 0}

    def narrator(facts):
        drafts["n"] += 1
        reply = good_narrator(facts)
        if "note" not in facts:  # the first draft lies, the repair is honest
            for row in reply["lines"]:
                row["text"] = row["text"].replace(".", " and 99.")
        return reply

    flow = build(match, ScriptedModelClient(lambda s, u: answer(s, u, narrator=narrator)))
    run(flow.ingest(match["events"]))
    acts = actions(flow)
    assert "line_rejected" in acts and "line_repair_requested" in acts
    assert not any("99" in ln.text for ln in flow.store.lines(flow.sk) if ln.status == "published")


def test_the_model_meaning_check_can_reject_or_send_to_review(match) -> None:
    def verifier(facts):
        return {"judgement": "unsupported", "detail": "says more than the claim"}

    flow = build(match, ScriptedModelClient(lambda s, u: answer(s, u, verifier=verifier)))
    run(flow.ingest(match["events"]))
    rejected = [ln for ln in flow.store.lines(flow.sk) if ln.status in ("rejected", "abstained")]
    assert rejected and all(
        ln.reason_code == "unsupported_statement" for ln in rejected if ln.reason_code
    )
    unclear = ScriptedModelClient(
        lambda s, u: answer(s, u, verifier=lambda f: {"judgement": "unclear", "detail": "?"})
    )
    flow = build(match, unclear)
    run(flow.ingest(match["events"]))
    assert any(ln.status == "review" for ln in flow.store.lines(flow.sk))


def test_a_model_outage_falls_back_to_rules_and_is_audited(match) -> None:
    def down(system, user):
        return ModelTimeout()

    flow = build(match, ScriptedModelClient(down))
    run(flow.ingest(match["events"]))
    assert flow.status == "rules_fallback"
    assert "fallback_used" in actions(flow)
    lines = flow.store.lines(flow.sk)
    assert lines and all(ln.origin == "template" for ln in lines)


def test_unknown_metrics_from_the_analyst_are_not_trusted(match) -> None:
    flow = build(
        match,
        ScriptedModelClient(
            lambda s, u: answer(s, u, analyst=lambda f: {"metrics": ["vibes:home"]})
        ),
    )
    run(flow.ingest(match["events"]))
    reasons = [r["details"].get("fallback_reason") for r in flow.store.audit_records(flow.sk)]
    assert "model_error" in reasons
    assert all(c["packet"]["metric"] != "vibes:home" for c in flow.store.claims(flow.sk))


def test_malformed_narrator_output_is_a_model_error(match) -> None:
    client = ScriptedModelClient(
        lambda s, u: answer(s, u, narrator=lambda f: {"lines": [{"persona": "poet", "text": "x"}]})
    )
    flow = build(match, client)
    run(flow.ingest(match["events"]))
    assert "fallback_used" in actions(flow) and ModelError.__name__
