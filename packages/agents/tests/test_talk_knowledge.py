"""A player talks from his squad and the knowledge base; the Verifier still checks every name."""

import json
from pathlib import Path

from conftest import fixed_clock, run
from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents.ask import kb_root
from matchcast_agents.ask.retrieval import Bm25Index
from matchcast_agents.live import ScriptedModelClient
from matchcast_agents.live.knowledge import Squad, TalkKnowledge, load_squads, parse_squad

HAR_PAGE = Path(kb_root() / "clubs" / "har.md").read_text(encoding="utf-8")


def squad_for(match) -> Squad:
    """A squad for each of the fixture's two clubs, with the fixture's own player names."""
    home = tuple((match["names"][p], "striker") for p in ("home9", "home1"))
    away = tuple((match["names"][p], "left winger") for p in ("away1", "away2"))
    return Squad(club=match["teams"]["home"], players=home), Squad(
        club=match["teams"]["away"], players=away
    )


def knowledge_for(match) -> TalkKnowledge:
    home, away = squad_for(match)
    return TalkKnowledge(squads={home.club: home, away.club: away}, index=Bm25Index(kb_chunks()))


def kb_chunks():
    from matchcast_agents.ask.chunking import load_kb

    return load_kb(kb_root())


def build(match, answer_model=None, knowledge=None):
    config = WorkflowConfig()
    return MatchWorkflow(
        stream=match["roster"]["stream"], roster=match["roster"], names=match["names"],
        clubs=match["teams"], agents=rules_agents(config.personas), config=config,
        clock=fixed_clock(), answer_model=answer_model, knowledge=knowledge,
    )  # fmt: skip


def flow_with(match, answer_model=None, knowledge=None):
    flow = build(match, answer_model, knowledge)
    run(flow.ingest(match["events"]))
    return flow


def test_a_squad_page_gives_names_and_positions_in_words_and_no_numbers() -> None:
    squad = parse_squad(HAR_PAGE)
    assert squad is not None and squad.club == "Harbor City"
    assert ("Z. Morinari", "left back") in squad.players
    assert ("N. Navlano", "goalkeeper") in squad.players
    assert len(squad.players) == 11
    assert not any(ch.isdigit() for line in squad.lines() for ch in line)


def test_the_kb_has_a_squad_for_every_club_page() -> None:
    squads = load_squads(kb_root())
    assert "Harbor City" in squads
    assert all(squad.players for squad in squads.values())


def test_the_knowledge_base_passage_about_the_speaker_is_found() -> None:
    passages = TalkKnowledge.from_kb(kb_root()).passages("Z. Morinari who are the forwards")
    assert passages and any("Morinari" in p for p in passages)
    assert all(len(p) <= 420 and not any(ch.isdigit() for ch in p) for p in passages)


def test_a_squad_name_with_an_initial_passes_the_verifier(match) -> None:
    # kb names carry an initial ("Z. Morinari"); the Verifier must accept the reply, not fall back
    squad = parse_squad(HAR_PAGE)
    knowledge = TalkKnowledge(
        squads={match["teams"]["home"]: Squad(club=match["teams"]["home"], players=squad.players)},
        index=Bm25Index(kb_chunks()),
    )
    reply = "Okay, boss. Z. Morinari and me up front, I reckon."
    model = ScriptedModelClient(answers=lambda s, u: {"reply": reply, "order": "none"})
    result = run(flow_with(match, model, knowledge).talk(
        "home1", "who are the forwards?", position="GK"
    ))  # fmt: skip
    assert result["reply"] == reply and result["verdict"] == "verified"


def test_the_model_is_given_both_squads_and_the_passages(match) -> None:
    model = ScriptedModelClient(answers=lambda s, u: {"reply": "Right, boss.", "order": "none"})
    knowledge = knowledge_for(match)
    run(flow_with(match, model, knowledge).talk("home1", "who are the forwards?", position="GK"))
    facts = json.loads(model.calls[-1]["user"])
    home, away = squad_for(match)
    assert facts["team_sheet"][home.club] == home.lines()
    assert facts["team_sheet"][away.club] == away.lines()
    assert isinstance(facts["knowledge"], list)


def test_a_squad_answer_with_names_from_the_sheet_is_verified(match) -> None:
    home, _ = squad_for(match)
    reply = f"Okay, boss. {home.players[0][0]} and me up front, I reckon."
    model = ScriptedModelClient(answers=lambda s, u: {"reply": reply, "order": "none"})
    result = run(flow_with(match, model, knowledge_for(match)).talk(
        "home1", "who are the forwards?", position="GK"
    ))  # fmt: skip
    assert result["reply"] == reply and result["verdict"] == "verified"


def test_a_name_that_is_on_neither_squad_is_not_said_by_the_model(match) -> None:
    reply = "Okay, boss. Zed Quorrin is the one to watch up front."
    model = ScriptedModelClient(answers=lambda s, u: {"reply": reply, "order": "none"})
    result = run(flow_with(match, model, knowledge_for(match)).talk(
        "home1", "who are the forwards?", position="GK"
    ))  # fmt: skip
    assert result["reply"] != reply and result["verdict"] == "verified"


def test_without_a_knowledge_base_the_facts_are_empty_lists(match) -> None:
    model = ScriptedModelClient(answers=lambda s, u: {"reply": "Right, boss.", "order": "none"})
    run(flow_with(match, model).talk("home1", "how are you", position="GK"))
    facts = json.loads(model.calls[-1]["user"])
    assert facts["team_sheet"] == {} and facts["knowledge"] == []


