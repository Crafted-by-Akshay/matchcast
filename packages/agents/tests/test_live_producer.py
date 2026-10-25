"""The model Producer: picks among rules candidates, never touches goals, gives back its window."""

from conftest import run
from matchcast_agents.context import MatchContext
from matchcast_agents.live import LiveProducer, ScriptedModelClient
from matchcast_agents.messages import ProducerTask, Skip
from matchcast_agents.resilience import ModelError, ModelTimeout
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


def on_target_shots(match):
    return [
        e for e in match["events"] if e["payload"]["type"] == "shot" and e["payload"]["on_target"]
    ]


def narrate(personas, desk=False, why="A shot on target."):
    return {"action": "narrate", "personas": personas, "call_stats_desk": desk, "why": why}


def skip(why="Repeats the storyline just aired."):
    return {"action": "skip", "personas": [], "call_stats_desk": False, "why": why}


def producer(answers):
    client = ScriptedModelClient(list(answers))
    return LiveProducer(client, ProducerRules()), client


def test_goal_is_routed_by_rules_without_a_model_call(match) -> None:
    live, client = producer([])
    goal = run(live.decide(ctx(match), event(match, "goal")))
    assert isinstance(goal, ProducerTask) and goal.priority == 1
    assert goal.routed_by == "rules" and client.calls == []


def test_quiet_play_is_skipped_without_a_model_call(match) -> None:
    live, client = producer([])
    quiet = run(live.decide(ctx(match), event(match, "pass")))
    assert isinstance(quiet, Skip) and quiet.reason == "quiet_play" and client.calls == []


def test_model_narrows_personas_and_can_ask_the_stats_desk(match) -> None:
    live, _ = producer([narrate(["analyst"], desk=True, why="The analyst wants the numbers.")])
    shot = on_target_shots(match)[0]
    task = run(live.decide(ctx(match), shot))
    assert isinstance(task, ProducerTask)
    assert task.routed_by == "model" and task.call_stats_desk is True
    assert task.personas == ("analyst",)
    assert task.why == "The analyst wants the numbers."
    assert live.last_mode == "live" and live.take_fallbacks() == []


def test_invented_personas_are_ignored_and_the_rules_choice_stands(match) -> None:
    live, _ = producer([narrate(["hype"])])
    task = run(live.decide(ctx(match), on_target_shots(match)[0]))
    assert isinstance(task, ProducerTask) and task.personas == ("casual", "analyst")


def test_model_skip_gives_back_the_rate_window(match) -> None:
    first, second = (
        on_target_shots(match)[0],
        dict(
            on_target_shots(match)[1],
            event_time_ms=on_target_shots(match)[0]["event_time_ms"] + 3000,
        ),
    )
    live, _ = producer([skip(), narrate(["casual"])])
    dropped = run(live.decide(ctx(match), first))
    assert isinstance(dropped, Skip) and dropped.reason == "model_skip"
    assert dropped.why == "Repeats the storyline just aired."
    # the rate rule would have blocked this one had the model's skip kept the window
    aired = run(live.decide(ctx(match), second))
    assert isinstance(aired, ProducerTask) and aired.routed_by == "model"


def test_model_error_falls_back_to_the_rules_decision_and_is_recorded(match) -> None:
    live, _ = producer([ModelError("the model did not return JSON")])
    task = run(live.decide(ctx(match), on_target_shots(match)[0]))
    assert isinstance(task, ProducerTask) and task.routed_by == "rules"
    assert live.take_fallbacks() == ["model_error"] and live.last_mode == "rules"


def test_snapshot_round_trips_the_aired_memory(match) -> None:
    live, _ = producer([narrate(["casual"])])
    run(live.decide(ctx(match), on_target_shots(match)[0]))
    fresh, _ = producer([])
    fresh.restore(live.snapshot())
    assert fresh.snapshot() == live.snapshot()


def test_a_checkpoint_from_before_the_model_producer_still_restores(match) -> None:
    rules_only = ProducerRules()
    run(rules_only.decide(ctx(match), event(match, "goal")))
    live, _ = producer([])
    live.restore(rules_only.snapshot())  # the old checkpoint shape: the rules memory alone
    assert live.snapshot() == {**rules_only.snapshot(), "aired": []}


def test_a_rules_only_build_restores_a_model_checkpoint(match) -> None:
    live, _ = producer([narrate(["casual"])])
    run(live.decide(ctx(match), on_target_shots(match)[0]))
    rules_only = ProducerRules()
    rules_only.restore(live.snapshot())  # a rollback must not fail on the extra "aired" key
    assert rules_only.snapshot() == {k: v for k, v in live.snapshot().items() if k != "aired"}


def test_goals_are_remembered_so_the_next_storyline_can_be_skipped(match) -> None:
    live, client = producer([narrate(["casual"])])
    goal = event(match, "goal")
    run(live.decide(ctx(match), goal))
    shot = on_target_shots(match)[0]
    # past the 8 s rate window, so the shot reaches the model
    run(live.decide(ctx(match), dict(shot, event_time_ms=goal["event_time_ms"] + 9000)))
    assert live.snapshot()["aired"][0]["reason"] == "goal"
    assert client.calls[0]["user"].count('"reason": "goal"') == 1


def test_mode_is_per_decision(match) -> None:
    live, _ = producer([narrate(["casual"]), ModelTimeout()])
    goal = event(match, "goal")
    run(live.decide(ctx(match), goal))
    assert live.mode == "rules"
    shot = dict(on_target_shots(match)[0], event_time_ms=goal["event_time_ms"] + 9000)
    run(live.decide(ctx(match), shot))
    assert live.mode == "live"
    late = dict(on_target_shots(match)[1], event_time_ms=goal["event_time_ms"] + 30000)
    run(live.decide(ctx(match), late))
    assert live.mode == "rules" and live.take_fallbacks() == ["timeout"]


def test_a_null_persona_list_falls_back_to_the_rules_personas(match) -> None:
    live, _ = producer(
        [{"action": "narrate", "personas": None, "call_stats_desk": True, "why": "x"}]
    )
    task = run(live.decide(ctx(match), on_target_shots(match)[0]))
    assert isinstance(task, ProducerTask) and task.personas == ("casual", "analyst")
