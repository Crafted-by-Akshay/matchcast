"""The Assistant in rules mode: route, retrieve or measure, cite, verify (05-assistant-rag.md §5).

Live questions are answered from claims built with the match tools. Knowledge questions are
answered extractively from the top retrieved chunk. Every sentence ends with a citation, and a
sentence whose citation or numbers do not check out is dropped; with nothing left the Assistant
abstains instead of guessing.
"""

import hashlib
import re
from dataclasses import dataclass, field
from typing import Any

from matchcast_contracts import validate

from ..context import MatchContext
from ..messages import DraftLine
from ..tools import InProcessTools, ToolError
from ..verify.checks import extract_numbers, run_checks
from .retrieval import Bm25Index, analyse

MAX_QUESTION = 300
WORD_LIMIT = {"casual": 80, "broadcast": 60, "analyst": 200}
OUT_OF_SCOPE = "I can only answer questions about this match and MatchCast."
ABSTAIN = "I can't confirm that from the match data yet."
KB_THRESHOLD = 2.2

# (phrases, metric); the first entry whose phrase is in the question wins, so specific first
LIVE_METRICS: tuple[tuple[tuple[str, ...], str, str], ...] = (
    (("shots on target", "on target"), "shots_on_target", "Shots on target"),
    (("shots", "shot"), "shots", "Shots"),
    (("red card", "sent off", "sending off", "red cards"), "red_cards", "Red cards"),
    (("cards", "card", "booked", "booking", "yellow"), "cards", "Cards"),
    (("fouls", "foul"), "fouls", "Fouls"),
    (("tackles", "tackle", "won"), "tackles_won", "Tackles won"),
    (
        ("score", "winning", "losing", "leading", "ahead", "behind", "result", "goals", "goal"),
        "goals",
        "Score",
    ),
)
LIVE_CUE = re.compile(
    r"\b(how many|so far|currently|right now|at the moment|has|have|had|score|winning|losing|"
    r"leading|ahead|behind|who scored|result)\b",
    re.IGNORECASE,
)
FUTURE_CUE = re.compile(
    r"\b(will|going to|tomorrow|tonight|next|predict\w*|forecast)\b", re.IGNORECASE
)
_CUE_WORDS = {"shown", "scored", "show", "been", "there", "played"} | {
    w for w in analyse(LIVE_CUE.pattern.replace("\\b", "").replace("|", " "))
}
_SENTENCE = re.compile(r"(?<=[.!?])\s+")
_CITE = re.compile(r"\[(kb|claim):([^\]]+)\]")


@dataclass
class AskResult:
    answer: str
    intent: str
    abstained: bool
    citations: list[dict[str, str]] = field(default_factory=list)
    dropped: int = 0
    mode: str = "rules"


@dataclass(frozen=True)
class Route:
    intent: str  # live | knowledge | both | out_of_scope | abstain
    metric: tuple[str, str] | None
    teams: tuple[str, ...]
    kb_query: str


def route(ctx: MatchContext, question: str, index: Bm25Index) -> Route:
    """Rules router (the model-free fallback of the one-call router)."""
    lowered = question.casefold()
    metric = next(
        ((m, label) for phrases, m, label in LIVE_METRICS if any(p in lowered for p in phrases)),
        None,
    )
    teams = tuple(t for t in (ctx.home, ctx.away) if ctx.club_name(t).casefold() in lowered)
    live_words = {w for phrases, _, _ in LIVE_METRICS for p in phrases for w in analyse(p)}
    club_words = {w for t in (ctx.home, ctx.away) for w in analyse(ctx.club_name(t))}
    cue = bool(LIVE_CUE.search(question))
    live = metric is not None and cue
    kb_query = " ".join(
        w
        for w in analyse(question)
        if not (live and (w in live_words or w in club_words or w in _CUE_WORDS))
    )
    top = max((h.score for h in index.search(kb_query, k=1)), default=0.0) if kb_query else 0.0
    kb_hit = top >= KB_THRESHOLD
    if FUTURE_CUE.search(question):
        return Route("abstain", None, teams, kb_query)  # we never predict
    if live and kb_hit:
        return Route("both", metric, teams, kb_query)
    if live:
        return Route("live", metric, teams, kb_query)
    if kb_hit:
        return Route("knowledge", None, teams, kb_query)
    if cue:  # asks about the match but we have no tool for it
        return Route("abstain", None, teams, kb_query)
    return Route("out_of_scope", None, teams, kb_query)


