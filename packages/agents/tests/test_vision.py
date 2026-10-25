"""Vision -> Agents (ADR-0022): the ``<session>.vision`` match's agents count Vision's passes
and check them against the engine's own passes. The engine record is never touched.
"""

import copy
import re

import pytest
from conftest import fixed_clock, run
from matchcast_agents import MatchWorkflow, WorkflowConfig
from matchcast_agents.live import ScriptedModelClient, live_agents
from matchcast_agents.vision import (
    MATCH_WINDOW_MS,
    VISION_SUMMARY_MS,
    agreement,
    engine_count,
    pass_facts,
    vision_count,
)
from test_live_agents import answer


def engine_passes(match, team):
    return [
        e for e in match["events"]
        if e["payload"]["type"] == "pass" and e["payload"]["team_id"] == team
    ]  # fmt: skip


def vision_stream(match):
    return {
        **match["roster"]["stream"],
        "session_id": match["roster"]["stream"]["session_id"] + ".vision",
    }


def mirrored_passes(match):
    return pass_facts(vision_events(match))


def vision_events(match, lag_ms=1_000):
    """Vision's own pass events: the engine's passes, a second late, on the vision stream."""
    stream = vision_stream(match)
    rows = []
    for seq, e in enumerate(
        sorted(
            engine_passes(match, "home") + engine_passes(match, "away"),
            key=lambda e: e["event_time_ms"],
        ),
        start=1,
    ):
        row = copy.deepcopy(e)
        row.update(
            stream=stream,
            stream_sequence=seq,
            event_id=f"v{seq}",
            revision=0,
            event_time_ms=e["event_time_ms"] + lag_ms,
        )
        row["clock"] = {"period": 1, "period_elapsed_ms": row["event_time_ms"]}
        rows.append(row)
    return rows


def build_vision(match, *, truth=True, client=None):
    config = WorkflowConfig()
    extra = {"agents": live_agents(client, config.personas)} if client else {}
    return MatchWorkflow(
        stream=vision_stream(match),
        roster={**match["roster"], "stream": vision_stream(match)},
        names=match["names"], clubs=match["teams"], config=config, clock=fixed_clock(),
        truth_feed=(lambda: match["events"]) if truth else None, **extra,
    )  # fmt: skip


def checks(flow, name):
    return [c for ln in flow.store.lines(flow.sk) for c in ln.checks if c.name == name]


# ---- the pure helpers -----------------------------------------------------------------------


def test_vision_count_counts_one_team_up_to_the_time() -> None:
    passes = [
        {"team_id": "home", "from_player_id": "a", "to_player_id": "b", "time_ms": 1_000},
        {"team_id": "home", "from_player_id": "b", "to_player_id": "c", "time_ms": 9_000},
        {"team_id": "away", "from_player_id": "x", "to_player_id": "y", "time_ms": 2_000},
    ]
    assert vision_count(passes, "home", 5_000) == 1
    assert vision_count(passes, "home", 9_000) == 2
    assert vision_count(passes, "away", 9_000) == 1


def test_engine_count_is_the_engine_truth_up_to_the_time(match) -> None:
    cut = engine_passes(match, "home")[5]["event_time_ms"]
    expected = sum(1 for e in engine_passes(match, "home") if e["event_time_ms"] <= cut)
    assert engine_count(match["events"], "home", cut) == expected


def test_agreement_matches_vision_passes_to_engine_passes_in_the_window(match) -> None:
    lagged = vision_events(match, lag_ms=1_000)
    passes = [
        {"team_id": e["payload"]["team_id"], "from_player_id": e["payload"]["player_id"],
         "to_player_id": e["payload"]["recipient_player_id"], "time_ms": e["event_time_ms"]}
        for e in lagged
    ]  # fmt: skip
    stray = {
        "team_id": "home",
        "from_player_id": "home1",
        "to_player_id": "home2",
        "time_ms": 10**9,
    }
    report = agreement([*passes, stray], match["events"])
    # passes the engine has not reached yet (the stray one, and any in the last seconds) are pending
    assert report["pending"] >= 1
    assert report["vision"] + report["pending"] == len(passes) + 1
    assert report["matched"] == report["vision"]
    assert report["precision"] == pytest.approx(1.0)
    assert report["recall"] == pytest.approx(report["matched"] / report["engine"])


def test_engine_passes_before_vision_started_are_not_counted_against_it(match) -> None:
    later = [p for p in mirrored_passes(match) if p["time_ms"] > 60_000]  # the tracker starts late
    report = agreement(later, match["events"])
    assert report["vision"] + report["pending"] == len(later)
    assert report["matched"] == report["vision"]
    assert report["engine"] < sum(1 for e in match["events"] if e["payload"]["type"] == "pass")


