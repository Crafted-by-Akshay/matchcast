"""The Assistant in rules mode: route, retrieve or measure, cite, verify (05-assistant-rag.md §5).

Live questions are answered from claims built with the match tools. Knowledge questions are
answered extractively from the top retrieved chunk. Every sentence ends with a citation, and a
sentence whose citation or numbers do not check out is dropped; with nothing left the Assistant
abstains instead of guessing.
"""

import hashlib
import logging
import re
from dataclasses import dataclass, field
from typing import Any

from matchcast_contracts import validate

from .. import broadcast
from ..context import MatchContext
from ..messages import DraftLine
from ..tools import InProcessTools, ToolError
from ..verify.checks import extract_numbers, run_checks
from ..workflow import _stamp
from .azure_search import AzureSearchClient, SearchError
from .retrieval import ENTITY_CORPORA, Bm25Index, Hit, analyse, defines

MAX_QUESTION = 300
WORD_LIMIT = {"casual": 80, "broadcast": 60, "analyst": 200}
OUT_OF_SCOPE = "I can only answer questions about this match and MatchCast."
ABSTAIN = "I can't confirm that from the match data yet."
log = logging.getLogger(__name__)
KB_THRESHOLD = 2.2

# (phrases, metric); the first entry whose phrase is in the question wins, so specific first
LIVE_METRICS: tuple[tuple[tuple[str, ...], str, str], ...] = (
    (("shots on target", "on target"), "shots_on_target", "Shots on target"),
    (("shots", "shot"), "shots", "Shots"),
    (("red card", "sent off", "sending off", "red cards"), "red_cards", "Red cards"),
    (("cards", "card", "booked", "booking", "yellow"), "cards", "Cards"),
    (("fouls", "foul"), "fouls", "Fouls"),
    (("tackles", "tackle"), "tackles_won", "Tackles won"),
    (
        (
            "score",
            "winning",
            "losing",
            "leading",
            "ahead",
            "behind",
            "result",
            "goals",
            "goal",
            "scored",
            "scorer",
            "scorers",
        ),
        "goals",
        "Score",
    ),
    (("passes", "pass completed", "passing"), "passes", "Passes"),
    (("pressures", "pressure", "pressing", "press"), "pressures", "Pressures"),
    (
        ("won the ball back", "won back", "possession won", "regain"),
        "possession_won",
        "Possession won",
    ),
)
SCORER_Q = re.compile(
    r"\b(who scored|who got the goals?|who netted|scorers?|goal ?scorers?)\b", re.I
)
WHAT_GOALS_Q = re.compile(r"\bwhat goals\b.*\bscore[ds]?\b", re.I)  # "what goals did X score"
GOAL_WORD = re.compile(r"\bgoals?\b", re.I)
IMPACT_Q = re.compile(
    r"\b(why|how)\b.*\b(important|matter\w*|decisive|significant|mattered)\b", re.I
)
LIVE_CUE = re.compile(
    r"\b(how many|so far|currently|right now|at the moment|has|have|had|score|winning|losing|"
    r"leading|ahead|behind|who scored|result)\b",
    re.IGNORECASE,
)
FUTURE_CUE = re.compile(
    r"\b(will|going to|tomorrow|tonight|next|predict\w*|forecast)\b", re.IGNORECASE
)
_CUE_WORDS = {"shown", "scored", "show", "been", "there", "played", "won"} | {
    w for w in analyse(LIVE_CUE.pattern.replace("\\b", "").replace("|", " "))
}
CLAUSE = re.compile(r",\s*(?:and\s+)?|\s+and\s+(?=(?:what|how|why|when|which|does|is)\b)", re.I)
DEFINITIONAL = re.compile(
    r"^\s*(what|why|when|which|explain|define|how (?:is|are|does|do|can))\b", re.IGNORECASE
)
STRONG_LIVE = re.compile(
    r"\b(so far|right now|currently|at the moment|how many|now)\b"
    r"|\bwhat(?:'s| is) the score\b|\bcurrent score\b",
    re.IGNORECASE,
)
PLAYER_Q = re.compile(r"\b(who has|who had|which player|most|best|top)\b", re.IGNORECASE)
_SENTENCE = re.compile(r"(?<=[.!?])\s+")
_SCORE_PAIR = re.compile(r"\b\d+\s*(?:[-–—:]|to|vs\.?)\s*\d+\b", re.IGNORECASE)
_CITE = re.compile(r"\[(kb|claim|event):([^\]]+)\]")


