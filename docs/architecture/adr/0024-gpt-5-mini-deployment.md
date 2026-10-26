# ADR-0024: Agents run on the gpt-5-mini Foundry deployment

- **Status:** Accepted
- **Date:** 2026-10-26
- **Decided by:** Build lane, recording the deployment as it runs (no separate sign-off recorded here)
- **Supersedes:** the model part of ADR-0002 (the four-agent design in ADR-0002 stands)

## Context

ADR-0002 named the model `gpt-6-luna` on 21 Oct, while the quota was requested (risk R1). The Foundry project `matchcast-foundry` runs `gpt-5-mini` (Global Standard, 10K TPM, East US 2), and the live agents have run on it since 24 Oct (see [docs/infra.md](../../infra.md)). Docs and the default `FOUNDRY_MODEL_DEPLOYMENT` still named `gpt-6-luna`, so they described a model the app does not call.

## Options

1. Keep `gpt-6-luna` in the docs until its quota arrives: the docs describe a model the app does not run.
2. Name `gpt-5-mini` everywhere the deployment is named: the docs match the running app, and switching models later stays one setting.

## Decision

The agents call the Foundry deployment `gpt-5-mini` (Global Standard, East US 2) with managed identity. The default `FOUNDRY_MODEL_DEPLOYMENT` is `gpt-5-mini`. A future model is a new ADR, and the deployment name matches the model it runs.

## Consequences

- Docs and code name the same model; the span `chat gpt-5-mini` carries the model that answered.
- Quota is the limit to watch: 10K TPM on gpt-5-mini (R1 is reworded to match).
- `gpt-6-luna` labels that only name a fake deployment in tests are unchanged.

## Affects

- 01-goals-and-constraints.md (C5)
- 02-context-and-containers.md
- 04-agents.md
- 05-assistant-rag.md
- 13-deployment-and-operations.md
- 15-observability.md
- 16-testing-and-quality.md
- 17-risks-and-debt.md (R1)
- adr/0002-four-agents-on-agent-framework.md
