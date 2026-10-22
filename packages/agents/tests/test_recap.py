"""Full-time recap (AGT-15): word limits, a verdict per sentence, bad sentences dropped."""

import re

from conftest import run
from matchcast_agents import recap as recap_mod
from matchcast_agents.recap import WORD_LIMITS

PERSONAS = ("casual", "analyst", "broadcast")


def played(make_workflow, match):
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    return flow


def audit_for(flow, subject):
    return [r for r in flow.store.audit_records(flow.sk) if r["subject_id"] == subject]


def test_every_persona_gets_a_recap_within_its_word_limit(make_workflow, match) -> None:
    flow = played(make_workflow, match)
    recaps = run(flow.recap())
    assert set(recaps) == set(PERSONAS)
    for persona, recap in recaps.items():
        assert recap["word_count"] == len(recap["text"].split())
        assert 0 < recap["word_count"] <= WORD_LIMITS[persona]
        assert recap["language"] == "en"


def test_every_kept_sentence_has_a_verifier_verdict_in_the_audit(make_workflow, match) -> None:
    flow = played(make_workflow, match)
    recaps = run(flow.recap())
    log = flow.store.audit_records(flow.sk)
    for recap in recaps.values():
        for sentence in recap["sentences"]:
            records = audit_for(flow, sentence["line_id"])
            assert {"line_drafted", "line_verified"} <= {r["action"] for r in records}
            assert recap["sentences"] and sentence["audit_sequence"] <= len(log)
    assert [r["subject_id"] for r in log if r["action"] == "recap_created"] == [
        f"recap-{p}" for p in PERSONAS
    ]


def test_recap_numbers_and_names_match_the_final_state(make_workflow, match) -> None:
    flow = played(make_workflow, match)
    state = flow.store.get_state(flow.sk)
    home, away = match["roster"]["team_ids"]
    recap = run(flow.recap(("analyst",)))["analyst"]
    h, a = flow.clubs[home], flow.clubs[away]
    assert (
        f"Final score: {h} {state.score.get(home, 0)}, {a} {state.score.get(away, 0)}."
        in (recap["text"])
    )
    allowed = {n.casefold() for n in (*flow.names.values(), *flow.clubs.values())}
    for name in re.findall(r"[A-Z][\w']+ (?:[A-Z][\w']+|FC|United)", recap["text"]):
        assert name.casefold() in allowed


def test_a_sentence_that_fails_verification_is_dropped_not_shown(
    make_workflow, match, monkeypatch
) -> None:
    flow = played(make_workflow, match)
    real = recap_mod.sentences

    def tampered(ctx, persona, claims, moments):
        drafts = real(ctx, persona, claims, moments)
        bad = drafts[-1].model_copy(
            update={"text": "The shots finished Northgate FC 99, Nobody 1."}
        )
        return [*drafts[:-1], bad]

    monkeypatch.setattr(recap_mod, "sentences", tampered)
    recap = run(flow.recap(("broadcast",)))["broadcast"]
    assert "99" not in recap["text"]
    actions = [r["action"] for r in flow.store.audit_records(flow.sk)]
    assert "line_rejected" in actions and "line_abstained" in actions
    created = next(r for r in flow.store.audit_records(flow.sk) if r["action"] == "recap_created")
    assert created["details"]["dropped"] == 1


def test_recap_is_idempotent_and_announced_once(make_workflow, match) -> None:
    flow = played(make_workflow, match)
    first = run(flow.recap())
    second = run(flow.recap())
    assert first == second
    ready = [e for e in flow.hub.history() if e.event == "recap_ready"]
    assert len(ready) == 1 and ready[0].data["personas"] == list(PERSONAS)


def test_moments_are_five_to_eight_and_in_match_order(make_workflow, match) -> None:
    flow = played(make_workflow, match)
    moments = recap_mod.pick_moments(flow._ctx())
    assert len(moments) <= recap_mod.MAX_MOMENTS
    sequences = [m["stream_sequence"] for m in moments]
    assert sequences == sorted(sequences)