@dataclass
class AskResult:
    answer: str
    intent: str
    abstained: bool
    citations: list[dict[str, str]] = field(default_factory=list)
    dropped: int = 0
    mode: str = "rules"
    retrieval: str = "local"  # local | search | search_fallback (the "Search fallback" chip)
    broadcast: dict[str, Any] | None = None  # highlights, focus or plan, for the Broadcast Copilot


@dataclass(frozen=True)
class Route:
    intent: str  # live | knowledge | both | out_of_scope | abstain
    metric: tuple[str, str] | None
    teams: tuple[str, ...]
    kb_query: str


def _metric_in(text: str) -> tuple[str, str] | None:
    lowered = text.casefold()
    return next(
        (
            (m, label)
            for phrases, m, label in LIVE_METRICS
            if any(re.search(rf"\b{re.escape(p)}\b", lowered) for p in phrases)
        ),
        None,
    )


# Requests that are not questions about this match, whatever words they share with the KB:
# actions on tools or data, creative writing, personal details.
DECLINE = re.compile(
    r"\b(drop table|delete from|insert into|truncate|select \*)|;\s*(update|delete|drop)\b"
    r"|\bupdate \w+ set\b"
    r"|\b(call|use|run|execute)\b.{0,24}\b(tool|query workbench|data scientist)\b"
    r"|\b(approve|kill|edit)\b.{0,25}\b(every|all|the)\b.{0,15}\b(lines?|audit)\b"
    r"|\b(poem|poetry|lyrics|joke|essay)\b|\bwrite me\b"
    r"|\b(write|compose)\b.{0,20}\bstory\b|\btell me an? (\w+ )?story\b|\b(short|bedtime) story\b"
    r"|\b(phone number|email address|home address)\b",
    re.IGNORECASE,
)
_CAPITALISED_RUN = re.compile(r"\b[A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*)+")
_QUESTION_WORDS = {
    "is", "are", "was", "has", "have", "did", "does", "who", "what", "how", "where", "when",
    "why", "which", "can", "will", "give", "tell", "explain", "show", "commentate",
}  # fmt: skip


def names_outside_the_match(ctx: MatchContext, question: str, index: Bm25Index) -> bool:
    """A capitalised name (two words or more) that is not a club or player here or in the KB.

    Real people and real events are out of scope: the data is synthetic. The KB club and player
    pages are synthetic too, so asking about them stays in scope."""
    known = ctx.allowed_names | {
        c.title.casefold() for c in index.chunks if c.corpus in ENTITY_CORPORA
    }
    for run in _CAPITALISED_RUN.findall(question):
        words = [w.removesuffix("'s").removesuffix("’s") for w in run.split()]
        while words and words[0].casefold() in _QUESTION_WORDS:
            words.pop(0)
        if len(words) >= 2 and " ".join(words).casefold() not in known:
            return True
    return False


def route(ctx: MatchContext, question: str, index: Bm25Index) -> Route:
    """Rules router (the model-free fallback of the one-call router)."""
    lowered = question.casefold()
    if DECLINE.search(question) or names_outside_the_match(ctx, question, index):
        return Route("out_of_scope", None, (), "")
    teams = tuple(t for t in (ctx.home, ctx.away) if ctx.club_name(t).casefold() in lowered)
    if FUTURE_CUE.search(question):
        return Route("abstain", None, teams, "")  # we never predict
    clauses = [c for c in CLAUSE.split(question) if c and c.strip()]
    metric = _metric_in(question)
    cue = bool(LIVE_CUE.search(question))
    if (SCORER_Q.search(question) or WHAT_GOALS_Q.search(question)) and (
        metric is None or metric[0] == "goals"
    ):
        return Route("goals", ("goals", "Goals"), teams, "")  # each goal, from the stored events
    which = _goal_ordinal(question)
    if IMPACT_Q.search(question) and GOAL_WORD.search(question) and which:
        return Route("goal_impact", ("goals", which), teams, "")  # the score change at one goal

    def hit(query: str) -> bool:
        top = max((h.score for h in index.search(query, k=1)), default=0.0) if query else 0.0
        return top >= KB_THRESHOLD

    asks_now = bool(STRONG_LIVE.search(clauses[0])) or not DEFINITIONAL.match(clauses[0])
    if metric is not None and cue and asks_now:
        if PLAYER_Q.search(question) and metric[0] != "goals":
            return Route("abstain", None, teams, "")  # per-player rankings have no tool
        live_at = next(i for i, c in enumerate(clauses) if _metric_in(c))
        others = " ".join(c for i, c in enumerate(clauses) if i != live_at)
        query = " ".join([*analyse(others), *analyse(metric[1])]) if others.strip() else ""
        if query and hit(query):
            return Route("both", metric, teams, query)
        return Route("live", metric, teams, "")
    query = " ".join(analyse(question))
    if cue and (
        STRONG_LIVE.search(question) or not DEFINITIONAL.match(question)
    ):  # about this match, but no tool covers it
        return Route("abstain", None, teams, query)
    if hit(query):
        return Route("knowledge", None, teams, query)
    return Route("out_of_scope", None, teams, query)


