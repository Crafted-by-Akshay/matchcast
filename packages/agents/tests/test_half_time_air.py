"""The half-time explainer airs once, when the first half ends (CREW-7.4, AB#499). No test here
reaches a model: the rules agents write and verify the piece."""

import copy
import dataclasses

import pytest
from conftest import run
from matchcast_agents import half_time as half_time_mod
from matchcast_agents.workflow import LIVE_FEED_LINES, WorkflowError
from matchcast_contracts import validate
from test_feed_air import events_of, flow_with

CUT = 137  # the first half's last event, per test_half_time_flow.py


def halves(flow):
    return [e.data for e in events_of(flow, "onair") if e.data["feed"] == "half_time"]


def half_time_publications(flow):
    return [
        p
        for p in flow.store.publications(flow.sk)
        if p["publication_id"].startswith("pub-half-time-")
    ]


def first_half_end(match):
    [boundary] = [
        e
        for e in match["events"]
        if e["payload"]["type"] == "period_boundary"
        and e["payload"].get("boundary") == "ended"
        and e["clock"]["period"] == 1
    ]
    return boundary


class RejectingVerifier:
    """The Verifier, except the half-time lines the predicate names come back with ``verdict``."""

    def __init__(self, inner, rejects, verdict="rejected"):
        self._inner = inner
        self._rejects = rejects
        self._verdict = verdict

    async def check(self, ctx, line, claims):
        verdict = await self._inner.check(ctx, line, claims)
        if self._rejects(line.line_id):
            return verdict.model_copy(
                update={"verdict": self._verdict, "reason_code": "number_mismatch"}
            )
        return verdict

    def __getattr__(self, name):
        return getattr(self._inner, name)


