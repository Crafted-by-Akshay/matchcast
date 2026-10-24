"""A talk with an instruction: the role guard decides the order, the Verifier checks the words."""

import json

from conftest import fixed_clock, run
from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents.live import ScriptedModelClient
from matchcast_agents.roles.orders import ACK, REFUSAL
from matchcast_agents.verify.checks import extract_names


def build(match, answer_model=None):
    config = WorkflowConfig()
    return MatchWorkflow(
        stream=match["roster"]["stream"], roster=match["roster"], names=match["names"],
        clubs=match["teams"], agents=rules_agents(config.personas), config=config,
        clock=fixed_clock(), answer_model=answer_model,
    )  # fmt: skip


def flow_with(match, answer_model=None):
    flow = build(match, answer_model)
    run(flow.ingest(match["events"]))
    return flow


def test_a_keeper_told_to_shoot_is_refused_in_character(match) -> None:
    reply = run(flow_with(match).talk("home1", "shoot from range", position="GK"))
    assert reply["order"] == {"key": "shoot", "accepted": False}
    assert reply["reply"] == REFUSAL["keeper"]
    assert reply["verdict"] == "verified" and reply["facts"]


def test_a_striker_told_to_drop_deeper_is_accepted(match) -> None:
    reply = run(flow_with(match).talk("home9", "drop deeper and help the midfield", position="ST"))
    assert reply["order"] == {"key": "deep", "accepted": True}
    assert reply["reply"] == ACK["deep"] and reply["verdict"] == "verified"


def test_a_question_with_no_instruction_has_no_order(match) -> None:
    reply = run(flow_with(match).talk("home9", "How many shots have you had?", position="ST"))
    assert reply["order"] is None and "shots" in reply["reply"]


def test_every_refusal_and_acknowledgement_passes_the_verifier() -> None:
    for line in [*REFUSAL.values(), *ACK.values()]:
        assert not extract_names(line), line
        assert len(line.split()) <= 60


def test_an_order_is_audited_with_its_verdict(match) -> None:
    flow = flow_with(match)
    run(flow.talk("home1", "shoot from range", position="GK"))
    record = flow.store.audit_records(flow.sk)[-1]
    assert record["action"] == "talk_answered"
    assert record["details"]["order"] == {"key": "shoot", "accepted": False}


def test_a_live_model_order_outside_the_role_is_refused_and_its_words_replaced(match) -> None:
    def model(system: str, user: str):
        return {"reply": "On it, boss. I'm going up for a shot.", "order": "shoot"}

    flow = flow_with(match, ScriptedModelClient(answers=model))
    reply = run(flow.talk("home1", "go and shoot", position="GK"))
    assert reply["order"] == {"key": "shoot", "accepted": False}
    assert reply["reply"] == REFUSAL["keeper"]


def test_a_live_model_order_inside_the_role_keeps_the_models_reply(match) -> None:
    def model(system: str, user: str):
        return {"reply": "Okay, boss. I'll keep my line and play it short.", "order": "simple"}

    flow = flow_with(match, ScriptedModelClient(answers=model))
    reply = run(flow.talk("home1", "keep it simple", position="GK"))
    assert reply["order"] == {"key": "simple", "accepted": True}
    assert reply["reply"] == "Okay, boss. I'll keep my line and play it short."


def test_the_player_prompt_is_given_the_orders_his_role_allows(match) -> None:
    model = ScriptedModelClient(answers=lambda s, u: {"reply": "Right, boss.", "order": "none"})
    run(flow_with(match, model).talk("home1", "how are you", position="GK"))
    facts = json.loads(model.calls[-1]["user"])
    assert sorted(facts["you"]["allowed_orders"]) == ["clear", "deep", "rest", "simple"]
    assert facts["you"]["position"] == "GK"


def match_talk_names(match, flow) -> list[str]:
    """Names of players in the last events of the match, recounted from the event log."""
    events = flow._ctx().events[-8:]
    return [
        match["names"][e["payload"]["player_id"]] for e in events if "player_id" in e["payload"]
    ]


def test_the_player_can_talk_about_a_recent_event_by_a_teammate_or_opponent(match) -> None:
    flow = flow_with(match)
    other = match_talk_names(match, flow)[-1]
    reply = f"Okay, boss. {other} had that pass, I saw it from here."

    flow = flow_with(
        match, ScriptedModelClient(answers=lambda s, u: {"reply": reply, "order": "none"})
    )
    result = run(flow.talk("home1", "what happened just now?", position="GK"))
    assert result["reply"] == reply and result["verdict"] == "verified"


def test_a_name_that_is_not_in_the_recent_events_is_not_said_by_the_model(match) -> None:
    reply = "Okay, boss. Zed Quorrin had that pass, I saw it from here."
    flow = flow_with(
        match, ScriptedModelClient(answers=lambda s, u: {"reply": reply, "order": "none"})
    )
    result = run(flow.talk("home1", "what happened just now?", position="GK"))
    assert (
        result["reply"] != reply
    )  # the rules answer replaces a model reply with a name it cannot cite
    assert result["verdict"] == "verified"
