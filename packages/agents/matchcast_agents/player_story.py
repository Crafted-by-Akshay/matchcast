"""Follow my player (CREW-7.7): one fan's standing storyline for one fictional player.

A line about the player names them and carries one running total, recounted from the stored events
up to that moment (never from agent state), so it keeps the casual persona's one-number limit. In a
quiet spell the summary is built from the shared match memory only. Switching the player swaps the
storyline and leaves the match running. The Verifier checks the stated total with ``total_check``.
"""

from dataclasses import dataclass, replace
from typing import Any

from .context import MatchContext
from .messages import Check
from .state import counted

QUIET_MINUTES = 10  # a spell with no remembered beat this long gets one summary line
TRACKED = (
    "goals", "shots", "shots_on_target", "tackles_won", "passes", "fouls", "cards", "red_cards"
)  # fmt: skip
# the play that gets a line: the verb, and the total it names (the label reads "<label>: n")
PLAYS = {
    "goal": ("scores for {club}.", "goals", "Goals so far"),
    "shot": ("shoots for {club}.", "shots", "Shots so far"),
    "tackle": ("wins the ball for {club}.", "tackles_won", "Tackles won so far"),
    "pass": ("links play for {club}.", "passes", "Passes so far"),
    "foul": ("commits a foul for {club}.", "fouls", "Fouls so far"),
    "card": ("is booked for {club}.", "cards", "Cards so far"),
}


@dataclass(frozen=True)
class PlayerStory:
    """The player one fan follows. Its totals are always counted from the start of the match."""

    player_id: str

    def switch(self, player_id: str) -> "PlayerStory":
        return replace(self, player_id=player_id)


def totals(events: Any, player_id: str, upto: int) -> dict[str, int]:
    """The player's counts up to a sequence, recounted from the stored events."""
    out = dict.fromkeys(TRACKED, 0)
    for event in events:
        payload = event["payload"]
        if event["stream_sequence"] > upto or payload.get("player_id") != player_id:
            continue
        if payload["type"] in ("correction", "retraction"):
            continue
        for metric, _team in counted(payload):
            if metric in out:
                out[metric] += 1
    return out


def story_line(ctx: MatchContext, event: dict[str, Any], story: PlayerStory) -> str | None:
    """One line for a verified event that involves the followed player; None for any other."""
    payload = event["payload"]
    if payload.get("player_id") != story.player_id or payload["type"] not in PLAYS:
        return None
    if payload["type"] == "tackle" and payload.get("outcome") != "won":
        return None  # a lost tackle is not a storyline beat
    verb, metric, label = PLAYS[payload["type"]]
    total = totals(ctx.events, story.player_id, event["stream_sequence"])[metric]
    who = ctx.player_name(story.player_id)
    club = ctx.club_name(payload.get("team_id", ""))
    return f"{who} {verb.format(club=club)} {label}: {total}."


def quiet_summary(ctx: MatchContext, story: PlayerStory, now_ms: int) -> str | None:
    """After a quiet spell, one line from shared memory: when the player was last in a verified
    beat. Nothing airs when memory holds no beat for the player or the spell is still short."""
    beats = ctx.extra.get("storylines", {}).get(f"player:{story.player_id}", ())
    if not beats:
        return None
    last = beats[-1]["minute"]
    if now_ms // 60_000 - last < QUIET_MINUTES:
        return None
    return f"{ctx.player_name(story.player_id)} has been quiet since minute {last}."


def total_check(ctx: MatchContext, player_id: str, metric: str, upto: int, stated: int) -> Check:
    """The Verifier's recount of a running total a player line states."""
    recount = totals(ctx.events, player_id, upto)[metric]
    return Check(
        name="player_totals",
        passed=recount == stated,
        detail=f"stated {stated}, recount {recount}",
    )
