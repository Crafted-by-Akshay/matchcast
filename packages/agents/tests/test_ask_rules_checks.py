"""The rules Ask: a knowledge example is not this match's score; a rebuilt match keeps its clubs."""

from conftest import fixed_clock, run
from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents.ask.assistant import OUT_OF_SCOPE, _knowledge_sentences
from matchcast_agents.ask.chunking import Chunk
from matchcast_agents.ask.retrieval import Hit
from matchcast_agents.store import MemoryStore


def build(match, store=None, clubs=None):
    config = WorkflowConfig()
    return MatchWorkflow(
        stream=match["roster"]["stream"], roster=match["roster"], names=match["names"],
        clubs=match["teams"] if clubs is None else clubs, agents=rules_agents(config.personas),
        config=config, clock=fixed_clock(), store=store or MemoryStore(),
    )  # fmt: skip


def test_a_worked_example_in_the_knowledge_base_is_not_shown_as_this_match(match) -> None:
    flow = build(match)
    run(flow.ingest(match["events"]))
    result = run(flow.ask("Why was the first goal important?", "casual"))
    # the goals chunk's example reads "the score reads 2-1"; this match has its own score
    assert "2-1" not in result.answer


def test_a_rebuilt_match_keeps_the_clubs_it_was_given(match) -> None:
    store = MemoryStore()
    first = build(match, store=store)
    run(first.ingest(match["events"]))
    rebuilt = build(match, store=store, clubs={})  # a restart may rebuild without the clubs
    result = run(rebuilt.ask("How many shots on target does Northgate FC have?", "casual"))
    assert result.answer != OUT_OF_SCOPE


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
    assert "offside" not in result.answer.casefold()


def test_who_scored_is_answered_from_the_log_not_abstained(match) -> None:
    result = rules_answer(match, "who scored?")
    assert result.intent == "live" and not result.abstained
