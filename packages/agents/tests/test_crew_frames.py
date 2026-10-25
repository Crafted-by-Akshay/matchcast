"""The crew's live frames (contract 1.3.0): one crew_ledger per moment whose run has ended, and a
crew_spawn on start and on end of each specialist. Each frame validates against the contract."""

from conftest import run
from matchcast_agents.messages import ProducerTask
from matchcast_contracts import validate

SPAWN_STATUSES = {"running", "done", "no_data", "failed", "budget_exhausted"}


def frames(flow, event: str) -> list[dict]:
    return [e.data for e in flow.hub.history() if e.event == event]


def test_every_decided_moment_sends_one_valid_ledger_frame(make_workflow, match) -> None:
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    ledgers = frames(flow, "crew_ledger")
    assert len(ledgers) == len(flow.rundown) > 0
    assert [f["moment_id"] for f in ledgers] == [e["moment_id"] for e in flow.rundown]
    for frame in ledgers:
        validate(frame)
        assert frame["schema_version"] == "1.3.0"


def test_a_ledger_frame_carries_what_actually_ran(make_workflow, match) -> None:
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    for frame, entry in zip(frames(flow, "crew_ledger"), flow.rundown):
        assert frame["called"] == entry["called"]
        assert frame["skipped"] == entry["skipped"]
        assert frame["routed_by"] == entry["routed_by"]


def test_each_specialist_sends_a_start_and_an_end_frame(make_workflow, match) -> None:
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    spawns = frames(flow, "crew_spawn")
    assert spawns, "a priority-one moment in the fixture should spawn specialists"
    for frame in spawns:
        validate(frame)
        assert frame["status"] in SPAWN_STATUSES
        assert frame["parent_id"] == "showrunner"
        assert frame["spawn_id"] == f"{frame['moment_id']}:{frame['agent_id']}"
    started = [f for f in spawns if f["status"] == "running"]
    ended = [f for f in spawns if f["status"] != "running"]
    assert started and {f["spawn_id"] for f in started} == {f["spawn_id"] for f in ended}
    for frame in started:
        assert frame["ended_ms"] is None
    for frame in ended:
        assert frame["ended_ms"] == frame["started_ms"]


def test_no_free_text_with_numbers_reaches_the_wire(make_workflow, match) -> None:
    # a specialist's why and the model's route why carry numbers the Verifier has not checked,
    # so the frames carry a reason code (ledger) and nothing (spawn) instead
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    assert all(f["why"] == "" for f in frames(flow, "crew_spawn"))
    for frame in frames(flow, "crew_ledger"):
        assert not any(char.isdigit() for char in frame["why"])


def test_a_model_route_why_never_reaches_the_ledger(make_workflow, match) -> None:
    # the Producer's model route carries a free-text why with numbers; the ledger sends only the
    # reason code, so this fails on any version that copies task.why onto the wire
    flow = make_workflow()
    task = ProducerTask(
        moment_id="m-model-route",
        match_id=flow.stream["match_id"],
        event_ids=(match["events"][0]["event_id"],),
        up_to_sequence=match["events"][0]["stream_sequence"],
        priority=2,
        personas=("analyst",),
        reason="buildup",
        routed_by="model",
        why="The model says 62% of the on-ball actions came from one side",
    )
    flow._record_rundown(task)
    flow._publish_ledger(flow.rundown[-1])
    (frame,) = frames(flow, "crew_ledger")
    validate(frame)
    assert frame["why"] == "buildup"
    assert frame["routed_by"] == "model"
