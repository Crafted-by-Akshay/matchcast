"""Ask and talk on the model: an answer from a fact sheet of this match, checked before it is shown.

The model sees only what the stored events say (score, team and player counts, the last events),
recounted with the same code the Verifier uses. An answer that breaks a check returns None, and the
caller answers from the rules instead, so a slow, failing or wrong model never reaches a viewer.
"""

import asyncio
import json
import re
from typing import Any

from ..ask.assistant import WORD_LIMIT, AskResult
from ..context import MatchContext
from ..resilience import ModelError, ModelRateLimited, ModelTimeout
from ..roles.orders import NONE, ORDER_KEYS, allowed_orders
from ..roles.player import player_stats
from ..verify import extract_numbers
from ..verify.checks import recompute
from .client import ModelClient, prompt

ANSWER_BUDGET_S = 15.0  # a viewer waits this long at most; the rules answer after it
TALK_WORD_LIMIT = 60
RECENT_EVENTS = 15
TEAM_METRICS = ("goals", "shots", "shots_on_target", "passes", "tackles_won", "fouls", "cards")
PLAYER_METRICS = ("goals", "shots", "shots_on_target", "tackles_won", "fouls", "cards")
# A count is checked only when it is digits bound to a metric, so the model may not write one in
# words or as an ordinal ("twice", "30th"): the Verifier cannot recount those.
NUMBER_WORD = re.compile(
    r"\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|"
    r"fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred|dozen|"
    r"once|twice|thrice)\b",
    re.IGNORECASE,
)
ORDINAL_DIGITS = re.compile(r"\b\d+(?:st|nd|rd|th)\b", re.IGNORECASE)
# "15 shots", "2 goals": the count and the metric it counts
COUNT_PHRASE = re.compile(
    r"(\d+(?:\.\d+)?)\s+"
    r"(shots? on target|shots?|goals?|fouls?|cards?|passes|tackles?(?: won)?|xg)\b",
    re.IGNORECASE,
)
# capitalised words an answer may use without them being a name of the cited facts
COMMON_WORDS = frozenset({
    "I", "I'm", "I'll", "I've", "The", "A", "An", "So", "It", "It's", "This", "That", "We", "They",
    "He", "She", "My", "Our", "Its", "Thanks", "Boss", "Yes", "No", "Well", "Right", "Good", "Not",
    "Here", "Still", "Only", "Just", "Keep", "Okay", "OK", "Sorry", "Fair", "Score", "Minute",
    "Shots", "Goals", "Fouls", "Cards", "Passes", "Tackles", "Ask", "Let", "Look", "Come",
})  # fmt: skip

ASK_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["answer", "cites", "answerable"],
    "properties": {
        "answer": {"type": "string"},
        "cites": {"type": "array", "items": {"type": "string"}},
        "answerable": {"type": "boolean"},
    },
}
TALK_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["reply", "order"],
    "properties": {
        "reply": {"type": "string"},
        "order": {"type": "string", "enum": sorted(ORDER_KEYS | {NONE})},
    },
}
RESILIENCE_ERRORS = (ModelError, ModelTimeout, ModelRateLimited, TimeoutError)


