"""Live agents on the Foundry model, each wrapped with its rules twin (ADR-0014)."""

from ..messages import Persona
from ..resilience import ResilientAgent
from ..rules import AnalystRules, NarratorRules, ProducerRules, VerifierRules
from ..workflow import AgentSet
from .analyst import LiveAnalyst
from .client import FoundryModelClient, ModelClient, ScriptedModelClient
from .narrator import LiveNarrator
from .verifier import LiveVerifier

__all__ = [
    "FoundryModelClient",
    "LiveAnalyst",
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
) -> AgentSet:
    """The Producer stays rules (its rate rule is code); the other three run on the model."""
    analyst_rules = AnalystRules(
        corrupt_first_claim=seed_bad_claim,
        failing_tools=failing_tools,
        corrupt_after_ms=seed_bad_claim_at_ms,
    )
    return AgentSet(
        ProducerRules(personas),
        ResilientAgent(LiveAnalyst(client, analyst_rules), analyst_rules),
        ResilientAgent(LiveNarrator(client), NarratorRules()),
        ResilientAgent(LiveVerifier(client), VerifierRules()),
    )
