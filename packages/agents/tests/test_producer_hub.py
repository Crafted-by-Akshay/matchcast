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
