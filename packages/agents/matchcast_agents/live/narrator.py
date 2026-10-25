"""Narrator on the model: one line per persona, from claims and roster names only (AGT-6)."""

import json
import re
from typing import Any

from ..context import MatchContext
from ..memory import already_said
from ..messages import DraftLine, ProducerTask
from ..personas import max_chars, slug
from ..resilience import ModelError
from .client import ModelClient, prompt

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["lines"],
    "properties": {
        "lines": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["persona", "text"],
                "properties": {"persona": {"type": "string"}, "text": {"type": "string"}},
            },
        }
    },
}


_BREAK = re.compile(r"([.!?]+)\s+(?=[A-Z])")
_ABBREVIATION = re.compile(r"\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|vs)\.$")


def sentences(text: str) -> list[str]:
    """Split after . ! ? before a capital; not after an abbreviation (Mr. St.) or an ellipsis."""
    parts, start = [], 0
    for m in _BREAK.finditer(text):
        head = text[start : m.end(1)]
        if m.group(1) == "..." or _ABBREVIATION.search(head):
            continue
        parts.append(head)
        start = m.end()
    parts.append(text[start:])
    return parts


_DIGITS = re.compile(r"\d+(?:\.\d+)?")


def fit(text: str, limit: int) -> str:
    """A line over its limit loses its trailing sentences, whole, until it fits. The cut is
    refused (the line is returned as it is, so the Verifier rejects it) when no cut fits or when
    it would drop a number the line carries: the value a claim backs stays in. The cut text is
    checked like any other, so nothing the Verifier catches is let through."""
    if len(text) <= limit:
        return text
    kept = sentences(text)
    while len(kept) > 1 and len(" ".join(kept)) > limit:
        kept.pop()
    cut = " ".join(kept)
    if len(cut) > limit or _DIGITS.findall(cut) != _DIGITS.findall(text):
        return text
    return cut


class LiveNarrator:
    mode = "live"
    agent_id = "narrator"

    def __init__(self, client: ModelClient) -> None:
        self._client = client

    async def write(
        self,
        ctx: MatchContext,
        task: ProducerTask,
        claims: list[dict[str, Any]],
        *,
        attempt: int = 0,
        feedback: str = "",
    ) -> list[DraftLine]:
        event = ctx.event(task.event_ids[0]) or {"payload": {}}
        payload = event["payload"]
        facts = {
            "moment": task.reason,
            "play": payload.get("type"),
            "claims": [
                {"metric": c["metric"], "value": c["value"], "units": c["units"]} for c in claims
            ],
            "player": ctx.player_name(payload["player_id"]) if "player_id" in payload else None,
            "clubs": {t: ctx.club_name(t) for t in (ctx.home, ctx.away)},
            "personas": list(task.personas),
            "already_said_about_this_play": already_said(ctx, payload),
        }
        if attempt:
            facts["note"] = (
                "A previous draft failed verification; stay closer to the claims "
                "and use each claim value at most once."
                + (f" Fix this: {feedback}" if feedback else "")
            )
        answer = await self._client.complete(
            prompt("narrator"),
            json.dumps(facts),
            SCHEMA,
            max_tokens=400,
        )
        ids = tuple(c["claim_id"] for c in claims)
        lines = []
        for row in answer.get("lines", []):
            persona, text = row.get("persona"), (row.get("text") or "").strip()
            if persona not in task.personas or not text:
                continue
            lines.append(
                DraftLine(
                    line_id=f"line-{task.moment_id}-{slug(persona)}-{attempt}",
                    claim_ids=ids,
                    persona=persona,
                    text=fit(text, max_chars(persona)),
                    max_chars=max_chars(persona),
                    origin="model",
                )
            )
        if not lines:
            raise ModelError("the Narrator returned no usable line")
        return lines
