from conftest import run
from matchcast_agents.context import MatchContext
from matchcast_agents.hub import CREW_REPLAY_LIMIT, StreamHub
from matchcast_agents.messages import ProducerTask, Skip
from matchcast_agents.rules import ProducerRules
from matchcast_agents.state import MatchState


def ctx(match) -> MatchContext:
    return MatchContext(
        match["roster"]["stream"], match["roster"], match["names"], match["teams"], MatchState(), ()
    )


def event(match, kind: str, **where):
    return next(
        e
        for e in match["events"]
        if e["payload"]["type"] == kind and all(e["payload"].get(k) == v for k, v in where.items())
    )


def test_goal_is_priority_one_and_quiet_play_is_skipped(match) -> None:
    producer = ProducerRules()
    goal = run(producer.decide(ctx(match), event(match, "goal")))
    assert isinstance(goal, ProducerTask) and goal.priority == 1 and goal.reason == "goal"
    quiet = run(producer.decide(ctx(match), event(match, "pass")))
    assert isinstance(quiet, Skip) and quiet.reason == "quiet_play"


def test_rate_rule_and_duplicates(match) -> None:
    shots = [
        e for e in match["events"] if e["payload"]["type"] == "shot" and e["payload"]["on_target"]
    ]
    first, second = shots[0], dict(shots[1], event_time_ms=shots[0]["event_time_ms"] + 3000)
    producer = ProducerRules()
    assert isinstance(run(producer.decide(ctx(match), first)), ProducerTask)
    limited = run(producer.decide(ctx(match), second))
    assert isinstance(limited, Skip) and limited.reason == "rate_limited"
    again = run(producer.decide(ctx(match), first))
    assert isinstance(again, Skip) and again.reason == "duplicate_moment"


def test_periodic_summary_moment(match) -> None:
    producer = ProducerRules()
    late_pass = dict(event(match, "pass"), event_id="late", event_time_ms=300_500)
    task = run(producer.decide(ctx(match), late_pass))
    assert isinstance(task, ProducerTask) and task.reason == "summary" and task.priority == 3


def test_hub_replays_publications_and_audit_after_last_id() -> None:
    hub = StreamHub()
    hub.publish("state", "state:1", {"r": 1})
    hub.publish("publication", "pub:a", {"t": "a"})
    hub.publish("audit", "audit:1", {"s": 1})
    hub.publish("publication", "pub:b", {"t": "b"})
    assert [e.id for e in hub.replay_after(None)] == ["pub:a", "audit:1", "pub:b"]
    assert [e.id for e in hub.replay_after("audit:1")] == ["pub:b"]
    assert hub.history()[0].encode() == 'event: state\nid: state:1\ndata: {"r":1}\n\n'


def test_hub_replays_feed_records_so_a_reconnect_rebuilds_the_monitor() -> None:
    # AB#499: a desk that opens mid-match counts the feeds from the replay, not only live records
    hub = StreamHub()
    hub.publish("state", "state:1", {"r": 1})
    hub.publish("onair", "onair:pub-a", {"feed": "casual"})
    hub.publish("feed_drop", "drop:line-b", {"feed": "analyst"})
    hub.publish("crew_ledger", "ledger:m1", {"called": True})
    # the crew's ledger replays too (contract 1.3.0), so a late desk rebuilds the crew tree
    assert [e.id for e in hub.replay_after(None)] == ["onair:pub-a", "drop:line-b", "ledger:m1"]
    assert [e.id for e in hub.replay_after("onair:pub-a")] == ["drop:line-b", "ledger:m1"]


def test_a_desk_that_opens_late_still_gets_every_feed_record_in_the_replay() -> None:
    # AB#499: the desk sends no Last-Event-ID, so the replay is all it gets. Publications and
    # audit are capped at 500 from the start; feed records have their own budget
    hub = StreamHub()
    for i in range(600):
        hub.publish("publication", f"pub:{i}", {"persona": "analyst"})
    hub.publish("onair", "onair:late", {"feed": "casual"})
    replay = [e.id for e in hub.replay_after(None)]
    assert "onair:late" in replay
    assert len([i for i in replay if i.startswith("pub:")]) == 500


def test_the_persona_filter_applies_before_the_replay_cap() -> None:
    # the cap counts only what a viewer keeps, so a casual viewer is not starved by analyst lines
    hub = StreamHub()
    for i in range(600):
        hub.publish("publication", f"pub:a{i}", {"persona": "analyst"})
    hub.publish("publication", "pub:c", {"persona": "casual"})
    keep_casual = lambda e: e.event != "publication" or e.data["persona"] == "casual"  # noqa: E731
    assert [e.id for e in hub.replay_after(None, wanted=keep_casual)] == ["pub:c"]


def test_a_feed_record_the_buffer_has_evicted_is_still_replayed() -> None:
    # a long match pushes the buffer past its feed records; the desk must still count them
    hub = StreamHub(buffer=10)
    hub.publish("onair", "onair:early", {"feed": "casual"})
    for i in range(50):
        hub.publish("publication", f"pub:{i}", {"persona": "analyst"})
    assert "onair:early" in [e.id for e in hub.replay_after(None)]


