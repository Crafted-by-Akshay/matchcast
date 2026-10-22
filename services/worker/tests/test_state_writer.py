"""ADR-0017: reducer and workflow reach the same counters, and the reducer can own the table."""

import asyncio
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "packages" / "agents" / "tests"))

from fake_tables import FakeContainer, FakeTableService  # noqa: E402
from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents  # noqa: E402
from matchcast_agents.state import MatchState  # noqa: E402
from matchcast_agents.store import stream_key  # noqa: E402
from matchcast_agents.tables import BufferedTableStore, TableStore  # noqa: E402
from matchcast_worker.reducer import StreamState  # noqa: E402
from matchcast_worker.repo import MemoryStateRepo, process  # noqa: E402
from matchcast_worker.table_repo import TableStateRepo  # noqa: E402

MATCH = json.loads(
    (Path(__file__).parents[3] / "packages/agents/tests/fixtures/match-short.json").read_text()
)
COUNTERS = ("score", "counts", "possession", "max_sequence", "period")


def workflow(store=None) -> MatchWorkflow:
    config = WorkflowConfig(approval_mode="auto")
    return MatchWorkflow(
        stream=MATCH["roster"]["stream"],
        roster=MATCH["roster"],
        names=MATCH["names"],
        clubs=MATCH["teams"],
        agents=rules_agents(config.personas),
        config=config,
        store=store,
    )


def held_back(state: StreamState) -> set[int]:
    return set(state.pending)


def test_reducer_and_workflow_agree_on_the_counters_after_a_messy_delivery() -> None:
    events = MATCH["events"][:200]
    rng = random.Random(7)
    messy = list(events)
    rng.shuffle(messy)
    messy += rng.sample(events, 20)  # duplicates

    repo = MemoryStateRepo()
    process(repo, messy)
    reducer_state = repo.get(stream_key(MATCH["roster"]["stream"]))
    assert reducer_state is not None and not held_back(reducer_state)

    flow = workflow()
    asyncio.run(flow.ingest(events))
    flow_state = flow.store.get_state(flow.sk)
    for field in COUNTERS:
        assert getattr(reducer_state, field) == getattr(flow_state, field), field


def test_a_workflow_that_does_not_own_the_table_leaves_matchstate_to_the_reducer() -> None:
    service = FakeTableService()
    store = BufferedTableStore(TableStore(service, FakeContainer()), write_state=False)
    flow = workflow(store)
    events = MATCH["events"][:60]
    asyncio.run(flow.ingest(events))
    store.flush()

    sk = flow.sk
    assert flow.store.get_state(sk).max_sequence == events[-1]["stream_sequence"]
    assert TableStateRepo(service).get(sk) is None  # the workflow wrote no matchstate row

    repo = TableStateRepo(service)
    process(repo, events)
    saved = repo.get(sk)
    assert saved is not None and saved.max_sequence == events[-1]["stream_sequence"]

    restarted = BufferedTableStore(TableStore(service, FakeContainer()), write_state=False)
    after = restarted.get_state(sk)  # comes from the checkpoint, not the reducer's row
    assert isinstance(after, MatchState)
    assert after.max_sequence == events[-1]["stream_sequence"]
