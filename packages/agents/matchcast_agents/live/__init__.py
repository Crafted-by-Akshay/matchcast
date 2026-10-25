"""Live agents on the Foundry model, each wrapped with its rules twin (ADR-0014)."""

import os

from ..messages import Persona
from ..resilience import ResilientAgent
from ..rules import AnalystRules, NarratorRules, ProducerRules, VerifierRules
from ..tools import ToolCall
from ..workflow import AgentSet
from .analyst import LiveAnalyst
from .answers import LiveAnswers
from .client import FoundryModelClient, ModelClient, ScriptedModelClient, model_priority
from .narrator import LiveNarrator
from .verifier import LiveVerifier

COLOUR_EVERY_S = 45.0  # at most one colour line (one model pass) per match in this much wall time


def colour_every_s() -> float:
    """MATCHCAST_COLOUR_EVERY_S, seconds between colour lines; 0 turns them off."""
    try:
        return max(0.0, float(os.environ.get("MATCHCAST_COLOUR_EVERY_S", COLOUR_EVERY_S)))
    except ValueError:
        return COLOUR_EVERY_S


__all__ = [
    "FoundryModelClient",
    "LiveAnalyst",
    "LiveAnswers",
    "LiveNarrator",
    "LiveVerifier",
    "ModelClient",
    "ScriptedModelClient",
    "live_agents",
]


def live_agents(
    client: ModelClient,
    personas: tuple[Persona, ...] = ("casual", "analyst"),
    *,
    seed_bad_claim: bool = False,
    seed_bad_claim_at_ms: int = 720_000,
    failing_tools: frozenset[str] = frozenset(),
    tool_call: ToolCall | None = None,
) -> AgentSet:
    """The Producer stays rules (its rate rule is code); the other three run on the model."""
    analyst_rules = AnalystRules(
        corrupt_first_claim=seed_bad_claim,
        failing_tools=failing_tools,
        corrupt_after_ms=seed_bad_claim_at_ms,
        tool_call=tool_call,
    )

    def quiet(args: tuple, kwargs: dict) -> bool:
        """(ctx, task, ...): a moment below the model's priority goes straight to the rules."""
        task = args[1]
        return task.priority > model_priority() and task.reason != "colour"

    return AgentSet(
        ProducerRules(personas, colour_every_s=colour_every_s()),
        ResilientAgent(LiveAnalyst(client, analyst_rules), analyst_rules, skip=quiet),
        ResilientAgent(LiveNarrator(client), NarratorRules(), skip=quiet),
        ResilientAgent(LiveVerifier(client), VerifierRules()),
    )
