"""Catch-me-up on demand (CREW-7.3): the recap as of a minute is recounted from the stored events,
published once, and never carries an event after that minute."""

import matchcast_agents.workflow as workflow_mod
from conftest import run


def test_the_recap_as_of_a_minute_is_published_and_stops_at_that_minute(
    make_workflow, match
) -> None:
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    piece = flow.catch_me_up(30)
    assert piece is not None
    assert piece["text"].startswith("After 30 minutes,")
    assert piece["word_count"] <= 280
    by_id = {e["event_id"]: e for e in match["events"]}
    assert all(by_id[i]["event_time_ms"] <= 30 * 60_000 for i in piece["source_event_ids"])
    published = [e.data for e in flow.hub.history() if e.event == "catch_me_up"]
    assert published and published[-1]["text"] == piece["text"]


def test_a_recap_whose_numbers_do_not_recount_is_not_published(
    make_workflow, match, monkeypatch
) -> None:
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    real = workflow_mod.recompute
    monkeypatch.setattr(
        workflow_mod, "recompute", lambda *args, **kwargs: real(*args, **kwargs) + 1
    )
    assert flow.catch_me_up(30) is None
    assert not [e for e in flow.hub.history() if e.event == "catch_me_up"]
