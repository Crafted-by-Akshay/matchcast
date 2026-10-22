"""Narrator rules: templated lines per persona, written only from claim values and roster names."""

from typing import Any

from ..context import MatchContext
from ..messages import DraftLine, ProducerTask
from ..personas import BASE, max_chars, slug, split

LABELS = {
    "goals": "Goals",
    "shots": "Shots",
    "shots_on_target": "Shots on target",
    "cards": "Cards",
    "red_cards": "Red cards",
    "tackles_won": "Tackles won",
    "fouls": "Fouls",
    "xg": "xG",
}


def values(claims: list[dict[str, Any]]) -> dict[str, int]:
    return {c["metric"]: int(c["value"]) for c in claims}


class NarratorRules:
    mode = "rules"
    agent_id = "narrator"

    async def write(
        self,
        ctx: MatchContext,
        task: ProducerTask,
        claims: list[dict[str, Any]],
        *,
        attempt: int = 0,
    ) -> list[DraftLine]:
        event = ctx.event(task.event_ids[0])
        assert event is not None
        payload = event["payload"]
        v = values(claims)
        who = ctx.player_name(payload["player_id"]) if "player_id" in payload else ""
        team = payload.get("team_id", ctx.home)
        club = ctx.club_name(team)
        hid, aid = ctx.home, ctx.away
        home, away = ctx.club_name(hid), ctx.club_name(aid)
        ids = tuple(c["claim_id"] for c in claims)
        texts: dict[str, str] = {}
        kind = task.reason
        if kind == "goal":
            n = v[f"goals:{team}"]
            texts = {
                "casual": f"Goal for {club}! {who} scores, goal number {n} for them.",
                "analyst": f"Goal: {who} ({club}). Score: {home} {v[f'goals:{hid}']}, "
                f"{away} {v[f'goals:{aid}']}.",
                "broadcast": f"{club} score through {who}. {home} {v[f'goals:{hid}']}, "
                f"{away} {v[f'goals:{aid}']}.",
            }
        elif kind == "shot_on_target":
            texts = {
                "casual": f"{who} tests the keeper for {club}.",
                "analyst": f"{who} ({club}) shot on target. {club} shots: {v[f'shots:{team}']}, "
                f"on target: {v[f'shots_on_target:{team}']}.",
                "broadcast": f"{who} forces a save for {club}.",
            }
        elif kind == "yellow_card":
            texts = {
                "casual": f"{who} of {club} is shown a yellow card.",
                "analyst": f"{who} ({club}) booked. {club} cards: {v[f'cards:{team}']}.",
                "broadcast": f"Yellow card for {who}. {club} cards: {v[f'cards:{team}']}.",
            }
        elif kind == "red_card":
            texts = {
                "casual": f"Red card! {who} is sent off for {club}.",
                "analyst": f"{who} ({club}) sent off. {club} red cards: {v[f'red_cards:{team}']}.",
                "broadcast": f"{who} is sent off. {club} are down to ten.",
            }
        elif kind == "summary":
            h, a = v[f"shots:{hid}"], v[f"shots:{aid}"]
            lead = home if h > a else away if a > h else None
            casual = f"{lead} have had more of the shots." if lead else "The shot count is level."
            texts = {
                "casual": casual,
                "analyst": f"Shots so far: {home} {h}, {away} {a}.",
                "broadcast": casual,
            }
        elif kind == "period_end":
            texts = {
                p: f"The half ends: {home} {v[f'goals:{hid}']}, {away} {v[f'goals:{aid}']}."
                for p in ("analyst", "broadcast")
            }
            texts["casual"] = f"That is the end of the half for {home} and {away}."
        for persona in task.personas:
            if persona not in BASE:
                text = self._mode_text(ctx, persona, kind, payload, who, club, claims)
                if text:
                    texts[persona] = text
        lines = []
        for persona in task.personas:
            if persona in texts:
                lines.append(
                    DraftLine(
                        line_id=f"line-{task.moment_id}-{slug(persona)}-{attempt}",
                        claim_ids=ids,
                        persona=persona,
                        text=texts[persona],
                        max_chars=max_chars(persona),
                    )
                )
        return lines

    @staticmethod
    def _mode_text(
        ctx: MatchContext,
        persona: str,
        kind: str,
        payload: dict[str, Any],
        who: str,
        club: str,
        claims: list[dict[str, Any]],
    ) -> str | None:
        """my-club, player-focus and one-metric lines; None when the moment is not theirs."""
        mode, arg = split(persona)
        team = payload.get("team_id")
        if mode == "my-club" and team and kind in MY_CLUB:
            mine = ctx.club_name(arg)
            return MY_CLUB[kind][team == arg].format(who=who, club=club, mine=mine)
        if mode == "player-focus" and kind in FOCUS and payload.get("player_id") == arg:
            return FOCUS[kind].format(who=who, club=club)
        if mode == "one-metric":
            matched = [c for c in claims if c["metric"].split(":", 1)[0] == arg]
            if not matched:
                return None
            parts = [
                f"{ctx.club_name(c['metric'].split(':', 1)[1])} {c['value']:.2f}"
                if c["units"] == "ratio"
                else f"{ctx.club_name(c['metric'].split(':', 1)[1])} {int(c['value'])}"
                for c in matched
            ]
            return f"{LABELS.get(arg, arg)}: {', '.join(parts)}."
        return None


# (against, for) the chosen club; {club} is the event team, {mine} the chosen club
MY_CLUB = {
    "goal": (
        "{who} scores for {club}, a setback for {mine}.",
        "{who} scores for {mine}! A big moment for the club.",
    ),
    "shot_on_target": (
        "{who} tests the keeper, and {mine} must stay alert.",
        "{who} forces a save for {mine}, a real chance.",
    ),
    "yellow_card": (
        "{who} of {club} is booked, a small help for {mine}.",
        "{who} is booked for {mine}, so care is needed now.",
    ),
    "red_card": (
        "{who} of {club} is sent off, and {mine} have the numbers.",
        "{who} is sent off, and {mine} are down to ten.",
    ),
}
FOCUS = {
    "goal": "{who} scores for {club}!",
    "shot_on_target": "{who} puts a shot on target for {club}.",
    "yellow_card": "{who} goes into the book for {club}.",
    "red_card": "{who} is sent off for {club}.",
}
