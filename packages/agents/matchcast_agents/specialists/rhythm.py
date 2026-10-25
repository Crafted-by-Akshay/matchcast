"""Rhythm specialist: control vs chaos, pressure swings and game rhythm (CREW-2.3, AB#486).

It reads only the raw events in a trailing five-minute window, so the same events always give the
same readings, and it makes no model call. The engine emits no possession time, so possession is a
team's share of its on-ball actions (passes and carries). Territory is the passes and shots a team
makes from the half it attacks. The sides swap at half time, the usual convention, which the fixture
does not cover. Every finding cites the event ids its counts came from.
"""

from dataclasses import dataclass

from ..context import MatchContext
from .base import Finding, SpawnRequest, SpecialistReport

WINDOW_MS = 5 * 60_000
STEP_MS = 60_000
SWING_SPAN_MS = 3 * 60_000
CONTROL_AT = 0.2  # on the -1..1 index: a clear majority across the weighted metrics
SWING_FROM = 0.1  # both readings of a swing must be at least this strong
CHAOS_AT = 2.5  # possession changes, tackles and fouls a minute, both teams together
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
    minute: int  # the match minute the trailing window ends in
    index: float  # positive: home has control; negative: away
    control: str | None
    chaos: float
    counts: dict[str, dict[str, int]]


@dataclass(frozen=True)
class Swing:
    minute: int
    from_team: str
    to_team: str
    before: float
    after: float


def _share(mine: int, theirs: int) -> float:
    total = mine + theirs
    return mine / total if total else 0.5


def _in_attacking_half(team: str, home: str, period: int, pos: dict | None) -> bool:
    if not pos:
        return False
    home_attacks_right = period == 1
    attacks_right = home_attacks_right if team == home else not home_attacks_right
    return pos["x"] > HALFWAY if attacks_right else pos["x"] < HALFWAY


def _window(events, end_ms: int) -> list[dict]:
    """The events in the five minutes that end at ``end_ms``, the moment itself included."""
    start = end_ms - WINDOW_MS
    return [e for e in events if start <= e["event_time_ms"] <= end_ms]


def reading(events, home: str, away: str, end_ms: int) -> Reading:
    """The control index for the five minutes that end at ``end_ms``, from raw events only."""
    teams = (home, away)
    counts = {m: {home: 0, away: 0} for m in WEIGHTS}
    chaos = 0
    for e in _window(events, end_ms):
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
    control = home if index >= CONTROL_AT else away if index <= -CONTROL_AT else None
    return Reading(
        minute=end_ms // 60_000,
        index=round(index, 4),
        control=control,
        chaos=round(chaos / (WINDOW_MS / 60_000), 2),
        counts=counts,
    )


def readings(events, home: str, away: str, end_ms: int) -> list[Reading]:
    """One reading per whole minute up to ``end_ms``, and one at ``end_ms`` itself."""
    ends = list(range(STEP_MS, end_ms + 1, STEP_MS))
    if not ends or ends[-1] != end_ms:
        ends.append(end_ms)
    return [reading(events, home, away, end) for end in ends if end > 0]


def swings(series: list[Reading]) -> list[Swing]:
    """Sign flips between two readings at most three minutes apart, both strong enough to count.

    A flip that stays flipped would match on every later minute, so a swing is kept once per span.
    """
    span = SWING_SPAN_MS // STEP_MS
    found: list[Swing] = []
    for i in range(span, len(series)):
        before, after = series[i - span], series[i]
        if before.index * after.index >= 0 or min(abs(before.index), abs(after.index)) < SWING_FROM:
            continue
        if found and after.minute - found[-1].minute < span:
            continue
        found.append(
            Swing(
                minute=after.minute,
                from_team="home" if before.index > 0 else "away",
                to_team="home" if after.index > 0 else "away",
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
        series = readings(ctx.events, home, away, end_ms)
        if not series or not _window(ctx.events, end_ms):
            return SpecialistReport(self.name, request.moment_id, "no_data")

        found = swings(series)
        ctx.extra["rhythm"] = {
            "index": [(r.minute, r.index) for r in series],
            "swings": [{"minute": s.minute, "from": s.from_team, "to": s.to_team} for s in found],
        }

        latest = series[-1]
        window_ids = tuple(e["event_id"] for e in _window(ctx.events, end_ms))
        findings: list[Finding] = []
        if latest.control is not None:
            team = latest.control
            onball = latest.counts["on_ball"]
            share = round(100 * _share(onball[team], onball[home if team == away else away]))
            findings.append(
                Finding(
                    text=(
                        f"{ctx.club_name(team)} had {share}% of the on-ball actions in the last "
                        f"five minutes, with {latest.counts['passes'][team]} passes"
                    ),
                    figures={
                        "possession_pct": share,
                        "passes": latest.counts["passes"][team],
                        "window_minutes": WINDOW_MS // 60_000,
                    },
                    evidence_ids=window_ids,
                )
            )

        why = None
        recent = [s for s in found if end_ms // 60_000 - s.minute <= WINDOW_MS // 60_000]
        if recent:
            swing = recent[-1]
            team = swing.to_team
            share = round(
                100
                * series[-1].counts["on_ball"][team]
                / max(1, sum(series[-1].counts["on_ball"].values()))
            )
            why = (
                f"{ctx.club_name(team)} took control in minute {swing.minute}, "
                f"with {share}% of the on-ball actions over the last five minutes"
            )
        return SpecialistReport(
            self.name, request.moment_id, "ok", findings=tuple(findings), why=why
        )
