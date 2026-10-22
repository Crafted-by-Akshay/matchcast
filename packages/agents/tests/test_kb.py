"""Knowledge base: chunk rules (05 §3), stable ids, and retrieval hit@5 on the seed questions."""

from pathlib import Path

import pytest
from matchcast_agents.ask import Bm25Index, chunk_document, load_kb
from matchcast_agents.ask.chunking import MAX_TOKENS, tokens

KB = Path(__file__).parents[3] / "kb"

GOLDEN = [
    ("How is xG worked out?", "metrics:xg"),
    ("What does expected goals mean?", "metrics:xg"),
    ("What counts as a shot on target?", "metrics:shots"),
    ("What is the difference between shots and shots on target", "metrics:shots"),
    ("When is a tackle counted as won?", "metrics:tackles-won"),
    ("What does a red card do to a team?", "metrics:fouls-and-cards"),
    ("What is offside?", "laws:offside"),
    ("Is there offside from a throw-in?", "laws:offside"),
    ("What is the offside trap?", "tactics:offside-trap"),
    ("What does 4-3-3 mean?", "tactics:formations"),
    ("What is a high press?", "tactics:pressing"),
    ("What does the Verifier check?", "app:verified-lines"),
    ("What does Simulated mean?", "app:simulated-data"),
    ("Which watch modes are there?", "app:watch-modes"),
    ("What is MatchCast?", "app:about-matchcast"),
    ("When does a second yellow card become a red?", "laws:fouls-and-misconduct"),
]


@pytest.fixture(scope="module")
def chunks():
    return load_kb(KB)


def test_ids_are_unique_stable_and_shaped_corpus_slug_number(chunks) -> None:
    ids = [c.id for c in chunks]
    assert len(ids) == len(set(ids))
    assert ids == [c.id for c in load_kb(KB)]
    for chunk in chunks:
        corpus, slug, number = chunk.id.split(":")
        assert (corpus, f"{corpus}:{slug}", number.isdigit()) == (
            chunk.corpus,
            chunk.doc_id,
            True,
        )
        assert tokens(chunk.text) <= MAX_TOKENS
        assert chunk.source_path.startswith("kb/")


def test_long_sections_split_with_overlap_and_tables_stay_whole() -> None:
    sentence = "The team keeps the ball and waits for a gap. "
    table = "| a | b |\n| - | - |\n| 1 | 2 |"
    raw = f"---\ntitle: T\n---\n\n## S\n\n{sentence * 120}\n\n{table}\n"
    chunks = chunk_document(raw, corpus="metrics", slug="t")
    assert len(chunks) >= 2
    assert all(tokens(c.text) <= MAX_TOKENS for c in chunks)
    assert sum(table in c.text for c in chunks) == 1
    assert chunks[1].text.startswith("…")  # the 50-token overlap marker


def test_front_matter_gives_the_title_and_entities() -> None:
    raw = "---\ntitle: Arlo Dunne\nentities: p-7, t-home\n---\n\n## Bio\n\nA winger.\n"
    (chunk,) = chunk_document(raw, corpus="players", slug="arlo-dunne")
    assert chunk.title == "Arlo Dunne" and chunk.entity_ids == ("p-7", "t-home")


def test_hit_at_5_is_one_on_the_seed_questions(chunks) -> None:
    index = Bm25Index(chunks)
    misses = [q for q, doc in GOLDEN if doc not in {h.chunk.doc_id for h in index.search(q, k=5)}]
    assert not misses


def test_corpus_and_entity_filters_apply() -> None:
    a = chunk_document(
        "---\ntitle: A\nentities: p1\n---\n## S\n\nshots\n", corpus="players", slug="a"
    )
    b = chunk_document("---\ntitle: B\n---\n## S\n\nshots\n", corpus="metrics", slug="b")
    index = Bm25Index([*a, *b])
    assert [h.chunk.corpus for h in index.search("shots", corpora={"metrics"})] == ["metrics"]
    assert [h.chunk.id for h in index.search("shots", entity_ids={"p1"})] == ["players:a:1"]
    assert index.search("zebra") == []
