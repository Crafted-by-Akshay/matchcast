"""The one Vision moment on the engine feed (ADR-0022): Vision's pass count for each team beside
the engine's own, verified against both. The engine's events and claims are never written to.
"""

from conftest import fixed_clock, run
from matchcast_agents import MatchWorkflow, WorkflowConfig
from matchcast_agents.vision import pass_facts, vision_value
from test_vision import vision_events

ENGINE_MS = 60_000  # the config time for the moment: early in the ten-minute fixture


def engine_flow(match, *, feed=None, moment_ms=ENGINE_MS):
    return MatchWorkflow(
        stream=match["roster"]["stream"],
        roster=match["roster"],
        names=match["names"],
        clubs=match["teams"],
        config=WorkflowConfig(vision_moment_ms=moment_ms),
        clock=fixed_clock(),
        vision_feed=feed,
    )


def vision_lines(flow):
    return [ln for ln in flow.store.lines(flow.sk) if ln.moment_id.startswith("v-")]


def test_the_engine_feed_gets_one_vision_moment_with_both_counts(match) -> None:
    flow = engine_flow(match, feed=lambda: pass_facts(vision_events(match)))
    run(flow.ingest(match["events"]))
    lines = vision_lines(flow)
    assert lines, "the engine feed should carry the Vision moment"
    assert len({ln.moment_id for ln in lines}) == 1  # one moment, however many passes came
    for ln in lines:
        assert ln.status == "published", (ln.status, ln.checks)
        assert "Vision" in ln.text
        numbers = [c for c in ln.checks if c.name == "numbers"]
        assert numbers and all(c.passed for c in numbers)


def test_the_moment_states_vision_and_the_engine_side_by_side(match) -> None:
    flow = engine_flow(match, feed=lambda: pass_facts(vision_events(match)))
    run(flow.ingest(match["events"]))
    analyst = [ln for ln in vision_lines(flow) if ln.persona == "analyst"]
    assert analyst
    text = analyst[0].text
    assert "Vision counted" in text and "the engine counted" in text
    # the figure in the line is the claim's: Vision's count, recounted from the feed at the moment
    claims = {c["packet"]["metric"]: c["packet"]["value"] for c in flow.store.claims(flow.sk)}
    home = match["roster"]["team_ids"][0]
    assert f"{claims[f'vision_passes:{home}']:g} passes" in text
    assert f"{claims[f'passes:{home}']:g} and" in text or f"{claims[f'passes:{home}']:g}" in text


def test_without_a_vision_feed_the_engine_feed_has_no_vision_moment(match) -> None:
    flow = engine_flow(match, feed=None)
    run(flow.ingest(match["events"]))
    assert vision_lines(flow) == []


def test_the_moment_waits_until_its_time(match) -> None:
    flow = engine_flow(match, feed=lambda: pass_facts(vision_events(match)), moment_ms=10**9)
    run(flow.ingest(match["events"]))
    assert vision_lines(flow) == []


def test_a_vision_count_is_recounted_from_the_feed(match) -> None:
    passes = pass_facts(vision_events(match))
    home = match["roster"]["team_ids"][0]
    later = vision_value("vision_passes", home, passes, match["events"], 10**9)
    earlier = vision_value("vision_passes", home, passes, match["events"], 0)
    assert earlier == 0 and later > 0


def test_vision_precision_is_none_until_a_pass_is_covered(match) -> None:
    # Vision passes that the engine has not reached yet are pending, not misses
    late = [{"team_id": "home", "from_player_id": "a", "to_player_id": "b", "time_ms": 10**9}]
    assert vision_value("vision_precision", "home", late, match["events"], 10**9) is None
