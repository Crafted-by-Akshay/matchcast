"""Ask and talk on the model: an answer from a fact sheet of this match, checked before it is shown.

The model sees only what the stored events say (score, match state, team and player counts, every
goal and card, the last events), recounted with the same code the Verifier uses. An answer that
breaks a check returns None and the reason, and the caller answers from the rules instead, so a
slow, failing or wrong model never reaches a viewer.
"""

import asyncio
import json
import re
from collections.abc import Iterable
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
MATCH_EVENTS = 8  # the last events of the match a player may talk about
KEY_EVENT_TYPES = ("goal", "card")  # every goal and card of the match is known to any player
KEY_EVENTS = ("goal", "card")  # every one of these is in the sheet, however long ago it was
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
# "1-2": a scoreline must be the one the score fact writes, home first
SCORELINE = re.compile(r"\b(\d+)\s*(?:[-–—:]|to|vs\.?)\s*(\d+)\b", re.IGNORECASE)
# words that claim the state of the match: each must be in a cited fact, or it is not shown
STATE_CLAIMS = (
    "full time", "full-time", "half time", "half-time", "in play", "final", "at the end",
    "winning", "losing", "leading", "drawing", "level", "ahead", "behind", "won", "lost", "draw",
    "beat", "win", "wins", "lead", "leads", "trail", "trailing", "ended",
)  # fmt: skip
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


def _score(ctx: MatchContext) -> tuple[int, int]:
    """The score as the stored events give it up to the state's sequence, never the state's copy."""
    return (
        int(recompute(ctx.events, f"goals:{ctx.home}", ctx.state.max_sequence)),
        int(recompute(ctx.events, f"goals:{ctx.away}", ctx.state.max_sequence)),
    )


def _counts(values: dict[str, Any]) -> str:
    return ", ".join(f"{name.replace('_', ' ')} {value}" for name, value in values.items())


def _status(ctx: MatchContext) -> str:
    """The phase the record shows, the minute and who leads; the words a fact must hold."""
    boundaries = [e for e in ctx.events if e["payload"]["type"] == "period_boundary"]
    phase = "in play"  # the last boundary decides: a period that started again is in play
    if boundaries and boundaries[-1]["payload"].get("boundary") == "ended":
        phase = "full time" if boundaries[-1]["clock"]["period"] >= 2 else "half time"
    home, away = _score(ctx)
    if home == away:
        lead = "the teams are level"
    else:
        leader = ctx.club_name(ctx.home if home > away else ctx.away)
        lead = f"{leader} are ahead"
    return f"{phase} at minute {_minute(ctx.state.event_time_ms)}; {lead}"