def test_a_check_reports_disagreement_as_a_lower_share(match) -> None:
    keep_every_other = vision_events(match)[::2]  # Vision misses half the passes
    flow = build_vision(match)
    run(flow.ingest(keep_every_other))
    shares = [
        int(m) for c in checks(flow, "vision") for m in re.findall(r"\((\d+)% agree\)", c.detail)
    ]
    assert shares and min(shares) < 100


def test_a_pass_outside_the_window_is_not_matched(match) -> None:
    first = engine_passes(match, "home")[0]
    late = {"team_id": "home", "from_player_id": first["payload"]["player_id"],
            "to_player_id": first["payload"]["recipient_player_id"],
            "time_ms": first["event_time_ms"] + MATCH_WINDOW_MS + 1}  # fmt: skip
    assert agreement([late], match["events"])["matched"] == 0


# ---- the Vision stream's agents -------------------------------------------------------------


def test_the_vision_summary_counts_passes_not_shots(match) -> None:
    flow = build_vision(match)
    run(flow.ingest(vision_events(match)))
    summaries = [
        c["packet"]
        for c in flow.store.claims(flow.sk)
        if c["packet"]["metric"].startswith("passes:")
    ]
    assert summaries, "a Vision summary should have been written"
    assert not any(c["packet"]["metric"].startswith("shots") for c in flow.store.claims(flow.sk))
    lines = [ln.text for ln in flow.store.lines(flow.sk) if ln.status == "published"]
    assert lines and all("Vision" in text for text in lines)
    assert not any("Shots" in text for text in lines)


def test_each_vision_summary_is_recounted_from_vision_and_checked_against_the_engine(match) -> None:
    flow = build_vision(match)
    run(flow.ingest(vision_events(match)))
    verified = checks(flow, "vision")
    assert verified and all(c.passed for c in verified)
    assert all("agree" in c.detail and "engine" in c.detail for c in verified)


def test_without_engine_truth_the_check_says_so(match) -> None:
    flow = build_vision(match, truth=False)
    run(flow.ingest(vision_events(match)))
    assert checks(flow, "vision") and all("no engine" in c.detail for c in checks(flow, "vision"))


def test_the_summary_reports_passes_in_and_agreement(match) -> None:
    flow = build_vision(match)
    run(flow.ingest(vision_events(match)))
    summary = flow.vision_summary()
    assert summary["passes_in"] == len(vision_events(match))
    assert summary["lines_verified"] >= 1
    assert summary["agreement"]["precision"] == pytest.approx(1.0)
    assert summary["agreement"]["recall"] == pytest.approx(
        summary["agreement"]["matched"] / summary["agreement"]["engine"]
    )
    assert summary["latest_line"] and "Vision" in summary["latest_line"]


def test_the_engine_record_is_not_written_by_vision(match) -> None:
    flow = build_vision(match)
    run(flow.ingest(vision_events(match)))
    assert flow.store.events(flow.sk) == vision_events(
        match
    )  # its own stream, nothing copied across
    assert all(e["stream"] == vision_stream(match) for e in flow.store.events(flow.sk))


def test_a_wrong_count_in_a_vision_line_is_rejected_then_repaired(match, monkeypatch) -> None:
    monkeypatch.setenv("MATCHCAST_LIVE_MAX_PRIORITY", "3")  # the Vision summary goes to the model
    drafts = {"n": 0}

    def narrator(facts):
        drafts["n"] += 1
        claim = next(c for c in facts["claims"] if c["metric"].startswith("passes:"))
        number = claim["value"] + (0 if "note" in facts else 50)  # the first draft lies
        text = f"Vision has tracked {number:g} passes."
        return {"lines": [{"persona": p, "text": text} for p in facts["personas"]]}

    client = ScriptedModelClient(lambda s, u: answer(s, u, narrator=narrator))
    flow = build_vision(match, client=client)
    run(flow.ingest(vision_events(match)))
    assert "line_rejected" in [r["action"] for r in flow.store.audit_records(flow.sk)]
    assert not any("50" in ln.text for ln in flow.store.lines(flow.sk) if ln.status == "published")


def test_vision_summaries_come_every_minute_not_every_five(match) -> None:
    flow = build_vision(match)
    run(flow.ingest(vision_events(match)))
    times = sorted({c["packet"]["snapshot"]["event_time_ms"] for c in flow.store.claims(flow.sk)
                    if c["packet"]["metric"].startswith("passes:")})  # fmt: skip
    assert len(times) >= 5  # a ten-minute match at one summary a minute, not one every five
    assert all(later - earlier >= VISION_SUMMARY_MS for earlier, later in zip(times, times[1:]))
