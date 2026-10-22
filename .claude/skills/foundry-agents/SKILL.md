---
name: foundry-agents
description: Use when working on the four MatchCast agents (Producer, Analyst, Narrator, Verifier), the workflow graph, prompts, rules fallback, or the Foundry model client in packages/agents.
---

# Foundry agents

Design: `docs/architecture/04-agents.md`. Code: `packages/agents/matchcast_agents/`. Package README has the workflow graph.

## Shape
- `workflow.py` `MatchWorkflow(AgentSet)`: Producer picks a moment (or skips), Analyst makes 1 to 3 claims, Narrator drafts one line per persona, Verifier checks, one repair, then publish or abstain. Every step writes a hash-chained audit record. Checkpoint after every event; resume replays from `processed_sequence` (writes are idempotent by id).
- `rules/` is the deterministic set and the fallback for every agent (ADR-0014): `rules_agents()`. `live/` has the Foundry versions (`analyst.py`, `narrator.py`, `verifier.py`) with the same async methods, so `workflow.py` does not change between modes. `rules_agents(seed_bad_claim=True)` corrupts one claim to show the Verifier rejecting it.
- `resilience.py` `ResilientAgent(live, rules)`: 20 s timeout, one retry on 429 honouring `Retry-After`, circuit opens after 3 failures in 60 s and probes after 30 s. A fallback is audited as `fallback_used` with `fallback_reason` (`timeout`, `rate_limited`, `model_error`, `circuit_open`, `tool_error`) and announced as an SSE `status` event. Tool failures are never retried as model failures.
- `derivation_version` must match `x.y.z`, so the fallback is not suffixed `+rules`; it shows in the audit and the stream status.

## Models and auth
- `live/client.py` `FoundryModelClient` calls the `gpt-6-luna` deployment (Global Standard) through the Azure OpenAI client with an Entra bearer-token provider. No API key anywhere. `ScriptedModelClient` replays recorded answers: use it in every test.
- Config comes from env: `MATCHCAST_MODE` (`local`/`cloud`), `FOUNDRY_PROJECT_ENDPOINT`, `FOUNDRY_MODEL_DEPLOYMENT`, `MATCHCAST_AGENT_MODE` (`rules`/`live`). `make smoke-foundry` proves one keyless call (needs the Azure AI User role and quota). CI and tests never call Foundry.
- Prompts live in `packages/agents/prompts/*.md`; the first line is `version: x.y.z`; bump it when the text changes because it lands in `derivation_version`.

## Rules of the design
A model may state a number only if a tool returned it this turn and the claim cites it. The Verifier recounts from stored events, never from agent state. Lines, not claims, carry verdicts and approval (ADR-0013). Add an agent only with an ADR (ADR-0002).

## Tests
`uv run --locked --all-packages pytest packages/agents/tests` (fixture `tests/fixtures/match-short.json`, regenerate with `make_match_short.py`). New logic needs a test for the live path with `ScriptedModelClient` and one for its rules twin.
