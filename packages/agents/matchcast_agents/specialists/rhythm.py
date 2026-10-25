"""Rhythm specialist: control vs chaos, pressure swings and game rhythm (CREW-2.3, AB#486).

It reads only the raw events in a trailing five-minute window, so the same events always give the
same readings, and it makes no model call. The engine emits no possession time, so possession is a
team's share of its on-ball actions (passes and carries). Territory is the passes and shots a team
makes from the half it attacks. The sides swap at half time, the usual convention, which the fixture
does not cover. Every finding cites the event ids its counts came from.
"""

from dataclasses import dataclass
from typing import Any

from ..context import MatchContext
from .base import Finding, SpawnRequest, SpecialistReport

WINDOW_MS = 5 * 60_000
STEP_MS = 60_000
SWING_SPAN_MS = 3 * 60_000
CONTROL_AT = 0.2  # on the -1..1 index: a clear majority across the weighted metrics
SWING_FROM = 0.1  # both readings of a swing must be at least this strong
MIN_ON_BALL = 10  # fewer on-ball actions than this in the window: no control is claimed
HALFWAY = 52.5  # the pitch is 105 m long; x runs from 0 to 105
# on-ball and pass tempo carry the control question (the rules' possession and tempo example)
WEIGHTS = {
    "on_ball": 0.3,
    "passes": 0.3,
    "territory": 0.1,
    "pressures": 0.1,
    "shots": 0.1,
    "ball_won": 0.1,
}


@dataclass(frozen=True)
class Reading:
    minute: int  # the whole match minute the trailing window ends in
    end_ms: int
    index: float  # positive: home has control; negative: away
    control: str | None  # the team id in control, or None
    chaos: float  # possession changes, tackles and fouls a minute, both teams together
    counts: dict[str, dict[str, int]]


@dataclass(frozen=True)
class Swing:
    minute: int
    end_ms: int
    from_team: str  # team ids, as the roster names them
    to_team: str
    before: float
    after: float


def _share(mine: int, theirs: int) -> float:
    total = mine + theirs
    return mine / total if total else 0.5


def _percent(part: int, total: int) -> int:
    return round(100 * part / total) if total else 0


def window(events: list[dict[str, Any]], end_ms: int) -> list[dict[str, Any]]:
    """The events in the five minutes up to ``end_ms``: after its start, at or before its end."""
    start = end_ms - WINDOW_MS
    return [e for e in events if start < e["event_time_ms"] <= end_ms]


def _in_attacking_half(team: str, home: str, period: int, pos: dict | None) -> bool:
    if not pos:
        return False
    home_attacks_right = period == 1
    attacks_right = home_attacks_right if team == home else not home_attacks_right
    return pos["x"] > HALFWAY if attacks_right else pos["x"] < HALFWAY


def reading(events: list[dict[str, Any]], home: str, away: str, end_ms: int) -> Reading:
    """The control index for the five minutes that end at ``end_ms``, from raw events only."""
    teams = (home, away)
    counts = {m: {home: 0, away: 0} for m in WEIGHTS}
    chaos = 0
    for e in window(events, end_ms):
        p = e["payload"]
        kind = p["type"]
        if kind == "possession_change":
            chaos += 1
            if p["to_team_id"] in teams:
                counts["ball_won"][p["to_team_id"]] += 1
            continue
        if kind in ("tackle", "foul"):
            chaos += 1
        team = p.get("team_id")
        if team not in teams:
            continue
        if kind in ("pass", "carry"):
            counts["on_ball"][team] += 1
        if kind == "pass":
            counts["passes"][team] += 1
        if kind == "pressure":
            counts["pressures"][team] += 1
        if kind == "shot":
            counts["shots"][team] += 1
        if kind in ("pass", "shot"):
            pos = p.get("start_position") or p.get("position")
            if _in_attacking_half(team, home, e["clock"]["period"], pos):
                counts["territory"][team] += 1

    index = sum(
        weight * (_share(counts[m][home], counts[m][away]) - 0.5) * 2
        for m, weight in WEIGHTS.items()
    )
    on_ball_total = sum(counts["on_ball"].values())
    control = None
    if on_ball_total >= MIN_ON_BALL:
        control = home if index >= CONTROL_AT else away if index <= -CONTROL_AT else None
    return Reading(
        minute=end_ms // 60_000,
        end_ms=end_ms,
        index=round(index, 4),
        control=control,
        chaos=round(chaos / (WINDOW_MS / 60_000), 2),
        counts=counts,
    )