def _strip_markup(text: str) -> str:
    text = re.sub(r"[`*_]", "", text)
    return re.sub(r"\s+", " ", text.lstrip("…")).strip()


def _knowledge_sentences(hits: list[Hit]) -> list[tuple[str, str]]:
    """(sentence, chunk id) for the first two sentences of the best prose chunk."""
    for hit in hits:
        if hit.score < KB_THRESHOLD:
            break
        if hit.chunk.section.casefold() == "worked example" and _SCORE_PAIR.search(hit.chunk.text):
            continue  # an example that states a score is an illustration, never this match's score
        prose = [b for b in hit.chunk.text.split("\n\n") if not b.lstrip().startswith("|")]
        sentences = [s for s in _SENTENCE.split(_strip_markup(" ".join(prose))) if s]
        if sentences:
            return [(s, hit.chunk.id) for s in sentences[:2]]
    return []


def _live_claims(
    ctx: MatchContext, question: str, metric: str, teams: tuple[str, ...]
) -> tuple[list[dict[str, Any]], str]:
    tools = InProcessTools(ctx, ctx.state.max_sequence)
    scope = teams or (ctx.home, ctx.away)
    names = [f"{metric}:{t}" for t in scope]
    call_id, result = tools.get_metrics(names)
    snapshot = ctx.state.snapshot()
    tag = hashlib.sha1(f"{question}|{snapshot['state_revision']}".encode()).hexdigest()[:8]
    claims = []
    for index, name in enumerate(names, start=1):
        claims.append(
            {
                "kind": "claim",
                "schema_version": "1.1.0",
                "stream": ctx.stream,
                "claim_id": f"claim-ask-{tag}-{index}",
                "source": {
                    "type": "interval",
                    "from_event_time_ms": 0,
                    "to_event_time_ms": snapshot["event_time_ms"],
                    "from_stream_sequence": 1,
                    "to_stream_sequence": snapshot["max_evidence_sequence"],
                },
                "metric": name,
                "value": result["values"][name]["value"],
                "units": "count",
                "derivation_version": result["values"][name]["derivation_version"],
                "snapshot": snapshot,
                "max_evidence_sequence": snapshot["max_evidence_sequence"],
                "approval_status": "pending",
            }
        )
    return claims, call_id


def _live_sentence(ctx: MatchContext, label: str, claims: list[dict[str, Any]]) -> str:
    cite = "".join(f"[claim:{c['claim_id']}]" for c in claims)
    parts = []
    for claim in claims:
        team = claim["metric"].split(":", 1)[1]
        parts.append(f"{ctx.club_name(team)} {claim['value']}")
    prefix = "Score" if label == "Score" else f"{label} so far"
    return f"{prefix}: {', '.join(parts)}. {cite}"


def check_citations(
    sentence: str,
    kb: dict[str, str],
    claims: dict[str, dict[str, Any]],
    events: dict[str, list[float]] | None = None,
) -> tuple[bool, str]:
    """Check 6: every sentence cites something real, and its numbers come from what it cites.

    An ``event`` citation names a stored event; its allowed numbers are those of its own line.
    """
    cites = _CITE.findall(sentence)
    if not cites:
        return False, "citation_missing"
    allowed: set[float] = set()
    for kind, ident in cites:
        if kind == "kb":
            if ident not in kb:
                return False, "unknown_source"
            allowed.update(extract_numbers(kb[ident]))
        elif kind == "event":
            if events is None or ident not in events:
                return False, "unknown_source"
            allowed.update(events[ident])
        else:
            if ident not in claims:
                return False, "unknown_source"
            allowed.add(float(claims[ident]["value"]))
    plain = _CITE.sub("", sentence)
    if any(n not in allowed for n in extract_numbers(plain)):
        return False, "number_mismatch"
    return True, "ok"


