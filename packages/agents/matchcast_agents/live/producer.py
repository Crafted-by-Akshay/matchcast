"""Producer on the model: for a moment the rules would air, pick who speaks and who checks it.

The rules Producer stays in front. It dedupes, applies the 8 s rate rule and the threshold, and
routes every priority 1 moment (goal, red card) without a model call. The model only sees a
candidate the rules would air. It may narrow the personas to the ones the candidate allows, ask
the Stats Desk for a moment that is not priority 1, or skip a play that repeats a storyline it just
aired. A model skip gives back the rate window the candidate used. Any model failure falls back to
the rules decision for that candidate, and the fallback is audited (ADR-0014).
"""

import asyncio
import json
from typing import Any

from ..context import MatchContext
from ..memory import already_said
from ..messages import ProducerTask, Skip
from ..resilience import TIMEOUT_S, CircuitBreaker, ModelError, ModelRateLimited, ModelTimeout
from ..rules import ProducerRules
from ..rules.producer import BOOTH_MOMENTS
from .client import ModelClient, prompt

AIRED_MEMORY = 5  # aired moments the Producer sees, so it can skip a storyline it just covered

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["action", "personas", "call_stats_desk", "why"],
    "properties": {
        "action": {"type": "string", "enum": ["narrate", "skip"]},
        "personas": {"type": "array", "items": {"type": "string"}},
        "call_stats_desk": {"type": "boolean"},
        "why": {"type": "string"},
    },
}


class LiveProducer:
    agent_id = "producer"

    def __init__(
        self,
        client: ModelClient,
        rules: ProducerRules,
        *,
        timeout_s: float = TIMEOUT_S,
        breaker: CircuitBreaker | None = None,
    ) -> None:
        self._client = client
        self._rules = rules
        self._timeout = timeout_s
        self.breaker = breaker or CircuitBreaker()
        self.last_mode = "live"  # the status line: any model call in the last decision set
        self.call_mode = "rules"  # how the latest decision was made, for its audit record
        self._fallbacks: list[str] = []
        self._aired: list[dict[str, Any]] = []

    @property
    def mode(self) -> str:
        return self.call_mode

    def take_fallbacks(self) -> list[str]:
        taken, self._fallbacks = self._fallbacks, []
        return taken

    def snapshot(self) -> dict[str, Any]:
        # the rules keys stay at the top level, so a rules-only build restores this checkpoint too
        return {**self._rules.snapshot(), "aired": list(self._aired)}

    def reset(self) -> None:
        self._rules.reset()
        self._aired = []

    def restore(self, data: dict[str, Any]) -> None:
        self._rules.restore(data)  # reads only its own keys; an older checkpoint has no "aired"
        self._aired = list(data.get("aired", []))

    async def decide(self, ctx: MatchContext, event: dict[str, Any]) -> ProducerTask | Skip:
        self.call_mode = "rules"
        decision = await self._rules.decide(ctx, event)
        booth = isinstance(decision, ProducerTask) and decision.reason in BOOTH_MOMENTS
        if isinstance(decision, ProducerTask) and decision.priority != 1 and not booth:
            decision = await self._ask_model(
                ctx, event, decision
            )  # booth moments are not up for a skip
        if isinstance(decision, ProducerTask):
            self._aired.append(
                {
                    "moment_id": decision.moment_id,
                    "reason": decision.reason,
                    "personas": list(decision.personas),
                }
            )
            del self._aired[:-AIRED_MEMORY]
        return decision

    async def _ask_model(
        self, ctx: MatchContext, event: dict[str, Any], decision: ProducerTask
    ) -> ProducerTask | Skip:
        if not self.breaker.allow():
            return self._fall_back(decision, "circuit_open")
        facts = self._facts(ctx, event, decision)
        try:
            answer = await asyncio.wait_for(
                self._client.complete(
                    prompt("producer"), json.dumps(facts), SCHEMA, max_tokens=300
                ),
                self._timeout,
            )
            if not isinstance(answer, dict):
                raise ModelError("the Producer answer was not an object")
            route = self._route(decision, answer)
        except (TimeoutError, ModelTimeout):
            self.breaker.record_failure()
            return self._fall_back(decision, "timeout")
        except asyncio.CancelledError:
            self.breaker.abandon_probe()
            raise
        except ModelRateLimited:
            self.breaker.record_failure()
            return self._fall_back(decision, "rate_limited")
        except Exception:  # noqa: BLE001  any other model-side failure falls back to the rules
            self.breaker.record_failure()
            return self._fall_back(decision, "model_error")
        self.breaker.record_success()
        self.last_mode = "live"
        self.call_mode = "live"
        if isinstance(route, Skip):
            self._rules.hand_back()  # a play the model skips does not use up the rate window
        return route

    def _route(self, decision: ProducerTask, answer: dict[str, Any]) -> ProducerTask | Skip:
        why = str(answer.get("why") or "").strip()[:200]
        if answer.get("action") == "skip":
            return Skip(moment_id=decision.moment_id, reason="model_skip", why=why)
        raw = answer.get("personas")
        asked = raw if isinstance(raw, list) else []
        allowed = dict.fromkeys(decision.personas)
        chosen = [p for p in dict.fromkeys(asked) if isinstance(p, str) and p in allowed]
        personas = tuple(chosen) or decision.personas  # an empty or invented choice keeps the rules
        return decision.model_copy(
            update={
                "personas": personas,
                "routed_by": "model",
                "why": why,
                "call_stats_desk": answer.get("call_stats_desk") is True,
            }
        )

    def _fall_back(self, decision: ProducerTask, reason: str) -> ProducerTask:
        self._fallbacks.append(reason)
        self.last_mode = "rules"
        self.call_mode = "rules"
        return decision

    def _facts(self, ctx: MatchContext, event: dict[str, Any], decision: ProducerTask) -> dict:
        payload = event["payload"]
        return {
            "candidate": {
                "reason": decision.reason,
                "priority": decision.priority,
                "minute": event["event_time_ms"] // 60_000,
                "play": payload.get("type"),
                "outcome": payload.get("outcome"),
                "player": ctx.player_name(payload["player_id"]) if "player_id" in payload else None,
                "club": ctx.club_name(payload["team_id"]) if "team_id" in payload else None,
            },
            "allowed_personas": list(decision.personas),
            "aired_recently": self._aired,
            "already_said_about_this_play": already_said(ctx, payload),
        }
