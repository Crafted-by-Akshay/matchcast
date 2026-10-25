from conftest import run
from matchcast_agents.context import MatchContext
from matchcast_agents.hub import StreamHub
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


def test_hub_replays_only_publications_and_audit_after_last_id() -> None:
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
    assert [e.id for e in hub.replay_after(None)] == ["onair:pub-a", "drop:line-b"]
    assert [e.id for e in hub.replay_after("onair:pub-a")] == ["drop:line-b"]


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
