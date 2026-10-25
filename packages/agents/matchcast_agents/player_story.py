"""Follow my player (CREW-7.7): one fan's standing storyline for one fictional player.

A line about the player names them and carries one running total, recounted from the stored events
up to that moment (never from agent state), so it keeps the casual persona's one-number limit. In a
quiet spell one summary line airs, once per spell, and its words come from shared memory. Switching
the player swaps the storyline and leaves the match running. ``total_check`` is the Verifier's
recount of a stated total; wiring it into the live Verifier is Planned.
"""

from dataclasses import dataclass, replace
from typing import Any

from .context import MatchContext
from .messages import Check
from .state import counted

QUIET_MINUTES = 10  # a spell with no involvement this long gets one summary line
TRACKED = (
    "goals", "shots", "shots_on_target", "tackles_won", "fouls", "cards", "red_cards"
)  # fmt: skip
# the plays that get a line: the verb, and the total it names (the label reads "<label>: n").
# Passes are not storyline beats in this version: one line per pass would break the rate rule.
PLAYS = {
    "goal": ("scores for {club}.", "goals", "Goals so far"),
    "shot": ("shoots for {club}.", "shots", "Shots so far"),
    "tackle": ("wins the ball for {club}.", "tackles_won", "Tackles won so far"),
    "foul": ("gives away a foul for {club}.", "fouls", "Fouls so far"),
    "card": ("is booked for {club}.", "cards", "Cards so far"),
}
SENT_OFF = ("is sent off for {club}.", "red_cards", "Red cards so far")


@dataclass(frozen=True)
class PlayerStory:
    """The player one fan follows. Its totals are always counted from the start of the match."""

    player_id: str
    summarised_minute: int | None = None  # the last involvement a quiet-spell summary covered

    def switch(self, player_id: str) -> "PlayerStory":
        return replace(self, player_id=player_id, summarised_minute=None)

    def summarised(self, minute: int) -> "PlayerStory":
        return replace(self, summarised_minute=minute)


def _counts_for(payload: dict[str, Any]) -> list[tuple[str, str]]:
    """The increments one payload causes for a player. An own goal is the defender's, not a goal
    for the beneficiary, so it counts for nobody here."""
    if payload["type"] == "goal" and payload.get("own_goal"):
        return []
    return counted(payload)


def totals(events: Any, player_id: str, upto: int) -> dict[str, int]:
    """The player's counts up to a sequence, recounted from the stored events."""
    out = dict.fromkeys(TRACKED, 0)
    for event in events:
        payload = event["payload"]
        if event["stream_sequence"] > upto or payload.get("player_id") != player_id:
            continue
        if payload["type"] in ("correction", "retraction"):
            continue
        for metric, _team in _counts_for(payload):
            if metric in out:
                out[metric] += 1
    return out


def story_line(ctx: MatchContext, event: dict[str, Any], story: PlayerStory) -> str | None:
    """One line for a verified event that involves the followed player; None for any other."""
    payload = event["payload"]
    if payload.get("player_id") != story.player_id or payload["type"] not in PLAYS:
        return None
    if payload["type"] == "goal" and payload.get("own_goal"):
        return None
    if payload["type"] == "tackle" and payload.get("outcome") != "won":
        return None  # a lost tackle is not a storyline beat
    verb, metric, label = PLAYS[payload["type"]]
    if payload["type"] == "card" and payload.get("colour") != "yellow":
        verb, metric, label = SENT_OFF
    total = totals(ctx.events, story.player_id, event["stream_sequence"])[metric]
    who = ctx.player_name(story.player_id)
    club = ctx.club_name(payload.get("team_id", ""))
    return f"{who} {verb.format(club=club)} {label}: {total}."


def _last_involvement_minute(ctx: MatchContext, player_id: str, now_ms: int) -> int | None:
    """The match minute of the player's last stored event up to now, own goals included."""
    minutes = [
        e["event_time_ms"] // 60_000
        for e in ctx.events
        if e["event_time_ms"] <= now_ms and e["payload"].get("player_id") == player_id
    ]
    return max(minutes) if minutes else None


_WORDS = ("no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten")


def quiet_summary(ctx: MatchContext, story: PlayerStory, now_ms: int) -> str | None:
    """After a quiet spell, one summary line of the player's involvement so far, once per spell.
    The spell is measured on the stored events. The involvement is what shared memory remembers
    (verified beats for the player), counted in words so the line keeps one number at most.
    Call ``story.summarised(minute)`` after it airs."""
    last = _last_involvement_minute(ctx, story.player_id, now_ms)
    if last is None or now_ms // 60_000 - last < QUIET_MINUTES:
        return None
    if last == story.summarised_minute:
        return None  # this spell already has its summary
    beats = ctx.extra.get("storylines", {}).get(f"player:{story.player_id}", ())
    if not beats:
        return None  # nothing remembered: no involvement to summarise
    count = _WORDS[len(beats)] if len(beats) < len(_WORDS) else "many"
    moments = "moment" if len(beats) == 1 else "moments"
    return (
        f"{ctx.player_name(story.player_id)} has been quiet since minute {last}, "
        f"after {count} {moments} on the storyline."
    )


def total_check(ctx: MatchContext, player_id: str, metric: str, upto: int, stated: int) -> Check:
    """The Verifier's recount of a running total a player line states."""
    recount = totals(ctx.events, player_id, upto)[metric]
    return Check(
        name="player_totals",
        passed=recount == stated,
        detail=f"stated {stated}, recount {recount}",
    )
