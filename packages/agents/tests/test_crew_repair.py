"""CREW-4.2: a wrong number is repaired and the corrected line airs; CREW-4.3: only the booth's
play-by-play call is queued for a person when it cannot be repaired, every other line is dropped.
"""

from conftest import fixed_clock, run
from matchcast_agents import AgentSet, MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents.messages import DraftLine
from matchcast_agents.personas import BOOTH
from matchcast_agents.rules import NarratorRules
from matchcast_contracts.audit import verify_chain

BOOTH_CALL = "booth:pbp"


class AlwaysBadNarrator(NarratorRules):
    """Adds a name no roster has, so no redraft can pass the Verifier."""

    async def write(self, ctx, task, claims, *, attempt=0):
        lines = await super().write(ctx, task, claims, attempt=attempt)
        return [
            DraftLine(
                line_id=ln.line_id,
                claim_ids=ln.claim_ids,
                persona=ln.persona,
                text=ln.text + " Zed Quill agrees.",
                max_chars=ln.max_chars,
            )
            for ln in lines
        ]


def unrepairable(match) -> MatchWorkflow:
    base = rules_agents()
    flow = MatchWorkflow(
        stream=match["roster"]["stream"],
        roster=match["roster"],
        names=match["names"],
        clubs=match["teams"],
        agents=AgentSet(base.producer, base.analyst, AlwaysBadNarrator(), base.verifier),
        config=WorkflowConfig(),
        clock=fixed_clock(),
    )
    assert flow.add_personas(BOOTH)  # the booth's calls, and the derived lines beside them
    return flow


def test_a_seeded_wrong_claim_is_repaired_and_the_corrected_line_airs(make_workflow, match) -> None:
    clean = make_workflow()
    run(clean.ingest(match["events"]))
    clean_text = {
        (ln.moment_id, ln.persona): ln.text
        for ln in clean.store.lines(clean.sk)
        if ln.status == "published"
    }

    flow = make_workflow(seed_bad_claim=True)
    run(flow.ingest(match["events"]))
    lines = flow.store.lines(flow.sk)
    records = flow.store.audit_records(flow.sk)
    aired = {p["publication_id"] for p in flow.store.publications(flow.sk)}

    wrong = [ln for ln in lines if ln.status == "rejected"]
    assert wrong and all(ln.reason_code == "number_mismatch" for ln in wrong)
    # the line that carried the wrong claim never airs; the same moment airs a corrected line
    assert not {f"pub-{w.line_id}" for w in wrong} & aired

    repaired = [ln for ln in lines if ln.repair_of in {w.line_id for w in wrong}]
    assert repaired and all(ln.status == "published" for ln in repaired)
    assert {f"pub-{ln.line_id}" for ln in repaired} <= aired
    # the corrected wording is the one a run with no seeded fault airs for that moment
    for ln in repaired:
        assert ln.text == clean_text[(ln.moment_id, ln.persona)]
    for ln in repaired:
        # the audit names the line it repaired, so the panel can show "caught and repaired"
        verdicts = [
            r
            for r in records
            if r["subject_id"] == ln.line_id and r["action"] in ("line_verified", "line_review")
        ]
        assert verdicts and verdicts[0]["details"]["repair_of"] == ln.repair_of

    rejected = [
        r
        for r in records
        if r["action"] == "line_rejected" and r["subject_id"] in {w.line_id for w in wrong}
    ]
    assert rejected and all(r["details"]["reason_code"] == "number_mismatch" for r in rejected)
    assert verify_chain(records)["valid"] is True


def test_only_the_booth_call_is_queued_and_a_derived_feed_line_is_dropped(match) -> None:
    flow = unrepairable(match)
    run(flow.ingest(match["events"]))
    lines = flow.store.lines(flow.sk)
    records = flow.store.audit_records(flow.sk)

    queued = [ln for ln in lines if ln.escalated]
    assert queued and {ln.persona for ln in queued} == {BOOTH_CALL}
    assert all(ln.status == "review" for ln in queued)

    derived = [ln for ln in lines if ln.persona != BOOTH_CALL and ln.status != "rejected"]
    assert derived and all(ln.status == "abstained" and not ln.escalated for ln in derived)
    dropped = {r["subject_id"] for r in records if r["action"] == "line_abstained"}
    assert {ln.line_id for ln in derived} <= dropped

    assert flow.store.publications(flow.sk) == []  # auto-air is on, and nothing unrepaired airs
    assert verify_chain(records)["valid"] is True
