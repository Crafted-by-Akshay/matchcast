"""The rundown: one ledger entry per moment the crew takes, kept through a restart (CREW-1.1)."""

from conftest import fixed_clock, run
from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents import workflow as workflow_module
from matchcast_agents.specialists import SpawnBudget
from matchcast_agents.store import MemoryStore
from matchcast_agents.workflow import MatchSpawnBudgets


def build(
    match, store: MemoryStore, spawn_budgets: MatchSpawnBudgets | None = None
) -> MatchWorkflow:
    return MatchWorkflow(
        stream=match["roster"]["stream"], roster=match["roster"], names=match["names"],
        clubs=match["teams"], agents=rules_agents(), config=WorkflowConfig(), store=store,
        clock=fixed_clock(), spawn_budgets=spawn_budgets,
    )  # fmt: skip


def entry_for(flow: MatchWorkflow, event: dict) -> dict:
    return next(r for r in flow.rundown if r["moment_id"] == f"m-{event['event_id']}")


def test_a_goal_gets_an_entry_naming_the_agents_it_called(match) -> None:
    flow = build(match, MemoryStore())
    run(flow.ingest(match["events"]))
    goal = next(e for e in match["events"] if e["payload"]["type"] == "goal")
    entry = entry_for(flow, goal)
    spawned = {s["name"] for s in entry["spawns"]}
    assert set(entry["called"]) == {"analyst", "narrator", "verifier"} | spawned
    assert spawned == {"replay", "tactics", "stats", "rhythm"}
    assert entry["skipped"] == ["stats_desk"]  # no Stats Desk is wired into this build
    assert entry["why"] == "goal"
    assert entry["routed_by"] == "rules"


def test_every_decided_moment_has_exactly_one_entry(match) -> None:
    flow = build(match, MemoryStore())
    run(flow.ingest(match["events"]))
    moments = [r["moment_id"] for r in flow.rundown]
    assert len(moments) == flow.stats["moments"]
    assert len(set(moments)) == len(moments)


def test_the_rundown_survives_a_restart(match) -> None:
    store = MemoryStore()
    first = build(match, store)
    run(first.ingest(match["events"]))
    restarted = build(match, store)
    assert restarted.rundown == first.rundown


def test_a_saved_checkpoint_does_not_change_with_later_entries(match) -> None:
    store = MemoryStore()
    flow = build(match, store)
    run(flow.ingest(match["events"][:20]))
    saved = store.get_checkpoint(flow.sk)["rundown"]
    flow.rundown.append({"moment_id": "m-later", "called": [], "skipped": [], "why": "x"})
    assert store.get_checkpoint(flow.sk)["rundown"] == saved


def test_a_checkpoint_from_before_the_ledger_restores_an_empty_one(match) -> None:
    store = MemoryStore()
    first = build(match, store)
    run(first.ingest(match["events"]))
    row = store.get_checkpoint(first.sk)
    del row["rundown"]  # what a checkpoint written before this change looks like
    store.put_checkpoint(first.sk, row)
    assert build(match, store).rundown == []


def test_the_ledger_keeps_only_the_latest_moments(match, monkeypatch) -> None:
    everything = build(match, MemoryStore())
    run(everything.ingest(match["events"]))
    assert len(everything.rundown) > 2
    monkeypatch.setattr(workflow_module, "RUNDOWN_KEEP", 2)
    capped = build(match, MemoryStore())
    run(capped.ingest(match["events"]))
    kept = [r["moment_id"] for r in capped.rundown]
    assert kept == [r["moment_id"] for r in everything.rundown][-2:]


def test_quiet_moments_cannot_use_up_a_goals_specialists(match, monkeypatch) -> None:
    flow = build(match, MemoryStore())
    flow.quiet_budget.used = flow.quiet_budget.limit  # every quiet moment is out of allowance
    run(flow.ingest(match["events"]))
    goal = next(e for e in match["events"] if e["payload"]["type"] == "goal")
    goal_spawns = entry_for(flow, goal)["spawns"]
    assert {"replay", "tactics", "stats", "rhythm"} <= {s["name"] for s in goal_spawns}
    assert all(s["status"] in ("ok", "no_data") for s in goal_spawns)
    priority_one = {"goal", "red_card"}  # the producer's priority-1 moments draw on the main pool
    main_pool = sum(len(r["spawns"]) for r in flow.rundown if r["why"] in priority_one)
    assert flow.spawn_budget.used == main_pool
    quiet = [r for r in flow.rundown if r["why"] not in priority_one]
    assert quiet and all(
        "spawns" not in r and r["spawn_reason"] == "budget exhausted" for r in quiet
    )


