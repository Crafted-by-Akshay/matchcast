"""Watch-mode personas (AGT-6): five different lines per goal, limits, and no foreign names."""

from conftest import run
from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents.personas import max_chars, max_numbers, valid
from matchcast_agents.verify.checks import extract_numbers


def flow_with(match, personas, make_workflow=None):
    config = WorkflowConfig(personas=tuple(personas), approval_mode="auto")
    flow = MatchWorkflow(
        stream=match["roster"]["stream"],
        roster=match["roster"],
        names=match["names"],
        clubs=match["teams"],
        agents=rules_agents(config.personas),
        config=config,
    )
    run(flow.ingest(match["events"]))
    return flow


def scorer(match) -> tuple[str, str]:
    goal = next(e for e in match["events"] if e["payload"]["type"] == "goal")
    return goal["payload"]["player_id"], goal["payload"]["team_id"]


def test_persona_names_are_validated() -> None:
    assert valid("my-club:home") and valid("player-focus:home9") and valid("one-metric:shots")
    assert not valid("my-club:") and not valid("poet") and not valid("one-metric:Shots")
    assert max_chars("analyst") == 280 and max_chars("my-club:home") == 140
    assert max_numbers("casual") == 1 and max_numbers("one-metric:xg") == 2


def test_goal_moment_gives_five_different_lines_within_limits(match) -> None:
    player, team = scorer(match)
    other = "away" if team == "home" else "home"
    personas = [
        "casual",
        "analyst",
        f"my-club:{other}",
        f"player-focus:{player}",
        "one-metric:goals",
    ]
    flow = flow_with(match, personas)
    lines = flow.store.lines(flow.sk)
    by_moment: dict[str, list] = {}
    for line in lines:
        by_moment.setdefault(line.moment_id, []).append(line)
    full = next(v for v in by_moment.values() if {ln.persona for ln in v} == set(personas))
    assert len({ln.text for ln in full}) == 5
    for line in full:
        assert len(line.text) <= max_chars(line.persona)
        assert len(extract_numbers(line.text)) <= max_numbers(line.persona)
        assert line.status in ("verified", "published", "approved")


def test_player_focus_only_speaks_about_that_player(match) -> None:
    player, _ = scorer(match)
    flow = flow_with(match, [f"player-focus:{player}"])
    lines = flow.store.lines(flow.sk)
    assert lines and all(flow.names[player] in ln.text for ln in lines)


def test_one_metric_only_quotes_that_metric(match) -> None:
    flow = flow_with(match, ["one-metric:shots_on_target"])
    lines = flow.store.lines(flow.sk)
    assert lines and all(ln.text.startswith("Shots on target:") for ln in lines)


def test_watch_client_names_map_to_server_personas(match) -> None:
    from matchcast_agents.personas import normalise

    clubs, names = match["teams"], match["names"]
    assert normalise("fan", clubs, names) == "casual"
    assert normalise("club:northgate-fc", clubs, names) == "my-club:home"
    assert normalise("club:away", clubs, names) == "my-club:away"
    player = next(iter(names))
    assert normalise(f"player:{names[player]}", clubs, names) == f"player-focus:{player}"
    assert normalise("metric:shots-on-target", clubs, names) == "one-metric:shots_on_target"
    assert normalise("club:nobody", clubs, names) is None


def test_a_watch_mode_added_mid_match_gets_lines_from_then_on(match) -> None:
    config = WorkflowConfig(personas=("casual",), approval_mode="auto")
    flow = MatchWorkflow(
        stream=match["roster"]["stream"], roster=match["roster"], names=match["names"],
        clubs=match["teams"], agents=rules_agents(config.personas), config=config,
    )  # fmt: skip
    half = len(match["events"]) // 2
    run(flow.ingest(match["events"][:half]))
    first_half = {ln.moment_id for ln in flow.store.lines(flow.sk)}
    assert flow.add_persona("one-metric:shots") and flow.add_persona("one-metric:shots")
    assert flow.extra_personas == ["one-metric:shots"]
    run(flow.ingest(match["events"][half:]))
    metric = [ln for ln in flow.store.lines(flow.sk) if ln.persona == "one-metric:shots"]
    assert metric and not {ln.moment_id for ln in metric} & first_half


def test_a_watch_mode_must_point_at_something_real_and_is_capped(match) -> None:
    from matchcast_agents.personas import MAX_WATCH_MODES, WATCH_METRICS, normalise
    from matchcast_agents.rules.narrator import LABELS

    assert WATCH_METRICS == set(LABELS)
    clubs, names = match["teams"], match["names"]
    flow = flow_with(match, ["casual"])
    for bogus in ("poet", "my-club:nobody", "player-focus:nobody", "one-metric:bogus"):
        assert not flow.add_persona(bogus) and normalise(bogus, clubs, names) is None
    assert normalise(None, clubs, names) is None and normalise("", clubs, names) is None
    assert normalise("producer", clubs, names) == "broadcast"
    assert normalise("player:nobody", clubs, names) is None
    assert normalise("metric:Shots!", clubs, names) is None
    modes = [f"one-metric:{m}" for m in sorted(WATCH_METRICS)] + [f"my-club:{t}" for t in clubs]
    added = [flow.add_persona(m) for m in modes]
    assert added.count(True) == MAX_WATCH_MODES and len(flow.extra_personas) == MAX_WATCH_MODES
    assert flow.add_persona("casual")  # a base persona is always fine
