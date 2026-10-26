"""Catch-me-up on demand (CREW-7.3): the recap as of a minute is recounted from the stored events,
published once, and never carries an event after that minute."""

import dataclasses
import re

import matchcast_agents.workflow as workflow_mod
from conftest import run


def test_the_recap_as_of_a_minute_is_published_and_stops_at_that_minute(
    make_workflow, match
) -> None:
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    piece = flow.catch_me_up(30)
    assert piece is not None
    assert piece["text"].startswith("Score so far:")
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


def test_a_retracted_goal_is_left_out_of_the_recap_and_its_recount(
    make_workflow, match, monkeypatch
) -> None:
    """The recap and its recount use the same events: a retracted goal is in neither."""
    retraction = {
        "event_id": "r1",
        "stream_sequence": 9998,
        "event_time_ms": 60_000,
        "clock": {"period": 2, "period_elapsed_ms": 0},
        "payload": {"type": "retraction", "target_event_id": "e10"},
    }
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    ctx = dataclasses.replace(flow._ctx(), events=(*flow._ctx().events, retraction))
    monkeypatch.setattr(flow, "_ctx", lambda: ctx)
    piece = flow.catch_me_up(5)
    assert piece is not None
    assert piece["text"].startswith("Score so far: Northgate FC 1-1 Harbour United.")


def test_a_headline_with_its_two_scores_swapped_does_not_recount(make_workflow, match) -> None:
    """Each figure must be the recount of its own metric, in position: the same two numbers in
    the other order are a different score and do not pass."""
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    ctx = flow._ctx()
    piece = workflow_mod.catch_me_up.build(ctx, 30)
    assert piece is not None
    sentence, metrics = piece.sentences[0]
    events = workflow_mod._counted_events(ctx.events, 30)
    assert workflow_mod._sentence_recounts(events, piece, ctx.home, sentence, metrics)
    home, away = (
        int(workflow_mod.recompute(events, metric, piece.cut_sequence, home=ctx.home))
        for metric in metrics
    )
    assert home != away, "the swap is only visible when the two scores differ"
    match_scores = re.search(r"(\d+)-(\d+)", sentence)
    swapped = sentence[: match_scores.start()] + f"{away}-{home}" + sentence[match_scores.end() :]
    assert not workflow_mod._sentence_recounts(events, piece, ctx.home, swapped, metrics)


def test_a_retraction_after_the_minute_does_not_change_the_recount(match) -> None:
    """The recount at minute 5 still counts a goal that is retracted at minute 50."""
    goal = next(e for e in match["events"] if e["event_id"] == "e10")
    late = {
        "event_id": "r-late",
        "stream_sequence": 9998,
        "event_time_ms": 50 * 60_000,
        "clock": {"period": 2, "period_elapsed_ms": 0},
        "payload": {"type": "retraction", "target_event_id": "e10"},
    }
    events = [*match["events"], late]
    assert goal in workflow_mod._counted_events(events, 5)
    assert goal not in workflow_mod._counted_events(events, 50)


def test_a_desk_kill_on_the_feed_holds_the_recap(make_workflow, match) -> None:
    """A kill on the feed is audited and enforced: the recap does not publish."""
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    flow.killed_feeds.add("catch_me_up")
    assert flow.catch_me_up(30) is None
    assert not [e for e in flow.hub.history() if e.event == "catch_me_up"]
