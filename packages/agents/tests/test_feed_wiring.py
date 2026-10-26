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


def test_the_colour_line_is_spoken_after_its_play_by_play(match) -> None:
    from matchcast_agents.messages import LineRecord
    from matchcast_agents.workflow import commentary_spans

    def booth(persona: str, text: str) -> LineRecord:
        return LineRecord(
            line_id=f"line-{persona}",
            moment_id="m-e1",
            claim_ids=[],
            persona=persona,
            text=text,
            status="published",
            created_at="2026-10-26T00:00:00.000Z",
            snapshot_revision=1,
        )

    pbp = booth("booth:pbp", "one two three four five six")
    colour = booth("booth:colour", "seven eight")
    spans = commentary_spans([colour, pbp], {"e1": 1_000})
    pbp_span, colour_span = spans[0], spans[1]
    assert pbp_span[0] == 1_000
    assert colour_span[0] == pbp_span[1], "the colour line starts when the play-by-play ends"


def test_held_descriptions_never_overlap_one_another(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = ("ticker", "audio_description")
    run(flow.ingest(match["events"]))
    drafted = [
        r["details"]
        for r in flow.store.audit_records(flow.sk)
        if r["action"] == "line_drafted" and "speak_at_ms" in r["details"]
    ]
    assert len(drafted) >= 2, "the fixture has descriptions close enough to test"
    spans = sorted((d["speak_at_ms"], d["ends_at_ms"]) for d in drafted)
    assert all(end <= start for (_, end), (start, _) in zip(spans, spans[1:]))


def test_a_retraction_that_arrives_while_a_description_is_held_stops_it(match) -> None:
    import copy

    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = ("ticker", "audio_description")
    run(flow.ingest(match["events"][:12]))
    held = list(flow._pending_audio)
    assert held, "the first events leave a description held"
    draft, _claims, _speak, ends = held[0]
    eid = draft.line_id.removeprefix("line-audio-")
    # the engine takes the event back before the description's window ends
    target = next(e for e in match["events"] if e["event_id"] == eid)
    shift = ends + 1 - target["event_time_ms"]  # the clock moves with the event time
    retraction = copy.deepcopy(match["events"][11])
    retraction["clock"] = {
        **target["clock"],
        "period_elapsed_ms": target["clock"]["period_elapsed_ms"] + shift,
    }
    retraction.update(
        event_id="r-held",
        stream_sequence=match["events"][-1]["stream_sequence"] + 1,
        event_time_ms=ends + 1,
    )
    retraction["payload"] = {
        "type": "retraction",
        "target_event_id": eid,
        "target_stream_sequence": target["stream_sequence"],
        "target_revision": 1,
        "new_revision": 2,
        "reason": "fixture",
    }
    run(flow.ingest(match["events"][:12] + [retraction]))
    assert not [line for line in flow.store.lines(flow.sk) if line.line_id == draft.line_id]


def test_a_described_shot_is_not_dropped_when_the_descriptions_before_it_are_placed_again(
    match,
) -> None:
    # e16 (a shot at 59.1 s) falls in the gap just after e15's description, which holds its own
    # span. Placing e15 again as later events arrive must not take e16's gap: e16 is described
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.feed_lines = ("ticker", "audio_description")
    for count in range(4, 41, 2):
        run(flow.ingest(match["events"][:count]))
    written = {ln.line_id for ln in flow.store.lines(flow.sk)}
    held = {draft.line_id for draft, *_ in flow._pending_audio}
    assert "line-audio-e16" in written | held
