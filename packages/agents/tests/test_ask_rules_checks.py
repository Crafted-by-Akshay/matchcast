"""The rules Ask: a knowledge example is not this match's score; a rebuilt match keeps its clubs."""

from pathlib import Path

from conftest import fixed_clock, run
from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents.ask import Assistant, Bm25Index, load_kb
from matchcast_agents.ask.assistant import _knowledge_sentences
from matchcast_agents.ask.chunking import Chunk
from matchcast_agents.ask.retrieval import Hit
from matchcast_agents.store import MemoryStore

KB = Path(__file__).resolve().parents[3] / "kb"


def build(match, store=None, clubs=None):
    config = WorkflowConfig()
    return MatchWorkflow(
        stream=match["roster"]["stream"], roster=match["roster"], names=match["names"],
        clubs=match["teams"] if clubs is None else clubs, agents=rules_agents(config.personas),
        config=config, clock=fixed_clock(), store=store or MemoryStore(),
    )  # fmt: skip


def test_a_worked_example_in_the_knowledge_base_is_not_shown_as_this_match() -> None:
    hits = Assistant(Bm25Index(load_kb(KB))).index.search("goal worked example score reads", k=5)
    assert "metrics:goals:3" in [h.chunk.id for h in hits]  # the example the bug surfaced
    sentences = [text for text, _chunk in _knowledge_sentences(hits)]
    assert not any("2-1" in text for text in sentences)


def test_a_rebuilt_match_keeps_the_clubs_it_was_given(match) -> None:
    store = MemoryStore()
    first = build(match, store=store)
    run(first.ingest(match["events"]))
    rebuilt = build(match, store=store, clubs={})  # a restart may rebuild without the clubs
    result = run(rebuilt.ask("How many shots on target does Northgate FC have?", "casual"))
    assert result.intent == "live" and result.answer.startswith("Shots on target")


def test_a_worked_example_that_states_a_score_is_never_the_knowledge_sentence() -> None:
    example = Chunk(
        id="metrics:goals:3", corpus="metrics", doc_id="goals", title="Goals",
        section="Worked example", text="The score reads 2-1 at full time.",
    )  # fmt: skip
    definition = Chunk(
        id="metrics:goals:1", corpus="metrics", doc_id="goals", title="Goals",
        section="Definition", text="A goal is counted when the whole ball crosses the line.",
    )  # fmt: skip
    hits = [Hit(example, 3.0), Hit(definition, 2.5)]
    sentences = _knowledge_sentences(hits)
    assert [chunk_id for _text, chunk_id in sentences] == ["metrics:goals:1"]


def rules_answer(match, question: str):
    flow = build(match)
    run(flow.ingest(match["events"]))
    return run(flow.ask(question, "casual"))


def test_what_is_the_score_is_answered_from_the_log_not_the_knowledge_base(match) -> None:
    result = rules_answer(match, "what is the score?")
    assert result.intent == "live" and not result.abstained
    assert result.answer.startswith("Score: Northgate FC 1, Harbour United 2.")


def test_what_the_score_means_is_still_a_definition(match) -> None:
    result = rules_answer(match, "what does the score mean?")
    assert result.intent == "knowledge"


def test_who_scored_names_each_scorer_with_its_own_event(match) -> None:
    scorers = [e for e in match["events"] if e["payload"]["type"] == "goal"]
    result = rules_answer(match, "who scored?")
    assert result.intent == "goals" and not result.abstained
    for goal in scorers:
        assert match["names"][goal["payload"]["player_id"]] in result.answer
    assert [c["id"] for c in result.citations] == [g["event_id"] for g in scorers]
    assert {c["type"] for c in result.citations} == {"event"}


def test_why_the_first_goal_mattered_states_the_score_change_not_xg(match) -> None:
    first = next(e for e in match["events"] if e["payload"]["type"] == "goal")
    result = rules_answer(match, "Why was the first goal important?")
    assert result.intent == "goal_impact" and not result.abstained
    assert match["names"][first["payload"]["player_id"]] in result.answer
    assert "0-0 to 0-1" in result.answer
    assert result.citations == [{"type": "event", "id": first["event_id"]}]


def test_who_scored_for_one_club_lists_only_that_clubs_goals(match) -> None:
    result = rules_answer(match, "who scored for Northgate FC?")
    home_goals = [e for e in match["events"] if e["payload"]["type"] == "goal"
                  and e["payload"]["team_id"] == "home"]  # fmt: skip
    away_scorers = [
        match["names"][e["payload"]["player_id"]]
        for e in match["events"]
        if e["payload"]["type"] == "goal" and e["payload"]["team_id"] == "away"
    ]
    assert result.intent == "goals"
    assert [c["id"] for c in result.citations] == [g["event_id"] for g in home_goals]
    assert not any(name in result.answer for name in away_scorers)


def test_who_scored_the_most_shots_is_not_a_goal_list(match) -> None:
    assert rules_answer(match, "who scored the most shots?").intent != "goals"


def test_why_goals_matter_in_football_is_not_a_match_goal(match) -> None:
    assert rules_answer(match, "why do goals matter in football?").intent != "goal_impact"


def test_the_winning_goal_question_does_not_cite_the_last_goal(match) -> None:
    assert rules_answer(match, "why was the winning goal important?").intent != "goal_impact"


def test_what_goals_a_club_scored_is_the_goal_list(match) -> None:
    assert rules_answer(match, "what goals did Harbour United score?").intent == "goals"


def test_the_event_marker_is_protected_in_translation() -> None:
    from matchcast_agents.translate import _MARKER

    assert _MARKER.findall("Dev Hale scored [event:e10] today") == ["[event:e10]"]
