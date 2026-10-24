"""Ask and talk on the model: checked answers, the rules as fallback, no lock wait."""

import asyncio
import json

from conftest import fixed_clock, run
from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents.live import ScriptedModelClient
from matchcast_agents.resilience import ModelError


def build(match, answer_model=None):
    config = WorkflowConfig()
    return MatchWorkflow(
        stream=match["roster"]["stream"], roster=match["roster"], names=match["names"],
        clubs=match["teams"], agents=rules_agents(config.personas), config=config,
        clock=fixed_clock(), answer_model=answer_model,
    )  # fmt: skip


def count(match, *, player=None, team=None) -> int:
    """Shot events in the fixture, recounted here rather than taken from the code under test."""
    return sum(
        1
        for e in match["events"]
        if e["payload"]["type"] == "shot"
        and (player is None or e["payload"].get("player_id") == player)
        and (team is None or e["payload"].get("team_id") == team)
    )


def facts_of(user: str) -> dict:
    return {f["id"]: f["text"] for f in json.loads(user)["facts"]}


def ask_model(answer_text: str, cites: list[str]):
    def model(system: str, user: str):
        return {"answer": answer_text, "cites": cites, "answerable": True}

    return ScriptedModelClient(answers=model)


def audit_of(flow, action: str) -> list[dict]:
    return [r for r in flow.store.audit_records(flow.sk) if r["action"] == action]


def test_a_model_answer_with_its_numbers_in_the_cited_facts_is_shown(match) -> None:
    home_shots = count(match, team="home")
    model = ask_model(f"Northgate FC have {home_shots} shots so far.", ["team:home"])
    flow = build(match, answer_model=model)
    run(flow.ingest(match["events"]))
    result = run(flow.ask("How many shots have Northgate FC had?", "casual"))
    assert result.mode == "live" and not result.abstained
    assert result.answer == f"Northgate FC have {home_shots} shots so far."
    assert result.citations == [{"type": "fact", "id": "team:home"}]
    assert f"shots {home_shots}" in facts_of(model.calls[-1]["user"])["team:home"]


def test_a_number_the_cited_facts_do_not_hold_goes_to_the_rules(match) -> None:
    flow = build(match, answer_model=ask_model("Northgate FC have 99 shots so far.", ["team:home"]))
    run(flow.ingest(match["events"]))
    result = run(flow.ask("How many shots have Northgate FC had?", "casual"))
    assert result.mode == "rules"
    assert "99" not in result.answer
    assert audit_of(flow, "ask_answered")[-1]["details"]["mode"] == "rules"


def test_a_name_not_in_the_match_goes_to_the_rules(match) -> None:
    home_shots = count(match, team="home")
    flow = build(
        match, answer_model=ask_model(f"Lionel Messi has {home_shots} shots.", ["team:home"])
    )
    run(flow.ingest(match["events"]))
    assert run(flow.ask("How many shots by Northgate FC?", "casual")).mode == "rules"


def test_a_citation_that_is_not_a_fact_goes_to_the_rules(match) -> None:
    home_shots = count(match, team="home")
    flow = build(
        match, answer_model=ask_model(f"Northgate FC have {home_shots} shots.", ["team:nowhere"])
    )
    run(flow.ingest(match["events"]))
    assert run(flow.ask("How many shots by Northgate FC?", "casual")).mode == "rules"


def test_a_model_outage_answers_from_the_rules(match) -> None:
    def down(system, user):
        raise ModelError("the model is down")

    flow = build(match, answer_model=ScriptedModelClient(answers=down))
    run(flow.ingest(match["events"]))
    result = run(flow.ask("How many shots have Northgate FC had so far?", "casual"))
    assert result.mode == "rules" and not result.abstained


def test_an_answer_does_not_wait_for_the_ingest_lock(match) -> None:
    home_shots = count(match, team="home")
    flow = build(
        match, answer_model=ask_model(f"Northgate FC have {home_shots} shots.", ["team:home"])
    )
    run(flow.ingest(match["events"]))

    async def ask_during_a_batch():
        async with flow._lock:  # a live batch holds the lock while the agents write
            return await asyncio.wait_for(flow.ask("How many shots by Northgate FC?"), 2)

    assert run(ask_during_a_batch()).mode == "live"


def talk_model(reply: str):
    def model(system: str, user: str):
        return {"reply": reply}

    return ScriptedModelClient(answers=model)


def test_a_player_reply_from_the_model_is_in_character_and_checked(match) -> None:
    player = "home1"
    shots = count(match, player=player)
    model = talk_model(f"Thanks boss, I have {shots} shots so far and I'll keep at it.")
    flow = build(match, answer_model=model)
    run(flow.ingest(match["events"]))
    result = run(flow.talk(player, "How many shots have you had?"))
    assert result["verdict"] == "verified"
    assert result["reply"] == f"Thanks boss, I have {shots} shots so far and I'll keep at it."
    assert audit_of(flow, "talk_answered")[-1]["details"]["origin"] == "model"


