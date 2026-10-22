"""Verifier rules: checks 1 to 5 decide; check 8 (meaning) is skipped in rules mode."""

from typing import Any

from ..context import MatchContext
from ..messages import DraftLine, Verdict
from ..verify.checks import REASON, run_checks


class VerifierRules:
    mode = "rules"
    agent_id = "verifier"

    async def check(
        self, ctx: MatchContext, line: DraftLine, claims: list[dict[str, Any]]
    ) -> Verdict:
        checks = run_checks(ctx, line, claims)
        failed = next((c for c in checks if not c.passed), None)
        if failed:
            return Verdict(
                line_id=line.line_id,
                verdict="rejected",
                reason_code=REASON[failed.name],
                checks=tuple(checks),
            )
        # rules mode: only template lines are verified without the model meaning check
        verdict = "verified" if line.origin == "template" else "review"
        return Verdict(line_id=line.line_id, verdict=verdict, checks=tuple(checks))