def har_knowledge(match) -> TalkKnowledge:
    """The Harbor City squad, given to the fixture's home club, so kb names meet the Verifier."""
    squad = parse_squad(HAR_PAGE)
    return TalkKnowledge(
        squads={match["teams"]["home"]: Squad(club=match["teams"]["home"], players=squad.players)},
        index=Bm25Index(kb_chunks()),
    )


def test_two_squad_names_joined_into_one_name_are_refused(match) -> None:
    # "N. Morinari" joins a Navlano initial to a Morinari surname: a name nobody has
    reply = "Okay, boss. N. Morinari and me up front, I reckon."
    model = ScriptedModelClient(answers=lambda s, u: {"reply": reply, "order": "none"})
    result = run(flow_with(match, model, har_knowledge(match)).talk(
        "home1", "who are the forwards?", position="GK"
    ))  # fmt: skip
    assert result["reply"] != reply


def test_a_name_only_in_the_knowledge_base_is_not_said(match) -> None:
    # the coach is on a kb page, not on either squad: the reply is not accepted as his name
    reply = "Okay, boss. Elena Marsh is the one who picks us, I reckon."
    model = ScriptedModelClient(answers=lambda s, u: {"reply": reply, "order": "none"})
    result = run(flow_with(match, model, har_knowledge(match)).talk(
        "home1", "who picks the team?", position="GK"
    ))  # fmt: skip
    assert result["reply"] != reply


def test_the_match_log_has_every_goal_when_the_fan_asks_about_goals(match) -> None:
    model = ScriptedModelClient(answers=lambda s, u: {"reply": "Right, boss.", "order": "none"})
    run(flow_with(match, model, knowledge_for(match)).talk(
        "home1", "who scored?", position="GK"
    ))  # fmt: skip
    facts = json.loads(model.calls[-1]["user"])
    goals = [line for line in facts["match"]["log"] if "goal" in line]
    assert len(goals) == sum(1 for e in match["events"] if e["payload"]["type"] == "goal")


def test_a_minute_from_the_log_is_accepted_and_an_invented_one_is_not(match) -> None:
    own_pass = next(
        e
        for e in match["events"]
        if e["payload"]["type"] == "pass" and e["payload"].get("player_id") == "home1"
    )
    minute = own_pass["event_time_ms"] // 60_000
    good = f"Okay, boss. {match['names']['home1']} made that pass in minute {minute}, I saw it."
    bad = good.replace(f"minute {minute}", "minute 99")
    for reply, verdict in ((good, "verified"), (bad, "rejected")):
        model = ScriptedModelClient(answers=lambda s, u, r=reply: {"reply": r, "order": "none"})
        result = run(flow_with(match, model, knowledge_for(match)).talk(
            "home1", "what happened earlier?", position="GK"
        ))  # fmt: skip
        assert (result["reply"] == reply) == (verdict == "verified"), reply


def test_a_player_from_the_log_can_be_named_even_when_he_is_on_no_squad_sheet(match) -> None:
    name = match["names"]["away10"]
    reply = f"Okay, boss. {name} had the ball in the middle, I reckon."
    model = ScriptedModelClient(answers=lambda s, u: {"reply": reply, "order": "none"})
    result = run(flow_with(match, model, knowledge_for(match)).talk(
        "home1", "who has the ball?", position="GK"
    ))  # fmt: skip
    assert result["reply"] == reply and result["verdict"] == "verified"


def test_a_minute_is_accepted_only_for_the_event_the_sentence_names(match) -> None:
    goal = next(e for e in match["events"] if e["payload"]["type"] == "goal")
    scorer = goal["payload"]["player_id"]
    minute = goal["event_time_ms"] // 60_000
    other = next(
        e["event_time_ms"] // 60_000
        for e in match["events"]
        if e["payload"]["type"] != "goal"
        and e["payload"].get("player_id") != scorer
        and e["event_time_ms"] // 60_000 != minute
    )
    name = match["names"][scorer]
    real = f"Okay, boss. {name} scored in minute {minute}, I saw it."
    made_up = f"Okay, boss. {name} scored in minute {other}, I saw it."
    for reply, verdict in ((real, "verified"), (made_up, "rejected")):
        model = ScriptedModelClient(answers=lambda s, u, r=reply: {"reply": r, "order": "none"})
        result = run(flow_with(match, model, knowledge_for(match)).talk(
            "home1", "tell me about the goal", position="GK"
        ))  # fmt: skip
        assert (result["reply"] == reply) == (verdict == "verified"), reply


def test_a_count_cannot_be_pinned_on_a_team_mate_by_his_surname(match) -> None:
    surname = match["names"]["home2"].split()[-1]
    reply = f"Okay, boss. {surname} has 3 shots, I reckon."
    model = ScriptedModelClient(answers=lambda s, u: {"reply": reply, "order": "none"})
    result = run(flow_with(match, model, knowledge_for(match)).talk(
        "home1", "how many shots has he had?", position="GK"
    ))  # fmt: skip
    assert result["reply"] != reply


def test_a_count_in_a_reply_that_names_a_team_mate_in_another_sentence_is_refused(match) -> None:
    reply = f"Okay, boss. {match['names']['home2']} was everywhere. I have 3 shots."
    model = ScriptedModelClient(answers=lambda s, u: {"reply": reply, "order": "none"})
    result = run(flow_with(match, model, knowledge_for(match)).talk(
        "home1", "how are you doing?", position="GK"
    ))  # fmt: skip
    assert result["reply"] != reply
