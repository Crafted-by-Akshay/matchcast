"""Ask and talk on the model: checked answers, the rules as fallback, no lock wait."""

import asyncio
import json
from dataclasses import replace

from conftest import fixed_clock, run
from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents.live import ScriptedModelClient
from matchcast_agents.live.answers import fact_sheet
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


def goals(match, upto: int = 10**9) -> list[dict]:
    return [
        e for e in match["events"]
        if e["payload"]["type"] == "goal" and e["stream_sequence"] <= upto
    ]  # fmt: skip


def scoreline(match, upto: int = 10**9) -> tuple[int, int]:
    """(home, away) goals in the fixture up to a sequence, recounted here from the events."""
    home = sum(1 for g in goals(match, upto) if g["payload"]["team_id"] == "home")
    return home, len(goals(match, upto)) - home


def refusal(match, text: str, cites: list[str], question: str = "Who scored?") -> str | None:
    """The reason the model answer was not shown, or None when it was shown."""
    flow = build(match, answer_model=ask_model(text, cites))
    run(flow.ingest(match["events"]))
    run(flow.ask(question, "casual"))
    return audit_of(flow, "ask_answered")[-1]["details"]["rejected"]


def test_a_scoreline_the_record_does_not_hold_goes_to_the_rules(match) -> None:
    home, away = scoreline(match)
    assert home != away
    # the cited team facts hold both numbers, so only the scoreline binding can refuse this
    text = f"The score reads {away}-{home} so far."
    assert refusal(match, text, ["score", "team:home", "team:away"]) == "scoreline"


def test_a_match_state_the_cited_facts_do_not_give_goes_to_the_rules(match) -> None:
    home, away = scoreline(match)
    text = f"It is full time, {home}-{away}."
    assert refusal(match, text, ["score", "status"]) == "state"


def test_a_match_state_the_cited_facts_give_is_shown(match) -> None:
    home, away = scoreline(match)
    text = f"It is half time and the score is {home}-{away}."
    assert refusal(match, text, ["score", "status"]) is None


def test_who_scored_cites_every_goal_in_the_record_and_names_them(match) -> None:
    scorers = goals(match)
    ids = [f"event:{g['event_id']}" for g in scorers]  # the first goal is long before the last 15
    names = [match["names"][g["payload"]["player_id"]] for g in scorers]
    model = ask_model(" and ".join(names) + " scored.", ids)
    flow = build(match, answer_model=model)
    run(flow.ingest(match["events"]))
    result = run(flow.ask("Who scored?", "casual"))
    assert result.mode == "live"
    assert {c["id"] for c in result.citations} == set(ids)
    assert all(i in facts_of(model.calls[-1]["user"]) for i in ids)


def test_an_answer_with_no_number_and_no_name_from_the_facts_goes_to_the_rules(match) -> None:
    assert refusal(match, "Nobody has scored yet.", ["score"]) == "no_fact"


def test_the_fact_sheet_counts_only_the_events_its_state_has_seen(match) -> None:
    flow = build(match)
    run(flow.ingest(match["events"][:40]))
    # the events read after the state can run ahead of it; the sheet must not count them
    ctx = replace(flow._ctx(), events=tuple(match["events"]))
    facts = {f["id"]: f["text"] for f in fact_sheet(ctx)["facts"]}
    home, away = scoreline(match, upto=40)
    assert facts["score"].startswith(f"score {home}-{away}:")
    later = goals(match)[-1]  # a goal after the state's last sequence
    assert f"event:{later['event_id']}" not in facts


def test_a_rejected_model_answer_records_why_in_the_audit(match) -> None:
    shots = count(match, team="home")
    wrong = refusal(match, "Northgate FC have 99 shots so far.", ["team:home"], "How many?")
    assert wrong == "number"
    assert refusal(match, f"Northgate FC have {shots} shots.", ["team:home"], "How many?") is None


def test_a_scoreline_written_with_a_colon_the_record_does_not_hold_goes_to_the_rules(match) -> None:
    home, away = scoreline(match)
    text = f"The score is {away}:{home} so far."
    assert refusal(match, text, ["score", "team:home", "team:away"]) == "scoreline"


def test_a_win_the_record_does_not_hold_goes_to_the_rules(match) -> None:
    # "tackles won" is in every team fact; it must not make "won the match" look grounded
    assert refusal(match, "Northgate FC have won the match.", ["team:home"]) == "state"


def test_a_second_half_under_way_is_in_play_not_half_time(match) -> None:
    last = match["events"][-1]  # the first half ended; the second half has started since
    second = json.loads(json.dumps(last))
    second.update(
        event_id="e-second-half",
        stream_sequence=last["stream_sequence"] + 1,
        clock={"period": 2, "period_elapsed_ms": 0},
        payload={"type": "period_boundary", "boundary": "started"},
    )
    later = {**match, "events": [*match["events"], second]}
    home, away = scoreline(later)
    assert refusal(later, f"It is half time, {home}-{away}.", ["score", "status"]) == "state"
    assert refusal(later, f"It is in play, {home}-{away}.", ["score", "status"]) is None


def test_a_count_in_a_sentence_naming_one_club_must_be_that_clubs(match) -> None:
    home, away = scoreline(match)
    assert home != away
    # both team facts are cited, so the union holds "goals 2"; the sentence names Northgate FC
    text = f"Northgate FC have {away} goals."
    assert refusal(match, text, ["team:home", "team:away"]) == "count"


def test_a_club_then_a_number_must_be_that_clubs_score(match) -> None:
    home, away = scoreline(match)
    assert home != away
    assert refusal(match, f"Northgate FC {away}, Harbour United {home}.", ["score"]) == "scoreline"
    assert refusal(match, f"Northgate FC {home}, Harbour United {away}.", ["score"]) is None
