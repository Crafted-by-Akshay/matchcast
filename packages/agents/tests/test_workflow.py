"""Rules-mode workflow on the ten-minute fixture (AGT-3 acceptance criteria 1 and 4)."""

import copy

import pytest
from conftest import run
from matchcast_agents import MatchWorkflow
from matchcast_agents.workflow import WorkflowError
from matchcast_contracts import ContractError, validate, validate_publication_context
from matchcast_contracts.audit import verify_chain


def test_fixture_match_yields_verified_lines_with_a_valid_audit_chain(make_workflow, match) -> None:
    flow = make_workflow()
    result = run(flow.ingest(match["events"]))
    assert result == {"accepted": 137, "last_sequence": 137}

    claims = flow.store.claims(flow.sk)
    lines = flow.store.lines(flow.sk)
    assert len(claims) >= 5 and len(lines) >= 5
    assert {line.status for line in lines} == {"published"}
    assert all(line.checks and all(c.passed for c in line.checks) for line in lines)

    records = flow.store.audit_records(flow.sk)
    assert verify_chain(records)["valid"] is True
    for line in lines:
        actions = {r["action"] for r in records if r["subject_id"] == line.line_id}
        assert {"line_drafted", "line_verified", "line_approved"} <= actions
    actors = {r["actor_id"] for r in records}
    assert {"producer", "analyst", "narrator", "verifier", "publisher"} <= actors
    assert all(r["details"].get("mode") == "rules" for r in records if r["actor_kind"] == "agent")


def test_every_claim_and_publication_is_a_valid_contract_packet(make_workflow, match) -> None:
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    for row in flow.store.claims(flow.sk):
        validate(row["packet"])
        assert row["packet"]["approval_status"] == "approved"
    for publication in flow.store.publications(flow.sk):
        validate(publication)
        claims = [flow.store.get_claim(flow.sk, c)["packet"] for c in publication["claim_ids"]]
        state = {
            "kind": "state_revision",
            "schema_version": "1.1.0",
            "stream": publication["stream"],
            "snapshot": publication["state"],
        }
        validate_publication_context(publication, claims, state)


def test_same_input_gives_the_same_audit_head(make_workflow, match) -> None:
    heads = []
    for _ in range(2):
        flow = make_workflow()
        run(flow.ingest(match["events"]))
        heads.append(verify_chain(flow.store.audit_records(flow.sk))["final_hash"])
    assert heads[0] == heads[1]


def test_retrying_a_batch_does_not_repeat_work(make_workflow, match) -> None:
    flow = make_workflow()
    run(flow.ingest(match["events"][:40]))
    before = (len(flow.store.claims(flow.sk)), len(flow.store.audit_records(flow.sk)))
    run(flow.ingest(match["events"][:40]))
    assert (len(flow.store.claims(flow.sk)), len(flow.store.audit_records(flow.sk))) == before


def test_invalid_batch_is_rejected_whole_with_the_bad_index(make_workflow, match) -> None:
    flow = make_workflow()
    bad = copy.deepcopy(match["events"][:3])
    bad[2]["payload"] = {"type": "teleport"}
    with pytest.raises(ContractError) as error:
        run(flow.ingest(bad))
    assert error.value.index == 2  # type: ignore[attr-defined]
    assert flow.store.events(flow.sk) == []


def test_seeded_bad_claim_is_rejected_repaired_and_published(make_workflow, match) -> None:
    flow = make_workflow(seed_bad_claim=True)
    run(flow.ingest(match["events"]))
    records = flow.store.audit_records(flow.sk)
    assert verify_chain(records)["valid"] is True
    actions = [r["action"] for r in records]
    assert "line_rejected" in actions and "line_repair_requested" in actions
    rejected = next(r for r in records if r["action"] == "line_rejected")
    assert rejected["details"]["reason_code"] == "number_mismatch"
    repaired = [line for line in flow.store.lines(flow.sk) if line.repair_of]
    assert repaired and repaired[0].status == "published"
    # both personas' lines were built on the corrupted claim, so both are repaired
    assert flow.stats["repaired"] == 2 and flow.stats["abstained"] == 0