def test_a_player_reply_with_a_wrong_count_falls_back_to_the_rules(match) -> None:
    player = "home1"
    shots = count(match, player=player)
    flow = build(match, answer_model=talk_model(f"I have {shots + 1} shots so far."))
    run(flow.ingest(match["events"]))
    result = run(flow.talk(player, "How many shots have you had?"))
    assert result["verdict"] == "verified"
    assert f"{shots} shots" in result["reply"]
    assert audit_of(flow, "talk_answered")[-1]["details"]["origin"] == "rules"


def test_a_player_reply_with_a_count_in_words_is_not_shown(match) -> None:
    player = "home1"
    shots = count(match, player=player)
    words = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six"}
    flow = build(match, answer_model=talk_model(f"I have had {words[shots]} shots, boss."))
    run(flow.ingest(match["events"]))
    result = run(flow.talk(player, "How many shots?"))
    assert words[shots] not in result["reply"]
    assert audit_of(flow, "talk_answered")[-1]["details"]["origin"] == "rules"


def test_a_player_reply_naming_someone_else_falls_back(match) -> None:
    flow = build(match, answer_model=talk_model("Lionel Messi would have scored that one."))
    run(flow.ingest(match["events"]))
    result = run(flow.talk("home1", "What do you think of the match?"))
    assert "Messi" not in result["reply"]
    assert audit_of(flow, "talk_answered")[-1]["details"]["origin"] == "rules"


def test_a_talk_does_not_wait_for_the_ingest_lock(match) -> None:
    flow = build(match, answer_model=talk_model("Understood, boss."))
    run(flow.ingest(match["events"]))

    async def talk_during_a_batch():
        async with flow._lock:
            return await asyncio.wait_for(flow.talk("home1", "How are you?"), 2)

    assert run(talk_during_a_batch())["reply"]


def cited_answer(match, text: str, cites: list[str]) -> str:
    """Ask a model answer through the workflow and return the mode that answered."""
    flow = build(match, answer_model=ask_model(text, cites))
    run(flow.ingest(match["events"]))
    return run(flow.ask("How many shots by Northgate FC?", "casual")).mode


def test_an_ask_answer_names_only_the_entities_of_its_cited_facts(match) -> None:
    home_shots = count(match, team="home")
    # Harbour United is the away side; team:home does not mention it
    assert (
        cited_answer(match, f"Harbour United have {home_shots} shots so far.", ["team:home"])
        == "rules"
    )


def test_an_ask_answer_count_must_be_the_metric_its_cited_fact_gives(match) -> None:
    home_shots = count(match, team="home")
    wrong = home_shots + 1
    assert cited_answer(match, f"Northgate FC have {wrong} shots so far.", ["team:home"]) == "rules"


def test_an_ask_answer_with_a_count_in_words_or_an_ordinal_goes_to_the_rules(match) -> None:
    assert cited_answer(match, "Northgate FC have scored twice.", ["team:home"]) == "rules"
    assert cited_answer(match, "Northgate FC took their 30th shot.", ["team:home"]) == "rules"


def test_an_ask_answer_with_a_single_word_name_not_in_the_match_goes_to_the_rules(match) -> None:
    home_shots = count(match, team="home")
    assert cited_answer(match, f"Messi has {home_shots} shots.", ["team:home"]) == "rules"


def test_an_ask_answer_without_a_number_goes_to_the_rules(match) -> None:
    assert cited_answer(match, "Northgate FC are winning comfortably.", ["score"]) == "rules"


def test_an_ask_answer_the_safety_screen_flags_goes_to_the_rules(match) -> None:
    home_shots = count(match, team="home")
    text = f"Northgate FC have {home_shots} shots so far, unsafe-test-marker."
    assert cited_answer(match, text, ["team:home"]) == "rules"


def test_a_malformed_citation_list_goes_to_the_rules_without_an_error(match) -> None:
    home_shots = count(match, team="home")
    text = f"Northgate FC have {home_shots} shots."
    assert cited_answer(match, text, [["team:home"]]) == "rules"


def test_a_talk_reply_naming_another_player_goes_to_the_rules(match) -> None:
    shots = count(match, player="home1")
    other = match["names"]["home2"]  # a team-mate, not the speaker
    flow = build(
        match, answer_model=talk_model(f"{other} has {shots} shots, I've been watching him.")
    )
    run(flow.ingest(match["events"]))
    run(flow.talk("home1", "How many shots have you had?"))
    assert audit_of(flow, "talk_answered")[-1]["details"]["origin"] == "rules"