def test_the_piece_airs_once_with_an_onair_record_naming_its_events(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = LIVE_FEED_LINES
    run(flow.ingest(match["events"]))
    records = halves(flow)
    assert len(records) == 1, "the piece airs once, when the first half ends"
    record = records[0]
    validate(record)
    assert record["text"] == run(flow.half_time())["text"]  # the piece that was written
    first_half = {e["event_id"] for e in match["events"] if e["stream_sequence"] <= CUT}
    assert set(record["source_event_ids"]) <= first_half


def test_the_piece_airs_as_a_publication_the_viewer_can_read(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = LIVE_FEED_LINES
    run(flow.ingest(match["events"]))
    [record] = halves(flow)
    publications = flow.store.publications(flow.sk)
    [piece] = [p for p in publications if p["publication_id"] == record["publication_id"]]
    validate(piece)
    assert piece["persona"] == "half_time"
    assert piece["text"] == record["text"]


def test_nothing_airs_before_the_first_half_ends(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = LIVE_FEED_LINES
    before_the_end = [e for e in match["events"] if e["payload"]["type"] != "period_boundary"]
    run(flow.ingest([e for e in before_the_end if e["stream_sequence"] <= CUT]))
    assert halves(flow) == []


def test_a_killed_half_time_feed_does_not_air(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = LIVE_FEED_LINES
    flow.killed_feeds.add("half_time")  # the desk's kill, from the audit chain
    run(flow.ingest(match["events"]))
    assert halves(flow) == []


def test_the_library_airs_no_half_time_unless_the_match_turns_it_on(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    run(flow.ingest(match["events"]))
    assert halves(flow) == []


def test_a_replayed_first_half_boundary_airs_nothing_new(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = LIVE_FEED_LINES
    run(flow.ingest(match["events"]))
    run(flow._air_half_time(first_half_end(match)))  # the same boundary processed again
    assert len(halves(flow)) == 1
    assert len(half_time_publications(flow)) == 1


def test_the_piece_is_written_only_at_the_first_half_boundary(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = LIVE_FEED_LINES
    writes = []
    write = flow._write_half_time

    async def counted():
        writes.append(1)
        return await write()

    flow._write_half_time = counted
    run(flow.ingest(match["events"]))  # the full match: the period-2 boundary is in it too
    assert len(writes) == 1, "the period-2 boundary writes nothing, so nothing airs twice"


def test_the_claims_of_dropped_lines_are_neither_approved_nor_aired(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = LIVE_FEED_LINES
    # only line 6 survives: it cites claims 3 and 4, which the dropped lines do not all share
    flow.agents = dataclasses.replace(
        flow.agents,
        verifier=RejectingVerifier(
            flow.agents.verifier, lambda line_id: line_id != "line-halftime-6"
        ),
    )
    run(flow.ingest(match["events"]))
    [record] = halves(flow)
    kept = [
        line
        for line in flow.store.lines(flow.sk)
        if line.moment_id == "half_time" and line.status in ("verified", "published")
    ]
    assert [line.line_id for line in kept] == ["line-halftime-6"]
    kept_claims = {claim for line in kept for claim in line.claim_ids}
    dropped_claims = {
        claim
        for line in flow.store.lines(flow.sk)
        if line.moment_id == "half_time" and line.status == "rejected"
        for claim in line.claim_ids
    }
    dropped_only = dropped_claims - kept_claims
    assert dropped_only, "the dropped lines must cite a claim that no kept line cites"
    assert set(record["claim_ids"]) == kept_claims
    for claim_id in dropped_only:
        row = flow.store.get_claim(flow.sk, claim_id)
        assert row["packet"]["approval_status"] != "approved"


def test_a_piece_with_no_line_left_airs_nothing(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = LIVE_FEED_LINES
    flow.agents = dataclasses.replace(
        flow.agents,
        verifier=RejectingVerifier(
            flow.agents.verifier, lambda line_id: line_id.startswith("line-halftime-")
        ),
    )
    run(flow.ingest(match["events"]))
    assert halves(flow) == []
    assert half_time_publications(flow) == []
    assert run(flow.half_time()) is None


def test_a_desk_killed_line_holds_the_piece_before_it_airs(match) -> None:
    flow = flow_with(
        match, personas=("casual", "analyst")
    )  # the feed is off: the boundary airs nothing
    run(flow.ingest(match["events"]))
    run(flow.half_time())  # the piece is verified and its lines stored, not aired
    run(flow.kill("line-halftime-1", "checked by the desk"))
    flow.config.feed_lines = LIVE_FEED_LINES
    run(flow._air_half_time(first_half_end(match)))
    assert halves(flow) == []
    assert half_time_publications(flow) == []


def test_a_half_time_line_on_air_cannot_be_killed(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = LIVE_FEED_LINES
    run(flow.ingest(match["events"]))
    with pytest.raises(WorkflowError) as error:
        run(flow.kill("line-halftime-1", "too late"))
    assert error.value.code == "not_approvable"


def test_a_fresh_process_reads_the_aired_piece_back_and_keeps_it_approved(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = LIVE_FEED_LINES
    run(flow.ingest(match["events"]))
    [record] = halves(flow)
    flow._half_times.clear()  # what a restart starts with
    assert run(flow.half_time())["text"] == record["text"]
    for claim_id in record["claim_ids"]:
        assert flow.store.get_claim(flow.sk, claim_id)["packet"]["approval_status"] == "approved"
    statuses = {line.status for line in flow.store.lines(flow.sk) if line.moment_id == "half_time"}
    assert statuses <= {"published", "rejected"}


def test_no_piece_means_nothing_airs(match, monkeypatch) -> None:
    monkeypatch.setattr(
        half_time_mod, "build", lambda ctx: None
    )  # a retracted boundary gives no piece
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = LIVE_FEED_LINES
    run(flow.ingest(match["events"]))
    assert halves(flow) == []
    assert half_time_publications(flow) == []


def test_killing_a_dropped_line_after_air_does_not_stop_the_read_back(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = LIVE_FEED_LINES
    flow.agents = dataclasses.replace(
        flow.agents,
        verifier=RejectingVerifier(
            flow.agents.verifier, lambda line_id: line_id == "line-halftime-1", verdict="review"
        ),
    )
    run(flow.ingest(match["events"]))
    [record] = halves(flow)
    assert flow.store.get_line(flow.sk, "line-halftime-1").status == "review"
    run(flow.kill("line-halftime-1", "the desk takes the line out of review"))
    flow._half_times.clear()  # a fresh process asks for the piece
    assert run(flow.half_time())["text"] == record["text"]


def test_a_replayed_boundary_publishes_lines_a_crash_left_verified(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = LIVE_FEED_LINES
    run(flow.ingest(match["events"]))
    for line in flow.store.lines(flow.sk):  # the publication was stored, its line writes were not
        if line.moment_id == "half_time":
            line.status = "verified"
            flow._save_line(line)
    run(flow._air_half_time(first_half_end(match)))  # the boundary is processed again
    statuses = {line.status for line in flow.store.lines(flow.sk) if line.moment_id == "half_time"}
    assert statuses == {"published"}
    with pytest.raises(WorkflowError):
        run(flow.kill("line-halftime-1", "too late"))


def test_a_crash_before_the_line_writes_still_refuses_the_kill(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = LIVE_FEED_LINES
    run(flow.ingest(match["events"]))
    for line in flow.store.lines(flow.sk):  # the publication was stored, its line writes were not
        if line.moment_id == "half_time":
            line.status = "verified"
            flow._save_line(line)
    with pytest.raises(WorkflowError) as error:  # no replay: the text on air is enough to refuse
        run(flow.kill("line-halftime-1", "too late"))
    assert error.value.code == "not_approvable"


def test_the_read_back_publishes_lines_a_crash_left_verified(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = LIVE_FEED_LINES
    run(flow.ingest(match["events"]))
    for line in flow.store.lines(flow.sk):
        if line.moment_id == "half_time":
            line.status = "verified"
            flow._save_line(line)
    flow._half_times.clear()  # a fresh process asks for the piece
    run(flow.half_time())
    statuses = {line.status for line in flow.store.lines(flow.sk) if line.moment_id == "half_time"}
    assert statuses == {"published"}


def test_a_leftover_verified_line_is_not_put_on_air(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = LIVE_FEED_LINES
    run(flow.ingest(match["events"]))
    kept = flow.store.get_line(flow.sk, "line-halftime-1")
    leftover = copy.copy(kept)  # written by an earlier write, not in the aired piece
    leftover.line_id = "line-halftime-99"
    leftover.text = "A sentence the aired piece does not carry."
    leftover.status = "verified"
    flow.store.put_line(flow.sk, leftover)
    run(flow._air_half_time(first_half_end(match)))  # a replayed boundary
    assert flow.store.get_line(flow.sk, "line-halftime-99").status == "verified"
