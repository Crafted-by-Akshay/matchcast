"""Narrator rules: templated lines per persona, written only from claim values and roster names."""

from typing import Any

from ..context import MatchContext
from ..messages import DraftLine, ProducerTask

MAX_CHARS = {"casual": 140, "analyst": 240, "broadcast": 180}
MAX_NUMBERS = {"casual": 1, "analyst": 6, "broadcast": 2}


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
        team = payload.get("team_id", "home")
        club = ctx.club_name(team)
        home, away = ctx.club_name("home"), ctx.club_name("away")
        ids = tuple(c["claim_id"] for c in claims)
        texts: dict[str, str] = {}
        kind = task.reason
        if kind == "goal":
            n = v[f"goals:{team}"]
            texts = {
                "casual": f"Goal for {club}! {who} scores, goal number {n} for them.",
                "analyst": f"Goal: {who} ({club}). Score: {home} {v['goals:home']}, "
                f"{away} {v['goals:away']}.",
                "broadcast": f"{club} score through {who}. {home} {v['goals:home']}, "
                f"{away} {v['goals:away']}.",
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
            h, a = v["shots:home"], v["shots:away"]
            lead = home if h > a else away if a > h else None
            casual = f"{lead} have had more of the shots." if lead else "The shot count is level."
            texts = {
                "casual": casual,
                "analyst": f"Shots so far: {home} {h}, {away} {a}.",
                "broadcast": casual,
            }
        elif kind == "period_end":
            texts = {
                p: f"The half ends: {home} {v['goals:home']}, {away} {v['goals:away']}."
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
