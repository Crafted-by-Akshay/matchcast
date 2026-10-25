"""Vision's passes, kept beside the engine record (Vision -> Agents, ADR-0020).

The browser's pixel tracker posts the passes it sees to the match ``<session>.vision``. That match
runs the same four agents as an engine match, on pass events only: its Producer summarises the
passes every minute, its Analyst counts them, its Narrator writes "Vision has tracked ...", and its
Verifier recounts them from its own log. The Verifier also compares them with the engine's own pass
events (the truth feed), so the accuracy is measured, not assumed.

Nothing here writes to the engine record. A Vision pass is compared with an engine pass when they
share the team, the passer and the receiver, and their match times are within MATCH_WINDOW_MS.
"""

from collections.abc import Iterable, Mapping
from typing import Any

VISION_SUFFIX = ".vision"
VISION_SUMMARY_MS = 60_000  # a Vision summary every minute of match time, not every five
MATCH_WINDOW_MS = 8_000  # the tracker reports a pass a few seconds after it was played


def is_vision_stream(stream: Mapping[str, Any]) -> bool:
    return str(stream.get("session_id", "")).endswith(VISION_SUFFIX)


def engine_stream_of(vision_session: str) -> str:
    """The engine session a Vision session belongs to (``<session>.vision`` -> ``<session>``)."""
    return vision_session.removesuffix(VISION_SUFFIX)


def pass_facts(events: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """The pass events of a stream as plain facts: team, passer, receiver and match time."""
    return [
        {
            "team_id": e["payload"]["team_id"],
            "from_player_id": e["payload"]["player_id"],
            "to_player_id": e["payload"]["recipient_player_id"],
            "time_ms": e["event_time_ms"],
        }
        for e in events
        if e["payload"]["type"] == "pass"
    ]


def vision_count(passes: Iterable[dict[str, Any]], team: str, upto_ms: int) -> int:
    """How many passes Vision has tracked for a team up to a match time."""
    return sum(1 for p in passes if p["team_id"] == team and p["time_ms"] <= upto_ms)


def engine_count(events: Iterable[dict[str, Any]], team: str, upto_ms: int) -> int:
    """How many passes the engine recorded for a team up to a match time (the truth)."""
    return sum(
        1
        for e in events
        if e["payload"]["type"] == "pass"
        and e["payload"]["team_id"] == team
        and e["event_time_ms"] <= upto_ms
    )


def agreement(
    passes: list[dict[str, Any]], engine_events: Iterable[dict[str, Any]]
) -> dict[str, Any]:
    """How many of Vision's passes an engine pass backs. One engine pass backs one Vision pass."""
    index: dict[tuple[str, str, str], list[int]] = {}
    engine_total = 0
    for fact in pass_facts(engine_events):
        engine_total += 1
        key = (fact["team_id"], fact["from_player_id"], fact["to_player_id"])
        index.setdefault(key, []).append(fact["time_ms"])
    matched = 0
    for fact in sorted(passes, key=lambda p: p["time_ms"]):
        times = index.get((fact["team_id"], fact["from_player_id"], fact["to_player_id"]), [])
        if not times:
            continue
        best = min(range(len(times)), key=lambda i: abs(times[i] - fact["time_ms"]))
        if abs(times[best] - fact["time_ms"]) <= MATCH_WINDOW_MS:
            times.pop(best)
            matched += 1
    return {
        "vision": len(passes),
        "engine": engine_total,
        "matched": matched,
        "precision": matched / len(passes) if passes else None,
        "recall": matched / engine_total if engine_total else None,
    }
