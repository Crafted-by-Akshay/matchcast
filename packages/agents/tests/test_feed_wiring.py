"""The ticker and audio description go on air through the match workflow (AB#471, AB#454)."""

from conftest import run
from matchcast_agents.workflow import LIVE_FEED_LINES
from matchcast_contracts import validate
from test_feed_air import events_of, flow_with

BOOTH_PERSONAS = ("casual", "analyst", "booth:pbp", "booth:colour")


def test_ticker_lines_air_with_an_onair_record_that_names_their_event(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = LIVE_FEED_LINES
    run(flow.ingest(match["events"]))
    onair = [e.data for e in events_of(flow, "onair") if e.data["feed"] == "ticker"]
    assert onair, "a verified ticker line must air"
    event_ids = {e["event_id"] for e in match["events"]}
    for record in onair:
        validate(record)
        assert record["source_event_ids"] and set(record["source_event_ids"]) <= event_ids


def test_audio_descriptions_do_not_air_until_the_speak_time_check_lands(match) -> None:
    # a later booth line can land inside a description placed in the gap before it (the fixture
    # has 11 of 24 overlapping), so the description is not aired on a live match yet
    flow = flow_with(match, personas=BOOTH_PERSONAS)
    flow.config.feed_lines = ("ticker", "audio_description")
    run(flow.ingest(match["events"]))
    assert not [e for e in events_of(flow, "onair") if e.data["feed"] == "audio_description"]


def test_the_library_writes_no_feed_lines_unless_the_match_turns_them_on(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    run(flow.ingest(match["events"]))
    assert not [e for e in events_of(flow, "onair") if e.data["feed"] in LIVE_FEED_LINES]