class Assistant:
    def __init__(self, index: Bm25Index, remote: AzureSearchClient | None = None) -> None:
        self.index = index
        self.remote = remote
        self.search_fallbacks = 0
        self._text = {c.id: c.text for c in index.chunks}

    async def _retrieve(self, query: str) -> tuple[list[Hit], str]:
        """Best chunks for the answer path: only hits BM25 would accept may answer."""
        return await self.search(query, top=5, min_score=KB_THRESHOLD)

    async def search(
        self,
        query: str,
        *,
        top: int = 5,
        corpus: str | None = None,
        min_score: float = 0.0,
    ) -> tuple[list[Hit], str]:
        """Chunks for ``query`` and their source: ``local``, ``search`` or ``search_fallback``.

        With AI Search configured it ranks; the local BM25 score still gates (``min_score``) and
        the entity-page rule still applies, so the index can only reorder what BM25 would accept.
        A failed call, or one with no usable chunk, falls back to BM25 and says so. Entity pages the
        rule drops can leave fewer than ``top`` chunks."""
        corpora = {corpus} if corpus else None
        local = self.index.search(query, k=50, corpora=corpora)
        if self.remote is None:
            return local[:top], "local"
        try:
            ranked = await self.remote.search(query, k=15, corpora=corpora)
        except SearchError as error:
            self.search_fallbacks += 1
            log.warning("AI Search failed (%s); using BM25", error)
            return local[:top], "search_fallback"
        allowed = {h.chunk.id: h for h in local if h.score >= min_score}
        hits = [allowed[i] for i, _score in ranked if i in allowed][:top]
        # the index ranks, except that the definition of the very term asked comes first
        defining = [h for h in hits if defines(h.chunk, set(analyse(query)))]
        if defining:
            hits = [defining[0], *(h for h in hits if h is not defining[0])]
        if not hits and allowed:  # an empty or unloaded index must not silence Ask
            self.search_fallbacks += 1
            log.warning("AI Search returned no usable chunk; using BM25")
            return local[:top], "search_fallback"
        return hits, "search"

    async def ask(
        self, flow: Any, question: str, persona: str = "casual", surface: str = "ask"
    ) -> AskResult:
        """Answer from the match in ``flow``; callers hold the workflow lock.

        ``surface="broadcast"`` answers highlight, focus and plan questions from ranked picks
        (see ``broadcast.py``); any other question takes the normal path."""
        ctx = flow._ctx().as_of()  # one moment: the events a batch wrote after the state wait
        intent = broadcast.intent_for(question) if surface == "broadcast" else None
        if (
            intent
        ):  # the cues are narrow, so a broadcast question never reaches the router's declines
            return _broadcast_answer(ctx, intent)
        plan = route(ctx, question, self.index)
        if plan.intent == "out_of_scope":
            return AskResult(OUT_OF_SCOPE, plan.intent, abstained=True)
        goals = _goal_lines(ctx) if plan.intent in ("goals", "goal_impact") else []
        if plan.intent == "goals" and len(plan.teams) == 1:  # "who scored for Northgate FC?"
            goals = [g for g in goals if g[1] == plan.teams[0]]
        if plan.intent in ("goals", "goal_impact") and not goals:
            plan = Route(
                "live", ("goals", "Score"), plan.teams, ""
            )  # no goal yet: the score says so
        event_numbers = {event_id: extract_numbers(text) for event_id, _team, text in goals}
        retrieval = "local"
        sentences: list[tuple[str, str | None]] = []  # (text with citations, claim id if live)
        claims: list[dict[str, Any]] = []
        if plan.intent == "goals":
            sentences += [(f"{text} [event:{event_id}]", None) for event_id, _team, text in goals]
        elif plan.intent == "goal_impact":
            event_id, _team, text = goals[0] if plan.metric[1] == "first" else goals[-1]
            sentences.append((f"{text} [event:{event_id}]", None))
        if plan.intent in ("live", "both") and plan.metric:
            metric, label = plan.metric
            try:
                claims, call_id = _live_claims(ctx, question, metric, plan.teams)
            except ToolError:
                return AskResult(ABSTAIN, plan.intent, abstained=True)
            for claim in claims:
                validate(claim)
                flow.store.put_claim(
                    flow.sk,
                    claim,
                    {
                        "moment_id": "ask",
                        "agent": flow.agents.analyst.agent_id,
                        "created_at": _stamp(flow._clock()),
                        "tool_call_ids": [call_id],
                        "formula_inputs": {"metric": claim["metric"], "tool": "get_metrics"},
                    },
                )
            sentences.append((_live_sentence(ctx, label, claims), "live"))
        if plan.intent in ("knowledge", "both"):
            hits, retrieval = await self._retrieve(plan.kb_query)
            for text, chunk_id in _knowledge_sentences(hits):
                sentences.append((f"{text} [kb:{chunk_id}]", None))
        kept, dropped = [], 0
        by_claim = {c["claim_id"]: c for c in claims}
        for text, live in sentences:
            ok, _reason = check_citations(text, self._text, by_claim, event_numbers)
            if ok and live:
                draft = DraftLine(
                    line_id="ask", claim_ids=tuple(by_claim), persona="analyst",
                    text=_CITE.sub("", text).strip(), max_chars=400,
                )  # fmt: skip
                checks = run_checks(ctx, draft, claims)
                ok = all(c.passed for c in checks)
            if ok:
                kept.append(text)
            else:
                dropped += 1
        if not kept:
            return AskResult(
                ABSTAIN, plan.intent, abstained=True, dropped=dropped, retrieval=retrieval
            )
        # a goal list keeps every scorer: cutting it to the word limit would drop names silently
        if plan.intent == "goals":
            answer = " ".join(kept)
        else:
            answer = _fit(kept, WORD_LIMIT.get(persona, 80))
        citations = [
            {"type": kind, "id": ident} for kind, ident in dict.fromkeys(_CITE.findall(answer))
        ]
        return AskResult(answer, plan.intent, False, citations, dropped, retrieval=retrieval)


