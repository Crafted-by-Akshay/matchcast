"""Match-to-date shares the Analyst cites on a priority-1 moment and the Verifier recounts (AB#373).

The engine emits no possession time, so possession is the team's share of its on-ball actions
(passes and carries), the same convention the Rhythm specialist uses, but over the whole match so
far. Pass accuracy is the share of a team's passes that completed. The engine records a completed
pass as a pass event and a failed one as a loose-ball turnover (a possession change), so accuracy
is completed passes over completed passes plus loose-ball losses. Both are estimates of the
engine's record, and the Verifier recounts them from the stored events, never from agent state.
"""

from typing import Any

POSSESSION = "possession_share"
PASS_ACCURACY = "pass_accuracy"
SHARE_METRICS = (POSSESSION, PASS_ACCURACY)


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


def pass_accuracy(events: list[dict[str, Any]], team: str, upto: int) -> int:
    """The percent of the team's passes that completed, up to ``upto``."""
    completed = lost = 0
    for p in _visible(events, upto):
        if p["type"] == "pass" and p.get("team_id") == team:
            completed += 1
        elif (
            p["type"] == "possession_change"
            and p.get("from_team_id") == team
            and p.get("cause") == "loose_ball"
        ):
            lost += 1
    return _percent(completed, completed + lost)


def recount(metric: str, events: list[dict[str, Any]], upto: int) -> int:
    """Recount a ``possession_share:<team>`` or ``pass_accuracy:<team>`` claim from the events."""
    name, team = metric.split(":", 1)
    if name == POSSESSION:
        return possession_share(events, team, upto)
    assert name == PASS_ACCURACY, metric
    return pass_accuracy(events, team, upto)
