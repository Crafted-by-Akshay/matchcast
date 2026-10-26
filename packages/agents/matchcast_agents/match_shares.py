"""Match-to-date share the Analyst cites on a priority-1 moment and the Verifier recounts (AB#373).

The engine emits no possession time, so possession is the team's share of its on-ball actions
(passes and carries), the same convention the Rhythm specialist uses, but over the whole match so
far. The Verifier recounts it from the stored events, never from agent state.

A correction or retraction is skipped, not applied to the event it names, the same as the counts
recount. Pass accuracy was built and then taken out: the engine logs a turnover as a loose-ball
possession change whatever caused it, so it cannot tell a failed pass from any other loss of the ball.
"""

from typing import Any

POSSESSION = "possession_share"
SHARE_METRICS = (POSSESSION,)


def _visible(events: list[dict[str, Any]], upto: int) -> list[dict[str, Any]]:
    return [
        e["payload"]
        for e in events
        if e["stream_sequence"] <= upto and e["payload"]["type"] not in ("correction", "retraction")
    ]


def _percent(part: int, total: int) -> int:
    return round(100 * part / total) if total else 0


def possession_share(events: list[dict[str, Any]], team: str, upto: int) -> int:
    """The team's percent of the on-ball actions (passes and carries) by both teams, up to ``upto``.

    Both teams are read from the events themselves, so a grader needs no roster to recount it.
    """
    on_ball: dict[str, int] = {}
    for p in _visible(events, upto):
        if p["type"] in ("pass", "carry") and p.get("team_id"):
            on_ball[p["team_id"]] = on_ball.get(p["team_id"], 0) + 1
    return _percent(on_ball.get(team, 0), sum(on_ball.values()))


def recount(metric: str, events: list[dict[str, Any]], upto: int) -> int:
    """Recount a ``possession_share:<team>`` claim from the events."""
    name, team = metric.split(":", 1)
    assert name == POSSESSION, metric
    return possession_share(events, team, upto)
