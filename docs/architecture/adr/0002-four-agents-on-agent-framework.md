# ADR-0002: Four core agents on Microsoft Agent Framework with Foundry gpt-6-luna

- **Status:** Accepted
- **Date:** 2026-10-19 (agents), 2026-10-21 (model)
- **Decided by:** Akshay

## Context

Multi-Agent judging rewards distinct roles, shared state, handoffs and failure recovery. Predictions and stats are deterministic and need no model.

## Options

1. One general agent with all tools
2. Four role agents (Producer, Analyst, Narrator, Verifier) with typed handoffs; Predictor as a tool; Data Scientist on demand

## Decision

Four role agents as executors in an Agent Framework workflow, model gpt-6-luna (Global Standard, East US 2) through the Foundry project with managed identity. Predictor and stats are MCP tools. The Data Scientist runs only on request.

## Consequences

- Clear trace per agent; QUA-4 can compare against one agent.
- More calls per moment than a single agent; mitigated by the Producer's rate rule.

## Affects

- 04-agents.md
- 03-runtime-flows.md
