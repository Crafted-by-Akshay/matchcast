"""The half-time explainer airs once, when the first half ends (CREW-7.4, AB#499). No test here
reaches a model: the rules agents write and verify the piece."""

from conftest import run
from matchcast_agents.workflow import LIVE_FEED_LINES
from matchcast_contracts import validate
from test_feed_air import events_of, flow_with

CUT = 137  # the first half's last event, per test_half_time_flow.py


def halves(flow):
    return [e.data for e in events_of(flow, "onair") if e.data["feed"] == "half_time"]


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
