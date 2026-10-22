"""A crash mid-match loses no claims and repeats none (AGT-13, memory store)."""

import pytest
from conftest import fixed_clock, run
from matchcast_agents import AgentSet, MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents.rules import NarratorRules
from matchcast_agents.store import MemoryStore
from matchcast_contracts.audit import verify_chain


class Crash(RuntimeError):
    pass


class CrashingNarrator(NarratorRules):
    """Dies on its Nth call, like a container killed in the middle of a moment."""

    def __init__(self, die_on: int) -> None:
        self.die_on, self.calls = die_on, 0

    async def write(self, ctx, task, claims, *, attempt=0):
        self.calls += 1
        if self.calls == self.die_on:
            raise Crash("container killed")
        return await super().write(ctx, task, claims, attempt=attempt)


def build(match, store: MemoryStore, narrator=None) -> MatchWorkflow:
    base = rules_agents()
    agents = AgentSet(base.producer, base.analyst, narrator or base.narrator, base.verifier)
    return MatchWorkflow(
        stream=match["roster"]["stream"], roster=match["roster"], names=match["names"],
        clubs=match["teams"], agents=agents, config=WorkflowConfig(), store=store,
        clock=fixed_clock(),
    )  # fmt: skip


def snapshot(flow: MatchWorkflow) -> dict:
    return {
        "claims": sorted(r["packet"]["claim_id"] for r in flow.store.claims(flow.sk)),
        "published": sorted(p["publication_id"] for p in flow.store.publications(flow.sk)),
        "lines": sorted((ln.line_id, ln.status) for ln in flow.store.lines(flow.sk)),
        "state": flow.store.get_state(flow.sk).model_dump(),
    }


@pytest.mark.parametrize("die_on", [1, 3, 8])
def test_resume_after_a_crash_matches_an_uninterrupted_run(match, die_on: int) -> None:
    clean = build(match, MemoryStore())
    run(clean.ingest(match["events"]))

    store = MemoryStore()
    crashing = build(match, store, CrashingNarrator(die_on))
    with pytest.raises(Crash):
        run(crashing.ingest(match["events"]))
    assert store.get_checkpoint(crashing.sk) is not None or die_on == 1

    restarted = build(match, store)  # a new process on the same store
    run(restarted.ingest(match["events"]))  # the client re-sends the whole batch

    assert snapshot(restarted) == snapshot(clean)
    claim_ids = [r["packet"]["claim_id"] for r in restarted.store.claims(restarted.sk)]
    assert len(claim_ids) == len(set(claim_ids))
    publications = [p["publication_id"] for p in restarted.store.publications(restarted.sk)]
    assert len(publications) == len(set(publications))
    assert verify_chain(restarted.store.audit_records(restarted.sk))["valid"] is True


def test_resume_without_new_events_finishes_the_interrupted_one(match) -> None:
    store = MemoryStore()
    crashing = build(match, store, CrashingNarrator(2))
    with pytest.raises(Crash):
        run(crashing.ingest(match["events"][:60]))
    restarted = build(match, store)
    run(restarted.ingest(match["events"][:1]))  # a duplicate is enough to trigger the catch-up
    clean = build(match, MemoryStore())
    run(clean.ingest(match["events"][: store.get_state(restarted.sk).max_sequence]))
    assert snapshot(restarted)["claims"] == snapshot(clean)["claims"]