def _broadcast_answer(ctx: MatchContext, intent: str) -> AskResult:
    """The Broadcast Copilot's answer: the picks as text, with each pick cited to its event."""
    if intent == "highlights":
        picks = broadcast.highlights(ctx)
        answer = " ".join(p["reason"] for p in picks) or "No moment worth airing yet."
        citations = [{"type": "event", "id": p["event_id"]} for p in picks]
        payload: dict[str, Any] = {"highlights": picks}
    elif intent == "focus":
        pick = broadcast.focus(ctx)
        answer = pick["reason"]
        citations = [{"type": "event", "id": pick["event_id"]}] if "event_id" in pick else []
        payload = {"focus": pick}
    else:
        steps, event_ids = broadcast.plan(ctx)
        answer = " ".join(steps)
        citations = [{"type": "event", "id": event_id} for event_id in event_ids]
        payload = {"plan": steps}
    return AskResult(answer, intent, False, citations, broadcast=payload)


def _goal_ordinal(question: str) -> str | None:
    """ "first" or "last" when the question names one goal; None when it names none."""
    if re.search(r"\b(first|opening)\b", question, re.IGNORECASE):
        return "first"
    if re.search(r"\b(last|final|late)\b", question, re.IGNORECASE):
        return "last"
    return None


def _goal_lines(ctx: MatchContext) -> list[tuple[str, str, str]]:
    """(event id, team id, line) for each goal so far: who scored, when, and the score it left."""
    lines: list[tuple[str, str, str]] = []
    score = {ctx.home: 0, ctx.away: 0}
    for event in ctx.events:
        payload = event["payload"]
        if payload["type"] != "goal":
            continue
        before = dict(score)
        team = payload["team_id"]
        score[team] = score.get(team, 0) + 1
        club = ctx.club_name(team)
        verb = "scored an own goal for" if payload.get("own_goal") else "scored for"
        scorer = payload.get("player_id")
        who = f"{ctx.player_name(scorer)} {verb} {club}" if scorer else f"a goal for {club}"
        minute = int(event["event_time_ms"] // 60_000)
        text = (
            f"{who} at minute {minute}; the score went from "
            f"{before[ctx.home]}-{before[ctx.away]} to {score[ctx.home]}-{score[ctx.away]}"
        )
        lines.append((event["event_id"], team, text))
    return lines


def _fit(sentences: list[str], limit: int) -> str:
    """Whole sentences only, up to the persona's word limit (always at least one)."""
    out: list[str] = []
    for sentence in sentences:
        words = sum(len(_CITE.sub("", s).split()) for s in [*out, sentence])
        if out and words > limit:
            break
        out.append(sentence)
    return " ".join(out)