def fact_sheet(ctx: MatchContext) -> dict[str, Any]:
    """Numbered facts about the match so far; every number in them is recounted from the events."""
    ctx = ctx.as_of()
    upto = ctx.state.max_sequence
    home, away = _score(ctx)
    facts = [
        {
            "id": "score",
            "text": f"score {home}-{away}: {ctx.club_name(ctx.home)} {home}, "
            f"{ctx.club_name(ctx.away)} {away}",
        },
        {"id": "status", "text": _status(ctx)},
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
    recent = {e["event_id"] for e in ctx.events[-RECENT_EVENTS:]}
    for event in ctx.events:
        if event["payload"]["type"] not in KEY_EVENTS and event["event_id"] not in recent:
            continue
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


def _has(text: str, pattern: str) -> bool:
    return re.search(rf"\b{pattern}\b", text, re.IGNORECASE) is not None


def _sentence_at(text: str, position: int) -> str:
    """The sentence around a position: the text between the sentence marks either side of it."""
    start = max(text.rfind(mark, 0, position) for mark in ".;!?") + 1
    ends = [i for i in (text.find(mark, position) for mark in ".;!?") if i >= 0]
    return text[start : min(ends, default=len(text))]


def _ask_problem(
    text: str, cites: list[str], texts: dict[str, str], limit: int, clubs: tuple[str, ...]
) -> str | None:
    """Why an answer may not be shown, or None: it is bound to the facts it cites.

    The reasons are short codes, kept in the audit so a refused answer can be traced.
    """
    if not text or len(text.split()) > limit:
        return "length"
    if not _words_fit(text):
        return "count_in_words"
    cited = [texts[c] for c in cites]
    numbers = {n for t in cited for n in extract_numbers(t)}
    found = extract_numbers(text)
    if any(n not in numbers for n in found):
        return "number"  # every number must come from a cited fact
    names = set().union(*(_capitalised(t) for t in cited))
    if not found and not (_capitalised(text) - COMMON_WORDS) & names:
        return "no_fact"  # without a number, the answer must name something the facts give
    for match in SCORELINE.finditer(text):
        pattern = rf"{match.group(1)}\s*(?:[-–—:]|to|vs\.?)\s*{match.group(2)}"
        if not any(_has(t, pattern) for t in cited):
            return "scoreline"  # "2-1" must be the score as a cited fact writes it
    for club in clubs:  # "Northgate FC 2, Harbour United 1": each club's number is its own score
        for match in re.finditer(rf"{re.escape(club)}\s*[,:]?\s*(\d+)\b", text):
            if not any(_has(t, rf"{re.escape(club)}\s*[,:]?\s*{match.group(1)}") for t in cited):
                return "scoreline"
    clubs = {c: texts[c].split(":", 1)[0] for c in cites if c.startswith("team:")}
    for match in COUNT_PHRASE.finditer(text):
        count, label = match.group(1), _label(match.group(2))
        # a count in a sentence that names one cited club must be that club's count
        sentence = _sentence_at(text, match.start())
        named = [c for c, club in clubs.items() if _has(sentence, re.escape(club))]
        scope = [texts[named[0]]] if len(named) == 1 else cited
        if not any(_has(t.casefold(), rf"{re.escape(label)} {re.escape(count)}") for t in scope):
            return "count"  # "3 shots" must be "shots 3" in the cited fact of its club
    # "tackles won" is a count, not a result: it must not satisfy a claim that a side won
    stated = [t.replace("tackles won", "") for t in cited]
    for phrase in STATE_CLAIMS:
        if _has(text, re.escape(phrase)) and not any(_has(t, re.escape(phrase)) for t in stated):
            return "state"  # "full time", "level", "ahead": the record must say so
    if not _names_fit(text, names):
        return "name"
    return None


def _team_totals(ctx: MatchContext) -> list[str]:
    upto = ctx.state.max_sequence
    totals = []
    for team in (ctx.home, ctx.away):
        values = {m: recompute(ctx.events, f"{m}:{team}", upto) for m in TEAM_METRICS}
        totals.append(f"{ctx.club_name(team)}: {_counts(values)}")
    return totals


def talk_fits(ctx: MatchContext, target: str, reply: str, match_names: Iterable[str] = ()) -> bool:
    """The reply as the Verifier sees it: short, digits only, and names only of the speaker, the
    two clubs and the players in the recent match events the model was given."""
    if not reply or len(reply.split()) > TALK_WORD_LIMIT or not _words_fit(reply):
        return False
    sides = (ctx.player_name(target), ctx.club_name(ctx.home), ctx.club_name(ctx.away))
    names = {w for n in (*sides, *match_names) for w in n.split()}
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

    async def ask(
        self, ctx: MatchContext, question: str, persona: str
    ) -> tuple[AskResult | None, str]:
        """(answer, "") when the model's answer passes its checks, else (None, the reason)."""
        sheet = fact_sheet(ctx)
        texts = {f["id"]: f["text"] for f in sheet["facts"]}
        limit = WORD_LIMIT.get(persona, 80)
        answer = await self._call(
            prompt("ask"),
            {"question": question, "persona": persona, "word_limit": limit, **sheet},
            ASK_SCHEMA,
        )
        if answer is None:
            return None, "model_unavailable"
        if answer.get("answerable") is not True:
            return None, "not_answerable"
        text, cites = answer.get("answer"), answer.get("cites")
        if not isinstance(text, str) or not isinstance(cites, list) or not cites:
            return None, "malformed"
        if not all(isinstance(c, str) and c in texts for c in cites):
            return None, "unknown_citation"  # a citation that is not a fact of this match
        text = text.strip()
        clubs = (ctx.club_name(ctx.home), ctx.club_name(ctx.away))
        reason = _ask_problem(text, list(dict.fromkeys(cites)), texts, max(limit, 40), clubs)
        if reason:
            return None, reason
        citations = [{"type": "fact", "id": c} for c in dict.fromkeys(cites)]
        return AskResult(text, "live", False, citations, mode="live", retrieval="local"), ""

    async def talk(
        self,
        ctx: MatchContext,
        target: str,
        utterance: str,
        position: str | None,
        *,
        sheet: dict[str, list[str]] | None = None,
        passages: list[str] | None = None,
    ) -> tuple[str, dict, str] | None:
        """(reply, facts, order) in the player's voice, or None when no checked reply came back.

        The order is the one he says he heard, from the list his role allows; the role guard in the
        workflow still decides whether it reaches the sim. `sheet` is both squads as
        `name, position` lines and `passages` is knowledge-base background: their names may be said.
        """
        stats = player_stats(ctx, target)
        if stats is None:
            return None
        sheet = sheet or {}
        squad_names = [line.split(",")[0] for lines in sheet.values() for line in lines]
        recent = [
            line
            for e in ctx.events
            if e["payload"].get("player_id") == target and (line := _event_line(ctx, e))
        ][-8:]
        key = [e for e in ctx.events if e["payload"]["type"] in KEY_EVENT_TYPES]
        known = [*ctx.events[-MATCH_EVENTS:], *key]  # the players this reply may name
        match_events = [line for e in ctx.events[-MATCH_EVENTS:] if (line := _event_line(ctx, e))]
        key_events = [line for e in key if (line := _event_line(ctx, e))]
        match_names = [
            ctx.player_name(e["payload"]["player_id"]) for e in known if "player_id" in e["payload"]
        ]
        match_names += squad_names
        home, away = _score(ctx)
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
                "score": f"{ctx.club_name(ctx.home)} {home}, {ctx.club_name(ctx.away)} {away}",
                "minute": _minute(ctx.state.event_time_ms),
                "recent_events": match_events,  # what you saw happen, with the players' names
                "key_events": key_events,  # every goal and card of the match
                "team_totals": _team_totals(ctx),  # the log's counts for each club
            },
            "team_sheet": sheet,  # both squads: who plays where, in words, no shirt numbers
            "knowledge": passages or [],  # club and player background from the knowledge base
            "instruction_from_the_manager": utterance,
        }
        answer = await self._call(prompt("player"), facts, TALK_SCHEMA)
        reply, order = (answer or {}).get("reply"), (answer or {}).get("order", NONE)
        if not isinstance(reply, str) or not talk_fits(ctx, target, reply.strip(), match_names):
            return None
        if order not in ORDER_KEYS | {NONE}:
            return None
        return reply.strip(), stats.as_dict(), order
