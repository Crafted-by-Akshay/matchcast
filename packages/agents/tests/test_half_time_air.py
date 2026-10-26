"""The half-time explainer airs once, when the first half ends (CREW-7.4, AB#499). No test here
reaches a model: the rules agents write and verify the piece."""

import dataclasses

from conftest import run
from matchcast_agents.workflow import LIVE_FEED_LINES
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
    """The Verifier, except the half-time lines the predicate names come back rejected."""

    def __init__(self, inner, rejects):
        self._inner = inner
        self._rejects = rejects

    async def check(self, ctx, line, claims):
        verdict = await self._inner.check(ctx, line, claims)
        if self._rejects(line.line_id):
            return verdict.model_copy(
                update={"verdict": "rejected", "reason_code": "number_mismatch"}
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
        if line.moment_id == "half_time" and line.status == "verified"
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


def test_a_desk_killed_line_holds_the_piece_when_it_is_written_again(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = LIVE_FEED_LINES
    run(flow.ingest(match["events"]))
    run(flow.kill("line-halftime-1", "checked by the desk"))
    flow._half_times.clear()  # what a restart starts with: the piece is verified again
    assert run(flow.half_time()) is None
    assert flow.store.get_line(flow.sk, "line-halftime-1").status == "killed"
