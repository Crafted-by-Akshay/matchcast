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
    summarised_ms: int | None = None  # the last involvement a quiet-spell summary already covers

    def switch(self, player_id: str) -> "PlayerStory":
        if player_id == self.player_id:
            return self  # re-selecting the same player keeps this spell's summary guard
        return replace(self, player_id=player_id, summarised_ms=None)

    def summarised(self, ms: int) -> "PlayerStory":
        return replace(self, summarised_ms=ms)


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


def _storyline_play(event: dict[str, Any], player_id: str) -> bool:
    """A play that gets a line for this player: goal, shot, won tackle, foul or card."""
    payload = event["payload"]
    if payload.get("player_id") != player_id or payload["type"] not in PLAYS:
        return False
    if payload["type"] == "goal" and payload.get("own_goal"):
        return False
    return not (payload["type"] == "tackle" and payload.get("outcome") != "won")


def story_line(ctx: MatchContext, event: dict[str, Any], story: PlayerStory) -> str | None:
    """One line for an event that involves the followed player; None for any other.

    The caller passes only verified events: this module does not check verification itself."""
    if not _storyline_play(event, story.player_id):
        return None
    payload = event["payload"]
    verb, metric, label = PLAYS[payload["type"]]
    if payload["type"] == "card" and payload.get("colour") != "yellow":
        verb, metric, label = SENT_OFF
    total = totals(ctx.events, story.player_id, event["stream_sequence"])[metric]
    who = ctx.player_name(story.player_id)
    club = ctx.club_name(payload.get("team_id", ""))
    return f"{who} {verb.format(club=club)} {label}: {total}."


def _last_involvement_ms(ctx: MatchContext, player_id: str, now_ms: int) -> int | None:
    """The time of the player's last stored event up to now, own goals included."""
    times = [
        e["event_time_ms"]
        for e in ctx.events
        if e["event_time_ms"] <= now_ms
        and e["payload"].get("player_id") == player_id
        and e["payload"]["type"] not in ("correction", "retraction")
    ]
    return max(times) if times else None


_WORDS = ("no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten")


def quiet_summary(
    ctx: MatchContext, story: PlayerStory, now_ms: int
) -> tuple[str, PlayerStory] | None:
    """After a quiet spell, one summary line of the player's involvement so far, once per spell.

    Returns the line and the story with this spell marked as summarised, so the caller keeps the
    returned story. The spell is measured on the stored events. The count is the storyline beats
    shared memory still holds for the player (its window keeps the latest beats, so an old beat
    can drop out of it). The count is written in words, so the line keeps its one number at most.
    """
    last = _last_involvement_ms(ctx, story.player_id, now_ms)
    if last is None or now_ms - last < QUIET_MINUTES * 60_000:
        return None
    if last == story.summarised_ms:
        return None  # this spell already has its summary
    # only remembered beats that are storyline plays count: a pass or pressure line is no beat
    by_sequence = {e["stream_sequence"]: e for e in ctx.events}
    beats = [
        b
        for b in ctx.extra.get("storylines", {}).get(f"player:{story.player_id}", ())
        if (e := by_sequence.get(b["sequence"])) is not None and _storyline_play(e, story.player_id)
    ]
    if not beats:
        return None  # no storyline beat in memory: no involvement to summarise
    count = _WORDS[len(beats)] if len(beats) < len(_WORDS) else "many"
    moments = "moment" if len(beats) == 1 else "moments"
    minute = last // 60_000
    text = (
        f"{ctx.player_name(story.player_id)} has been quiet since minute {minute}, "
        f"after {count} {moments} on the storyline."
    )
    return text, story.summarised(last)


def total_check(ctx: MatchContext, player_id: str, metric: str, upto: int, stated: int) -> Check:
    """The Verifier's recount of a running total a player line states."""
    if metric not in TRACKED:
        return Check(name="player_totals", passed=False, detail=f"{metric} is not a player total")
    recount = totals(ctx.events, player_id, upto)[metric]
    return Check(
        name="player_totals",
        passed=recount == stated,
        detail=f"stated {stated}, recount {recount}",
    )