def share_percent(
    events: list[dict[str, Any]], team: str, end_ms: int, home: str, away: str
) -> int:
    """The team's share of the on-ball actions over the five minutes that end at ``end_ms``.

    The Analyst's ``rhythm_share`` claim and its Verifier recount both use this function, so the
    figure a line quotes is the figure the log gives. ``events`` are the events up to the claim.
    """
    on_ball = reading(events, home, away, end_ms).counts["on_ball"]
    return _percent(on_ball[team], sum(on_ball.values()))


def recount_share(
    events: list[dict[str, Any]], metric: str, upto: int, home: str, away: str
) -> int:
    """Recount a ``rhythm_share:<team>-<end_ms>`` claim from the stored events up to ``upto``."""
    name, subject = metric.split(":", 1)
    team, end_ms = subject.rsplit("-", 1)  # the end is digits, so a hyphen in a team id is safe
    assert name == "rhythm_share"
    visible = [e for e in events if e["stream_sequence"] <= upto]
    return share_percent(visible, team, int(end_ms), home, away)


def readings(events: list[dict[str, Any]], home: str, away: str, end_ms: int) -> list[Reading]:
    """One reading per whole minute up to ``end_ms``, so the swing span is always three minutes."""
    return [reading(events, home, away, end) for end in range(STEP_MS, end_ms + 1, STEP_MS)]


def swings(series: list[Reading], home: str, away: str) -> list[Swing]:
    """Sign flips between two whole-minute readings at most three minutes apart, both strong enough.

    A flip that stays flipped matches on every later minute, so a swing towards a team is kept only
    once per span. A reversal back to the other team is a swing of its own.
    """
    span = SWING_SPAN_MS // STEP_MS
    found: list[Swing] = []
    last_to: dict[str, int] = {}
    for i in range(span, len(series)):
        before, after = series[i - span], series[i]
        if before.index * after.index >= 0 or min(abs(before.index), abs(after.index)) < SWING_FROM:
            continue
        to_team = home if after.index > 0 else away
        if after.minute - last_to.get(to_team, -span) < span:
            continue
        last_to[to_team] = after.minute
        found.append(
            Swing(
                minute=after.minute,
                end_ms=after.end_ms,
                from_team=home if before.index > 0 else away,
                to_team=to_team,
                before=before.index,
                after=after.index,
            )
        )
    return found


class RhythmSpecialist:
    name = "rhythm"

    async def run(self, ctx: MatchContext, request: SpawnRequest) -> SpecialistReport:
        home, away = ctx.home, ctx.away
        end_ms = ctx.state.event_time_ms
        # the state's cut: an event a batch wrote after the state was read is not used
        events = [e for e in ctx.events if e["stream_sequence"] <= ctx.state.max_sequence]
        if not window(events, end_ms):
            return SpecialistReport(self.name, request.moment_id, "no_data")

        series = readings(events, home, away, end_ms)
        found = swings(series, home, away)
        ctx.extra["rhythm"] = {
            "index": [(r.minute, r.index) for r in series],
            "swings": [{"minute": s.minute, "from": s.from_team, "to": s.to_team} for s in found],
        }  # "swing" is added below when the why line cites one

        now = reading(events, home, away, end_ms)
        window_ids = tuple(e["event_id"] for e in window(events, end_ms))
        findings: list[Finding] = []
        if now.control is not None:
            team = now.control
            on_ball = now.counts["on_ball"]
            share = _percent(on_ball[team], sum(on_ball.values()))
            findings.append(
                Finding(
                    text=(
                        f"{ctx.club_name(team)} had {share}% of the on-ball actions in the last "
                        f"five minutes, with {now.counts['passes'][team]} passes"
                    ),
                    figures={
                        "possession_pct": share,
                        "passes": now.counts["passes"][team],
                        "on_ball_total": sum(on_ball.values()),
                        "window_minutes": WINDOW_MS // 60_000,
                    },
                    evidence_ids=window_ids,
                )
            )

        why, why_evidence = None, ()
        if found and end_ms - found[-1].end_ms <= WINDOW_MS:
            swing = found[-1]
            # the share covers the window up to the swing (at most five minutes), as cited
            at_swing = reading(events, home, away, swing.end_ms)
            on_ball = at_swing.counts["on_ball"]
            share = _percent(on_ball[swing.to_team], sum(on_ball.values()))
            why = (
                f"The rhythm swung to {ctx.club_name(swing.to_team)} in minute {swing.minute}, "
                f"with {share}% of the on-ball actions in the run-up to that minute"
            )
            why_evidence = tuple(e["event_id"] for e in window(events, swing.end_ms))
            # the Analyst's claim cites this swing: the side it went to, and the window's end
            ctx.extra["rhythm"]["swing"] = {"team": swing.to_team, "end_ms": swing.end_ms}
        return SpecialistReport(
            self.name,
            request.moment_id,
            "ok",
            findings=tuple(findings),
            why=why,
            why_evidence=why_evidence,
        )
