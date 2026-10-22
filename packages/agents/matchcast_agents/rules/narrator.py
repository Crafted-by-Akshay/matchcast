"""Narrator rules: templated lines per persona, written only from claim values and roster names."""

from typing import Any

from ..context import MatchContext
from ..messages import DraftLine, ProducerTask

MAX_CHARS = {"casual": 140, "analyst": 240, "broadcast": 180}
MAX_NUMBERS = {"casual": 1, "analyst": 6, "broadcast": 2}


def values(claims: list[dict[str, Any]]) -> dict[str, Any]:
    return {c["metric"]: c["value"] if c["units"] == "ratio" else int(c["value"]) for c in claims}


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
                f"on target: {v[f'shots_on_target:{team}']}, xG: {v[f'xg:{team}']:.2f}.",
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
        lines = []
        for persona in task.personas:
            if persona in texts:
                lines.append(
                    DraftLine(
                        line_id=f"line-{task.moment_id}-{persona}-{attempt}",
                        claim_ids=ids,
                        persona=persona,
                        text=texts[persona],
                        max_chars=MAX_CHARS[persona],
                    )
                )
        return lines
