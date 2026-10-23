"""A goal line says why it matters, from the two goal claims, and personas differ in substance."""

import pytest
from conftest import run
from matchcast_agents.rules.narrator import GOAL_CONTEXT, goal_context


@pytest.mark.parametrize(
    ("scored", "conceded", "kind"),
    [(1, 0, "opens"), (1, 1, "level"), (2, 2, "level"), (2, 1, "ahead"), (1, 2, "pulls"),
     (3, 1, "extends"), (2, 0, "extends")],
)  # fmt: skip
def test_goal_context_cases(scored: int, conceded: int, kind: str) -> None:
    assert goal_context(scored, conceded) == kind


def test_every_context_has_a_line_for_each_persona_and_no_digits() -> None:
    for texts in GOAL_CONTEXT.values():
        assert set(texts) == {"casual", "analyst", "broadcast"}
        assert not any(ch.isdigit() for t in texts.values() for ch in t)


def test_published_goal_lines_explain_and_differ_by_persona(make_workflow, match) -> None:
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    goals = {e["event_id"] for e in match["events"] if e["payload"]["type"] == "goal"}
    by_moment: dict[str, dict[str, str]] = {}
    for line in flow.store.lines(flow.sk):
        if line.status == "published" and line.moment_id.removeprefix("m-") in goals:
            by_moment.setdefault(line.moment_id, {})[line.persona] = line.text
    assert by_moment
    phrases = {t for texts in GOAL_CONTEXT.values() for t in texts.values()}
    for texts in by_moment.values():
        for persona in ("casual", "analyst"):
            assert any(p.split("{")[0].strip(" .") in texts[persona] for p in phrases), texts
        assert texts["casual"] != texts["analyst"]


def test_passes_pressures_and_possession_are_counted_and_recounted(match) -> None:
    from matchcast_agents.metrics_spec import METRIC_UNITS
    from matchcast_agents.state import MatchState, apply

    state = MatchState()
    for event in match["events"][:400]:
        state = apply(state, event)
    kinds = [e["payload"]["type"] for e in match["events"][:400]]
    for metric, kind in (("passes", "pass"), ("pressures", "pressure")):
        total = sum(state.count(metric, team) for team in ("home", "away"))
        assert total == kinds.count(kind) > 0
        assert METRIC_UNITS[metric] == "count"
    won = sum(state.count("possession_won", team) for team in ("home", "away"))
    assert won == kinds.count("possession_change")


def test_an_old_checkpoint_without_the_new_keys_still_counts() -> None:
    from matchcast_agents.state import MatchState

    old = MatchState.model_validate({"counts": {"shots": {"home": 2}}})
    assert old.count("passes", "home") == 0 and old.count("shots", "home") == 2


def test_shot_and_card_lines_say_why_the_moment_matters(match) -> None:
    from conftest import fixed_clock
    from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents

    config = WorkflowConfig(approval_mode="auto", personas=("casual", "analyst", "broadcast"))
    flow = MatchWorkflow(
        stream=match["roster"]["stream"], roster=match["roster"], names=match["names"],
        clubs=match["teams"], agents=rules_agents(config.personas), config=config,
        clock=fixed_clock(),
    )  # fmt: skip
    run(flow.ingest(match["events"]))
    published = [ln for ln in flow.store.lines(flow.sk) if ln.status == "published"]

    def texts(persona: str, needle: str) -> list[str]:
        return [ln.text for ln in published if ln.persona == persona and needle in ln.text]

    shots = texts("casual", "tests the keeper")
    assert shots and all("pressure is on the defence" in t for t in shots)
    assert not any(ch.isdigit() for t in shots for ch in t)  # no number the Verifier cannot tie
    forced = texts("broadcast", "forces a save")
    assert forced and all("pressure is building" in t for t in forced)
    reds = texts("casual", "Red card")
    assert reds and all("a player short" in t for t in reds)
    assert not any(" ten" in t for t in reds)  # a spelled-out number would escape the recount