def test_the_newest_2000_feed_records_are_replayed_when_there_are_more() -> None:
    hub = StreamHub(buffer=10)
    for i in range(2100):
        hub.publish("onair", f"onair:{i}", {"feed": "casual"})
    ids = [e.id for e in hub.replay_after(None)]
    assert len(ids) == 2000 and ids[0] == "onair:100" and ids[-1] == "onair:2099"


def test_a_reconnect_from_an_evicted_feed_record_resumes_after_it() -> None:
    # the record a client resumes from may itself be past the buffer: the feed records after it
    # still replay, and it does not
    hub = StreamHub(buffer=10)
    hub.publish("onair", "onair:1", {"feed": "casual"})
    hub.publish("onair", "onair:2", {"feed": "casual"})
    for i in range(30):
        hub.publish("publication", f"pub:{i}", {"persona": "analyst"})
    ids = [e.id for e in hub.replay_after("onair:1") if e.event == "onair"]
    assert ids == ["onair:2"]


def test_a_resume_point_on_either_side_of_the_kept_and_buffered_boundary() -> None:
    # 0-19 are kept past the buffer, 20-29 are still in it: a cursor in either part resumes after it
    hub = StreamHub(buffer=10)
    for i in range(30):
        hub.publish("onair", f"onair:{i}", {"feed": "casual"})
    assert [e.id for e in hub.replay_after("onair:5")] == [f"onair:{i}" for i in range(6, 30)]
    assert [e.id for e in hub.replay_after("onair:19")] == [f"onair:{i}" for i in range(20, 30)]
    assert hub.replay_after("onair:29") == []


def test_colour_moment_is_capped_by_wall_time_and_off_by_default(match) -> None:
    now = [100.0]
    producer = ProducerRules(colour_every_s=45, clock=lambda: now[0])
    plays = [
        dict(e, event_id=f"c{i}", event_time_ms=10_000 * (i + 1))
        for i, e in enumerate(
            x
            for x in match["events"]
            if x["payload"]["type"] in ("foul", "tackle")
            or (x["payload"]["type"] == "shot" and not x["payload"]["on_target"])
        )
    ][:4]
    assert len(plays) == 4
    first = run(producer.decide(ctx(match), plays[0]))
    assert isinstance(first, ProducerTask) and first.reason == "colour"
    assert first.personas == ("analyst",) and first.priority == 3
    now[0] += 44
    assert isinstance(run(producer.decide(ctx(match), plays[1])), Skip)  # inside the 45 s
    now[0] += 2
    assert run(producer.decide(ctx(match), plays[2])).reason == "colour"  # budget is back
    off = ProducerRules()
    assert isinstance(run(off.decide(ctx(match), plays[3])), Skip)


def test_a_rate_limited_colour_moment_does_not_spend_the_budget(match) -> None:
    producer = ProducerRules(colour_every_s=45, clock=lambda: 0.0)
    goal = event(match, "goal")
    assert run(producer.decide(ctx(match), goal)).reason == "goal"
    foul = dict(event(match, "foul"), event_id="f1", event_time_ms=goal["event_time_ms"] + 1000)
    assert run(producer.decide(ctx(match), foul)).reason == "rate_limited"
    later = dict(foul, event_id="f2", event_time_ms=goal["event_time_ms"] + 20_000)
    assert run(producer.decide(ctx(match), later)).reason == "colour"


def test_colour_needs_the_analyst_persona_and_a_won_tackle(match) -> None:
    lost = dict(event(match, "tackle"), event_id="t1")
    lost["payload"] = dict(lost["payload"], outcome="lost")
    producer = ProducerRules(colour_every_s=45, clock=lambda: 0.0)
    assert isinstance(run(producer.decide(ctx(match), lost)), Skip)
    foul = dict(event(match, "foul"), event_id="f9")
    no_analyst = ProducerRules(("casual",), colour_every_s=45, clock=lambda: 0.0)
    assert isinstance(run(no_analyst.decide(ctx(match), foul)), Skip)


def test_crew_frames_replay_the_newest_two_thousand_only() -> None:
    # AB#375: a late viewer gets the crew frames, capped to the newest CREW_REPLAY_LIMIT
    hub = StreamHub()
    for i in range(CREW_REPLAY_LIMIT + 100):
        hub.publish("crew_spawn", f"spawn:{i}", {"moment_id": f"m{i}"})
    replay = [e.id for e in hub.replay_after(None)]
    assert len(replay) == CREW_REPLAY_LIMIT
    assert replay[0] == "spawn:100" and replay[-1] == f"spawn:{CREW_REPLAY_LIMIT + 99}"


def test_crew_frames_survive_the_buffer_so_a_late_viewer_at_full_time_has_the_tree() -> None:
    # a full match overflows the buffer: the spawn frames of early moments must still replay,
    # as the feed records do, or the tree shows ledgers with no specialists
    hub = StreamHub()
    hub.publish("crew_spawn", "spawn:early", {"moment_id": "m1"})
    for i in range(5100):
        hub.publish("publication", f"pub:{i}", {"persona": "analyst"})
    assert "spawn:early" in [e.id for e in hub.replay_after(None)]