def test_the_spawn_budgets_survive_a_restart(match) -> None:
    """A restart must not refill either pool: the caps are per match, not per process."""
    store = MemoryStore()
    first = build(match, store)
    run(first.ingest(match["events"]))
    assert first.spawn_budget.used > 0 and first.quiet_budget.used > 0
    restarted = build(match, store)
    assert restarted.spawn_budget.used == first.spawn_budget.used
    assert restarted.quiet_budget.used == first.quiet_budget.used


def test_a_refused_moment_has_a_reason_and_no_spawns_key(match) -> None:
    """A moment that spawns nothing carries spawn_reason only: the ledger gains no empty list."""
    flow = build(match, MemoryStore())
    flow.spawn_budget.used = flow.spawn_budget.limit
    flow.quiet_budget.used = flow.quiet_budget.limit
    run(flow.ingest(match["events"]))
    goal = next(e for e in match["events"] if e["payload"]["type"] == "goal")
    assert entry_for(flow, goal)["spawn_reason"] == "budget exhausted"
    assert all("spawns" not in r for r in flow.rundown)


def test_a_priority_one_goal_is_refused_once_its_pool_is_spent(match) -> None:
    flow = build(match, MemoryStore())
    flow.spawn_budget.used = flow.spawn_budget.limit  # the goal pool is out
    run(flow.ingest(match["events"]))
    goal = next(e for e in match["events"] if e["payload"]["type"] == "goal")
    entry = entry_for(flow, goal)
    assert entry["spawn_reason"] == "budget exhausted" and "spawns" not in entry
    assert set(entry["called"]) == {"analyst", "narrator", "verifier"}


def test_a_restart_mid_match_stays_refused_once_the_goal_pool_is_spent(match) -> None:
    """A tiny goal pool is spent by the first goal; a restart in between must not refill it."""
    goals = [i for i, e in enumerate(match["events"]) if e["payload"]["type"] == "goal"]
    cut = goals[0] + 1  # everything up to and including the first goal
    store = MemoryStore()
    first = build(match, store, MatchSpawnBudgets(priority_one=SpawnBudget(4)))
    run(first.ingest(match["events"][:cut]))
    assert first.spawn_budget.used == 4
    restarted = build(match, store, MatchSpawnBudgets(priority_one=SpawnBudget(4)))
    run(restarted.ingest(match["events"][cut:]))
    second = match["events"][goals[1]]
    assert entry_for(restarted, second)["spawn_reason"] == "budget exhausted"
    assert restarted.spawn_budget.used == 4


def test_two_workflows_of_one_match_draw_on_the_same_pools(match) -> None:
    """The engine and the Vision stream run one match: its caps are per match, not per stream."""
    shared = MatchSpawnBudgets(priority_one=SpawnBudget(4))
    engine = build(match, MemoryStore(), shared)
    run(engine.ingest(match["events"]))
    assert shared.priority_one.used == 4
    vision = build(match, MemoryStore(), shared)
    run(vision.ingest(match["events"]))
    goal = next(e for e in match["events"] if e["payload"]["type"] == "goal")
    assert entry_for(vision, goal)["spawn_reason"] == "budget exhausted"
    assert shared.priority_one.used == 4


def test_a_restart_without_a_checkpoint_replays_to_one_clean_run(match) -> None:
    """The process dies before its first save: the stored events are replayed from the start by a
    fresh workflow, and the replay ends where one clean run ends, with no moment counted twice."""
    clean = build(match, MemoryStore())
    run(clean.ingest(match["events"]))
    store = MemoryStore()
    flow = build(match, store)
    run(flow.ingest(match["events"]))
    store._checkpoints.pop(flow.sk, None)  # the save never happened
    restarted = build(match, store)
    run(restarted.ingest([]))  # the catch-up replays the stored events from the first one
    assert restarted.spawn_budget.used == clean.spawn_budget.used > 0
    assert restarted.quiet_budget.used == clean.quiet_budget.used
    assert restarted.rundown == clean.rundown


def test_a_missing_checkpoint_clears_the_ledger_and_this_workflows_spend(match) -> None:
    flow = build(match, MemoryStore())
    flow._set_spent(3, 1)
    flow.rundown.append({"moment_id": "m-old", "called": [], "skipped": [], "why": "x"})
    flow._restore()  # no checkpoint in the store: nothing of this run is kept
    assert flow.rundown == []
    assert flow.spawn_budget.used == 0 and flow.quiet_budget.used == 0