def _strip_markup(text: str) -> str:
    text = re.sub(r"[`*_]", "", text)
    return re.sub(r"\s+", " ", text.lstrip("…")).strip()


def _knowledge_sentences(index: Bm25Index, query: str) -> list[tuple[str, str]]:
    """(sentence, chunk id) for the first two sentences of the best prose chunk."""
    for hit in index.search(query, k=5):
        if hit.score < KB_THRESHOLD:
            break
        prose = [b for b in hit.chunk.text.split("\n\n") if not b.lstrip().startswith("|")]
        sentences = [s for s in _SENTENCE.split(_strip_markup(" ".join(prose))) if s]
        if sentences:
            return [(s, hit.chunk.id) for s in sentences[:2]]
    return []


def _live_claims(
    ctx: MatchContext, question: str, metric: str, teams: tuple[str, ...]
) -> tuple[list[dict[str, Any]], dict[str, str]]:
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
    return claims, {"tool_call_id": call_id}


def _live_sentence(ctx: MatchContext, label: str, claims: list[dict[str, Any]]) -> str:
    cite = "".join(f"[claim:{c['claim_id']}]" for c in claims)
    parts = []
    for claim in claims:
        team = claim["metric"].split(":", 1)[1]
        parts.append(f"{ctx.club_name(team)} {claim['value']}")
    prefix = "Score" if label == "Score" else f"{label} so far"
    return f"{prefix}: {', '.join(parts)}. {cite}"


def check_citations(
    sentence: str, kb: dict[str, str], claims: dict[str, dict[str, Any]]
) -> tuple[bool, str]:
    """Check 6: every sentence cites something real, and its numbers come from what it cites."""
    cites = _CITE.findall(sentence)
    if not cites:
        return False, "citation_missing"
    allowed: set[float] = set()
    for kind, ident in cites:
        if kind == "kb":
            if ident not in kb:
                return False, "unknown_source"
            allowed.update(extract_numbers(kb[ident]))
        else:
            if ident not in claims:
                return False, "unknown_source"
            allowed.add(float(claims[ident]["value"]))
    plain = _CITE.sub("", sentence)
    if any(n not in allowed for n in extract_numbers(plain)):
        return False, "number_mismatch"
    return True, "ok"


class Assistant:
    def __init__(self, index: Bm25Index) -> None:
        self.index = index
        self._text = {c.id: c.text for c in index.chunks}

    async def ask(self, flow: Any, question: str, persona: str = "casual") -> AskResult:
        """Answer from the match in ``flow``; callers hold the workflow lock."""
        ctx = flow._ctx()
        plan = route(ctx, question, self.index)
        if plan.intent == "out_of_scope":
            return AskResult(OUT_OF_SCOPE, plan.intent, abstained=True)
        sentences: list[tuple[str, str | None]] = []  # (text with citations, claim id if live)
        claims: list[dict[str, Any]] = []
        if plan.intent in ("live", "both") and plan.metric:
            metric, label = plan.metric
            try:
                claims, _ = _live_claims(ctx, question, metric, plan.teams)
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
                        "created_at": "",
                        "tool_call_ids": ["tc-1"],
                        "formula_inputs": {"metric": claim["metric"], "tool": "get_metrics"},
                    },
                )
            sentences.append((_live_sentence(ctx, label, claims), "live"))
        if plan.intent in ("knowledge", "both"):
            for text, chunk_id in _knowledge_sentences(self.index, plan.kb_query):
                sentences.append((f"{text} [kb:{chunk_id}]", None))
        kept, dropped = [], 0
        by_claim = {c["claim_id"]: c for c in claims}
        for text, live in sentences:
            ok, _reason = check_citations(text, self._text, by_claim)
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
            return AskResult(ABSTAIN, plan.intent, abstained=True, dropped=dropped)
        answer = _fit(kept, WORD_LIMIT.get(persona, 80))
        citations = [
            {"type": kind, "id": ident} for kind, ident in dict.fromkeys(_CITE.findall(answer))
        ]
        return AskResult(answer, plan.intent, False, citations, dropped)


def _fit(sentences: list[str], limit: int) -> str:
    """Whole sentences only, up to the persona's word limit (always at least one)."""
    out: list[str] = []
    for sentence in sentences:
        words = sum(len(_CITE.sub("", s).split()) for s in [*out, sentence])
        if out and words > limit:
            break
        out.append(sentence)
    return " ".join(out)
