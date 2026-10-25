"""The rundown: one ledger entry per moment the crew takes, kept through a restart (CREW-1.1)."""

from conftest import fixed_clock, run
from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents import workflow as workflow_module
from matchcast_agents.store import MemoryStore


def build(match, store: MemoryStore) -> MatchWorkflow:
    return MatchWorkflow(
        stream=match["roster"]["stream"], roster=match["roster"], names=match["names"],
        clubs=match["teams"], agents=rules_agents(), config=WorkflowConfig(), store=store,
        clock=fixed_clock(),
    )  # fmt: skip


def entry_for(flow: MatchWorkflow, event: dict) -> dict:
    return next(r for r in flow.rundown if r["moment_id"] == f"m-{event['event_id']}")


def test_a_goal_gets_an_entry_naming_the_agents_it_called(match) -> None:
    flow = build(match, MemoryStore())
    run(flow.ingest(match["events"]))
    goal = next(e for e in match["events"] if e["payload"]["type"] == "goal")
    entry = entry_for(flow, goal)
    assert {"analyst", "narrator", "verifier"} <= set(entry["called"])
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
    assert {"replay", "tactics", "stats", "rhythm"} <= {
        s["name"] for s in entry_for(flow, goal)["spawns"]
    }
    priority_one = {"goal", "red_card"}  # the producer's priority-1 moments draw on the main pool
    quiet = [r for r in flow.rundown if r["why"] not in priority_one]
    assert quiet and all(
        r["spawns"] == [] and r["spawn_reason"] == "budget exhausted" for r in quiet
    )
