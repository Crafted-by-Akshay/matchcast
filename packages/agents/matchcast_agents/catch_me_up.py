"""Catch-me-up (CREW-7.3, AB#460): one recap on demand, built from the events up to a minute.

Deterministic and templated, like the half-time explainer. A fan who asks at minute m gets the
score at m and the three most important events up to m, in match order, and nothing after m.
Each sentence lists the metrics it quotes, for the Verifier to recount. feeds.py sets the feed's
280-word limit, about two minutes spoken.

Open storylines are not in the recap yet: the shared memory keeps wording with every number
replaced by #, so it cannot be quoted as a fact. A retracted event is left out. A correction to
an event before the cut holds the recap (None) until corrections are folded, as half-time does.
Own goals count in the score but are not named.
"""

from dataclasses import dataclass
from typing import Any

from .context import MatchContext
from .feeds import FEEDS
from .rules.producer import moment_score
from .state import MatchState, apply

WORD_LIMIT = next(feed.max_words for feed in FEEDS if feed.key == "catch_me_up")
NAMED_LIMIT = 3
CONTROLS = ("correction", "retraction")

Sentence = tuple[str, tuple[str, ...]]  # (text, the metrics it quotes as "metric:team")


@dataclass(frozen=True)
class CatchMeUp:
    text: str
    sentences: tuple[Sentence, ...]
    minute: int
    cut_sequence: int  # the last stream sequence the recap may use
    source_event_ids: tuple[str, ...]  # the goals up to the cut, then the events named
    word_count: int


def _targets(events: list[dict[str, Any]], kind: str) -> set[str]:
    return {e["payload"]["target_event_id"] for e in events if e["payload"]["type"] == kind}


def _named(ctx: MatchContext, event: dict[str, Any]) -> Sentence | None:
    """The sentence for an event the recap names, or None when the recap does not name it."""
    payload = event["payload"]
    kind, team = payload["type"], payload.get("team_id")
    if kind == "goal" and not payload.get("own_goal"):
        who = ctx.player_name(payload["player_id"])
        return f"{who} scored for {ctx.club_name(team)}.", (f"goals:{team}",)
    if kind == "card":
        who, club = ctx.player_name(payload["player_id"]), ctx.club_name(team)
        if payload["colour"] == "yellow":
            return f"{who} was booked for {club}.", (f"cards:{team}",)
        return f"{who} was sent off for {club}.", (f"cards:{team}", f"red_cards:{team}")
    if kind == "shot" and payload["on_target"]:
        who = ctx.player_name(payload["player_id"])
        return f"{who} had a shot on target for {ctx.club_name(team)}.", (
            f"shots_on_target:{team}",
        )
    return None


def _words(rows: list[Sentence]) -> int:
    return sum(len(text.split()) for text, _ in rows)


def build(ctx: MatchContext, minute: int) -> CatchMeUp | None:
    """The recap as of a match minute, or None when it is held or does not fit the limit."""
    ordered = sorted(ctx.events, key=lambda e: e["stream_sequence"])
    retracted = _targets(ordered, "retraction")
    corrected = _targets(ordered, "correction")
    live = [
        e
        for e in ordered
        if e["event_id"] not in retracted
        and e["payload"]["type"] not in CONTROLS
        and e["event_time_ms"] <= minute * 60_000
    ]
    if corrected & {e["event_id"] for e in live}:
        return None  # a corrected event before the cut: nothing folds corrections yet
    state = MatchState()
    for event in live:
        state = apply(state, event)
    home, away = ctx.home, ctx.away
    headline: Sentence = (
        f"After {minute} minutes, {ctx.club_name(home)} {state.count('goals', home)}-"
        f"{state.count('goals', away)} {ctx.club_name(away)}.",
        (f"goals:{home}", f"goals:{away}"),
    )
    named = [e for e in live if _named(ctx, e) is not None]
    # the most important first; for equal importance the more recent one ranks higher
    ranked = sorted(named, key=lambda e: (-moment_score(e["payload"])[0], -e["stream_sequence"]))
    ranked = ranked[:NAMED_LIMIT]
    while True:
        chosen = sorted(ranked, key=lambda e: e["stream_sequence"])
        rows = [headline, *(_named(ctx, e) for e in chosen if _named(ctx, e) is not None)]
        if _words(rows) <= WORD_LIMIT or not ranked:
            break
        ranked = ranked[:-1]  # the lowest-ranked named event goes first
    if _words(rows) > WORD_LIMIT:
        return None  # the headline alone is over the limit
    cited = {e["event_id"] for e in chosen} | {
        e["event_id"] for e in live if e["payload"]["type"] == "goal"
    }
    return CatchMeUp(
        text=" ".join(text for text, _ in rows),
        sentences=tuple(rows),
        minute=minute,
        cut_sequence=max((e["stream_sequence"] for e in live), default=0),
        source_event_ids=tuple(e["event_id"] for e in live if e["event_id"] in cited),
        word_count=_words(rows),
    )
