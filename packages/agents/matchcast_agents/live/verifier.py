"""Verifier on the model: deterministic checks always win; the model judges meaning (AGT-7)."""

import json
from typing import Any

from ..context import MatchContext
from ..messages import Check, DraftLine, Verdict
from ..rules.verifier import VerifierRules
from ..verify.checks import REASON, run_checks
from .client import ModelClient, prompt

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["judgement", "detail"],
    "properties": {
        "judgement": {"type": "string", "enum": ["supported", "unclear", "unsupported"]},
        "detail": {"type": "string"},
    },
}


class LiveVerifier:
    mode = "live"
    agent_id = "verifier"

    def __init__(self, client: ModelClient) -> None:
        self._client = client
        self._rules = VerifierRules()

    async def check(
        self, ctx: MatchContext, line: DraftLine, claims: list[dict[str, Any]]
    ) -> Verdict:
        checks = run_checks(ctx, line, claims)
        failed = next((c for c in checks if not c.passed), None)
        if failed:  # a deterministic failure is never overridden
            return Verdict(
                line_id=line.line_id,
                verdict="rejected",
                reason_code=REASON[failed.name],
                checks=tuple(checks),
            )
        if line.origin == "template":  # a template filled from claim values has no meaning to judge
            return await self._rules.check(ctx, line, claims)
        request = {
            "line": line.text,
            "claims": [{"metric": c["metric"], "value": c["value"]} for c in claims],
        }
        answer = await self._client.complete(prompt("verifier"), json.dumps(request), SCHEMA)
        judgement = answer["judgement"]
        checks.append(
            Check(
                name="meaning",
                passed=judgement == "supported",
                detail=f"{judgement}: {str(answer.get('detail', ''))[:160]}",
            )
        )
        if judgement == "unsupported":
            return Verdict(
                line_id=line.line_id,
                verdict="rejected",
                reason_code="unsupported_statement",
                checks=tuple(checks),
            )
        verdict = "verified" if judgement == "supported" else "review"
        return Verdict(line_id=line.line_id, verdict=verdict, checks=tuple(checks))