def test_producer_mode_holds_lines_until_approved(make_workflow, match) -> None:
    flow = make_workflow(approval_mode="producer")
    run(flow.ingest(match["events"][:60]))
    held = flow.store.lines(flow.sk)
    assert held and {line.status for line in held} == {"verified"}
    assert flow.store.publications(flow.sk) == []

    approved = run(flow.approve(held[0].line_id, "dana"))
    assert approved.status == "published" and approved.decided_by == "dana"
    assert len(flow.store.publications(flow.sk)) == 1
    with pytest.raises(WorkflowError) as error:
        run(flow.approve(held[0].line_id))
    assert error.value.code == "not_approvable"

    run(flow.kill(held[1].line_id, "not for air"))
    assert flow.store.get_line(flow.sk, held[1].line_id).status == "killed"
    actions = [r["action"] for r in flow.store.audit_records(flow.sk)]
    assert "line_approved" in actions and "line_killed" in actions


def test_edit_is_reverified_before_it_can_air(make_workflow, match) -> None:
    flow = make_workflow(approval_mode="producer")
    run(flow.ingest(match["events"][:60]))
    # the newest line is fresh; older queued lines fail the freshness check when edited
    analyst_line = [line for line in flow.store.lines(flow.sk) if line.persona == "analyst"][-1]

    line, verdict = run(flow.edit(analyst_line.line_id, "Northgate FC have scored 99 goals."))
    assert verdict.verdict == "rejected" and verdict.reason_code == "number_mismatch"
    assert line.status == "verified" and flow.store.publications(flow.sk) == []

    claim = flow.store.get_claim(flow.sk, analyst_line.claim_ids[0])["packet"]
    ok_text = f"Quick note on {claim['metric'].split(':')[0]}: {int(claim['value'])}."
    line, verdict = run(flow.edit(analyst_line.line_id, ok_text))
    assert verdict.verdict == "verified" and line.status == "published" and line.text == ok_text


def test_verified_audit_records_name_the_deterministic_and_meaning_checks(
    make_workflow, match
) -> None:
    flow = make_workflow()
    run(flow.ingest(match["events"][:40]))
    verified = next(r for r in flow.store.audit_records(flow.sk) if r["action"] == "line_verified")
    names = [c["name"] for c in verified["details"]["checks"]]
    assert names == ["sources", "freshness", "numbers", "names", "persona", "meaning", "safety"]


class FakeDesk:
    def __init__(self, fail: bool = False) -> None:
        self.calls: list[tuple] = []
        self.fail = fail

    async def compare(self, metric, scope, value, team_id=None):
        from matchcast_agents.statsdesk import StatsDeskError

        self.calls.append((metric, scope, value))
        if self.fail:
            raise StatsDeskError("down")
        return {"metric": metric, "value": value, "season_average": 1.2, "rank": 3, "of": 56}


def test_priority_one_moments_call_the_stats_desk_and_audit_it(match) -> None:
    desk = FakeDesk()
    flow = MatchWorkflow(
        stream=match["roster"]["stream"], roster=match["roster"], names=match["names"],
        clubs=match["teams"], stats_desk=desk,
    )  # fmt: skip
    run(flow.ingest(match["events"]))
    audit = [r for r in flow.store.audit_records(flow.sk) if r["action"] == "a2a_call"]
    assert audit and len(audit) == len(desk.calls)
    assert all(r["details"]["result"]["rank"] == 3 for r in audit)
    priorities = {
        r["details"]["priority"]
        for r in flow.store.audit_records(flow.sk)
        if r["action"] == "claim_created" and "priority" in r["details"]
    }
    assert 1 in priorities


def test_a_stats_desk_outage_is_audited_and_does_not_stop_lines(match) -> None:
    flow = MatchWorkflow(
        stream=match["roster"]["stream"], roster=match["roster"], names=match["names"],
        clubs=match["teams"], stats_desk=FakeDesk(fail=True),
    )  # fmt: skip
    run(flow.ingest(match["events"]))
    actions = {r["action"] for r in flow.store.audit_records(flow.sk)}
    assert "a2a_failed" in actions and flow.store.lines(flow.sk)


def test_shot_moments_carry_an_xg_claim_and_the_analyst_line_reads_it(make_workflow, match) -> None:
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    claims = (
        [c["packet"] for c in flow.store.claims(flow.sk)] if hasattr(flow.store, "claims") else []
    )
    xg = [c for c in claims if c["metric"].startswith("xg:")]
    assert xg and all(c["units"] == "ratio" for c in xg)
    texts = [ln.text for ln in flow.store.lines(flow.sk) if ln.persona == "analyst"]
    assert any("xG: " in t for t in texts)
