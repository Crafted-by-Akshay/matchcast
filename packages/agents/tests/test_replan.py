"""The Showrunner's stall replan in the workflow (CREW-1.2): one rundown entry and the replay
specialist's crew_spawn frames per replan, and a second stall falls back to the rules storyline."""

from conftest import run
from matchcast_agents.stall import STALL_S, StallClock
from matchcast_contracts import validate


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def stalled_flow(make_workflow, match):
    flow = make_workflow()
    run(flow.ingest(match["events"][:5]))
    clock = Clock()
    flow._stall = StallClock(clock=clock)  # the replan is driven by this fake clock
    return flow, clock


def replan_frames(flow) -> list[dict]:
    return [
        e.data
        for e in flow.hub.history()
        if e.event == "crew_spawn" and e.data["moment_id"].startswith("replan-")
    ]


def test_a_stall_replans_once_with_one_rundown_entry_and_spawn_frames(make_workflow, match) -> None:
    flow, clock = stalled_flow(make_workflow, match)
    before = len(flow.rundown)
    clock.now += STALL_S
    flow._replan_if_stalled(flow._ctx(), match["events"][4])
    assert len(flow.rundown) == before + 1
    entry = flow.rundown[-1]
    assert entry["moment_id"].startswith("replan-")
    assert entry["called"] == ["replay"] and entry["skipped"] == []
    assert entry["routed_by"] == "rules"
    assert entry["why"].startswith("stall: match flow -> ")
    frames = replan_frames(flow)
    assert [f["status"] for f in frames] == ["running", "done"]
    for frame in frames:
        validate(frame)


def test_a_second_stall_with_no_line_falls_back_to_the_rules_storyline(
    make_workflow, match
) -> None:
    flow, clock = stalled_flow(make_workflow, match)
    clock.now += STALL_S
    flow._replan_if_stalled(flow._ctx(), match["events"][4])
    clock.now += STALL_S
    flow._replan_if_stalled(flow._ctx(), match["events"][4])
    assert flow.rundown[-1]["why"].endswith("(rules storyline)")
    assert flow._plan == "fallback:rules"


def test_no_stall_no_replan(make_workflow, match) -> None:
    flow, clock = stalled_flow(make_workflow, match)
    clock.now += STALL_S - 1
    before = len(flow.rundown)
    flow._replan_if_stalled(flow._ctx(), match["events"][4])
    assert len(flow.rundown) == before and replan_frames(flow) == []