def _minute(ms: int) -> int:
    return int(ms // 60_000)


def _score(ctx: MatchContext) -> str:
    home, away = ctx.state.score.get(ctx.home, 0), ctx.state.score.get(ctx.away, 0)
    return f"{ctx.club_name(ctx.home)} {home}, {ctx.club_name(ctx.away)} {away}"


def _counts(values: dict[str, Any]) -> str:
    return ", ".join(f"{name.replace('_', ' ')} {value}" for name, value in values.items())


def fact_sheet(ctx: MatchContext) -> dict[str, Any]:
    """Numbered facts about the match so far; every number in them is recounted from the events."""
    upto = ctx.state.max_sequence
    facts = [
        {
            "id": "score",
            "text": f"{_score(ctx)} at minute {_minute(ctx.state.event_time_ms)}",
        }
    ]
    for team in (ctx.home, ctx.away):
        values = {m: recompute(ctx.events, f"{m}:{team}", upto) for m in TEAM_METRICS}
        values["xg"] = round(recompute(ctx.events, f"xg:{team}", upto), 2)
        facts.append({"id": f"team:{team}", "text": f"{ctx.club_name(team)}: {_counts(values)}"})
    for player_id, name in ctx.names.items():
        stats = player_stats(ctx, player_id)
        if stats is None:
            continue
        values = {m: getattr(stats, m) for m in PLAYER_METRICS}
        club = ctx.club_name(stats.team_id) if stats.team_id else ""
        facts.append({"id": f"player:{player_id}", "text": f"{name} ({club}): {_counts(values)}"})
    for event in ctx.events[-RECENT_EVENTS:]:
        line = _event_line(ctx, event)
        if line:
            facts.append({"id": f"event:{event['event_id']}", "text": line})
    return {"facts": facts}


def _event_line(ctx: MatchContext, event: dict[str, Any]) -> str | None:
    payload = event["payload"]
    if payload["type"] in ("correction", "retraction", "period_boundary"):
        return None
    who = ctx.player_name(payload["player_id"]) if "player_id" in payload else None
    club = ctx.club_name(payload["team_id"]) if "team_id" in payload else None
    parts = [f"minute {_minute(event['event_time_ms'])}", payload["type"].replace("_", " ")]
    if who:
        parts.append(f"by {who}")
    if club:
        parts.append(f"({club})")
    return " ".join(p for p in parts if p)


def _label(phrase: str) -> str:
    """The fact-text label of a metric as an answer names it, e.g. "shot" or "tackles"."""
    word = phrase.casefold()
    if word.startswith("shot") and "target" in word:
        return "shots on target"
    if word.startswith("shot"):
        return "shots"
    if word.startswith("goal"):
        return "goals"
    if word.startswith("foul"):
        return "fouls"
    if word.startswith("card"):
        return "cards"
    if word.startswith("pass"):
        return "passes"
    if word.startswith("tackle"):
        return "tackles won"
    return "xg"


def _capitalised(text: str) -> set[str]:
    return set(re.findall(r"\b[A-Z][\w'’-]*", text))


def _names_fit(text: str, allowed: set[str]) -> bool:
    """Every capitalised word is a name the allowed text gives, or a common word."""
    return _capitalised(text) <= allowed | COMMON_WORDS


def _words_fit(text: str) -> bool:
    """No count in words or as an ordinal: a count must be digits the Verifier can bind."""
    return not (NUMBER_WORD.search(text) or ORDINAL_DIGITS.search(text))


def _ask_fits(text: str, cites: list[str], texts: dict[str, str], limit: int) -> bool:
    """An answer is bound to the facts it cites: its numbers, its counts and its names."""
    if not text or len(text.split()) > limit or not _words_fit(text):
        return False
    cited = [texts[c] for c in cites]
    numbers = {n for t in cited for n in extract_numbers(t)}
    found = extract_numbers(text)
    if not found or any(n not in numbers for n in found):
        return False  # a number, and at least one, must come from a cited fact
    for match in COUNT_PHRASE.finditer(text):
        count, label = match.group(1), _label(match.group(2))
        pattern = rf"\b{re.escape(label)} {re.escape(count)}\b"
        if not any(re.search(pattern, t.casefold()) for t in cited):
            return False  # "3 shots" must be "shots 3" in a cited fact, not another metric
    return _names_fit(text, set().union(*(_capitalised(t) for t in cited)))


def talk_fits(ctx: MatchContext, target: str, reply: str) -> bool:
    """The reply as the Verifier sees it: short, digits only, names of the speaker's side only."""
    if not reply or len(reply.split()) > TALK_WORD_LIMIT or not _words_fit(reply):
        return False
    names = {
        w
        for n in (ctx.player_name(target), ctx.club_name(ctx.home), ctx.club_name(ctx.away))
        for w in n.split()
    }
    return _names_fit(reply, names)


class LiveAnswers:
    """Ask and talk on the model; each method returns None when no checked answer comes back."""

    def __init__(self, client: ModelClient, *, budget_s: float = ANSWER_BUDGET_S) -> None:
        self._client = client
        self._budget_s = budget_s

    async def _call(
        self, system: str, facts: dict[str, Any], schema: dict[str, Any]
    ) -> dict | None:
        try:
            return await asyncio.wait_for(
                self._client.complete(system, json.dumps(facts), schema, max_tokens=400),
                self._budget_s,
            )
        except RESILIENCE_ERRORS:
            return None

    async def ask(self, ctx: MatchContext, question: str, persona: str) -> AskResult | None:
        sheet = fact_sheet(ctx)
        texts = {f["id"]: f["text"] for f in sheet["facts"]}
        limit = WORD_LIMIT.get(persona, 80)
        answer = await self._call(
            prompt("ask"),
            {"question": question, "persona": persona, "word_limit": limit, **sheet},
            ASK_SCHEMA,
        )
        if not answer or answer.get("answerable") is not True:
            return None
        text, cites = answer.get("answer"), answer.get("cites")
        if not isinstance(text, str) or not isinstance(cites, list) or not cites:
            return None
        if not all(isinstance(c, str) and c in texts for c in cites):
            return None  # a citation that is not a fact of this match
        text = text.strip()
        if not _ask_fits(text, list(dict.fromkeys(cites)), texts, max(limit, 40)):
            return None
        citations = [{"type": "fact", "id": c} for c in dict.fromkeys(cites)]
        return AskResult(text, "live", False, citations, mode="live", retrieval="local")

    async def talk(
        self, ctx: MatchContext, target: str, utterance: str, position: str | None
    ) -> tuple[str, dict, str] | None:
        """(reply, facts, order) in the player's voice, or None when no checked reply came back.

        The order is the one he says he heard, from the list his role allows; the role guard in the
        workflow still decides whether it reaches the sim.
        """
        stats = player_stats(ctx, target)
        if stats is None:
            return None
        recent = [
            line
            for e in ctx.events
            if e["payload"].get("player_id") == target and (line := _event_line(ctx, e))
        ][-8:]
        facts = {
            "you": {
                "name": ctx.player_name(target),
                "club": ctx.club_name(stats.team_id) if stats.team_id else None,
                "position": position,
                "allowed_orders": sorted(allowed_orders(position)),
                "counts": _counts({m: getattr(stats, m) for m in PLAYER_METRICS}),
                "recent_events": recent,
            },
            "match": {
                "score": _score(ctx),
                "minute": _minute(ctx.state.event_time_ms),
            },
            "instruction_from_the_manager": utterance,
        }
        answer = await self._call(prompt("player"), facts, TALK_SCHEMA)
        reply, order = (answer or {}).get("reply"), (answer or {}).get("order", NONE)
        if not isinstance(reply, str) or not talk_fits(ctx, target, reply.strip()):
            return None
        if order not in ORDER_KEYS | {NONE}:
            return None
        return reply.strip(), stats.as_dict(), order
