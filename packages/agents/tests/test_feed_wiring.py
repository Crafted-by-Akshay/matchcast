"""The ticker and audio description go on air through the match workflow (AB#471, AB#454)."""

from conftest import run
from matchcast_agents.audio_description import spoken_span
from matchcast_agents.personas import BOOTH
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


def test_an_audio_description_airs_only_where_no_booth_line_is_speaking(match) -> None:
    flow = flow_with(match, personas=BOOTH_PERSONAS)
    flow.config.feed_lines = ("ticker", "audio_description")
    run(flow.ingest(match["events"]))
    starts = {e["event_id"]: e["event_time_ms"] for e in match["events"]}
    booth = [
        line
        for line in flow.store.lines(flow.sk)
        if line.persona in BOOTH and line.status in ("verified", "review", "approved", "published")
    ]
    busy = [
        spoken_span(starts[line.moment_id.removeprefix("m-")], line.text)
        for line in booth
        if line.moment_id.startswith("m-")
    ]
    drafted = {
        r["subject_id"]: r["details"]
        for r in flow.store.audit_records(flow.sk)
        if r["action"] == "line_drafted"
    }
    aired = [
        line
        for line in flow.store.lines(flow.sk)
        if line.persona == "audio_description" and line.status == "published"
    ]
    assert aired, "a description with no booth line in its window must air"
    for line in aired:
        timing = drafted[line.line_id]
        start, end = timing["speak_at_ms"], timing["ends_at_ms"]
        assert not [span for span in busy if span[0] < end and start < span[1]], line.line_id


def test_the_library_writes_no_feed_lines_unless_the_match_turns_them_on(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    run(flow.ingest(match["events"]))
    assert not [e for e in events_of(flow, "onair") if e.data["feed"] in LIVE_FEED_LINES]


def test_a_description_is_not_aired_when_a_booth_line_speaks_in_its_window(match) -> None:
    # stop after the first events, so a description is still held when its window is checked
    flow = flow_with(match, personas=BOOTH_PERSONAS)
    flow.config.feed_lines = ("ticker", "audio_description")
    run(flow.ingest(match["events"][:12]))
    held = list(flow._pending_audio)
    assert held, "the first events leave a description held"
    draft, _claims, speak, ends = held[0]
    eid = draft.line_id.removeprefix("line-audio-")
    booth = next(line for line in flow.store.lines(flow.sk) if line.persona in BOOTH)
    # a booth line for that event, spoken across the whole window: it arrives after the description
    intruder = booth.model_copy(
        update={
            "line_id": "line-intruder",
            "moment_id": f"m-{eid}",
            "status": "verified",
            "text": " ".join(["word"] * 40),
        }
    )
    flow._save_line(intruder)
    run(flow._air_held_audio(ends + 1))
    assert not [line for line in flow.store.lines(flow.sk) if line.line_id == draft.line_id]
