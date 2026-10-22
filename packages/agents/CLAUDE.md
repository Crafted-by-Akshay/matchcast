# Agents lane (packages/agents, packages/contracts, services/api, services/mcp, services/recap, kb/)

Read first: root `CLAUDE.md`, then `docs/architecture/04-agents.md`, `05-assistant-rag.md`, `12-api.md`, `03-runtime-flows.md` (F1-F6, F8-F10), ADR-0002, 0009, 0013, 0014.
Skills: `foundry-agents`, `verifier-rules`, `mcp-tools`, `matchcast-contracts`, `tdd-workflow`, `verification-loop`, `handoff`. Agents: `planner`, `tester`, `bug-fixer`.

- Every agent keeps a rules twin; live paths are tested with `ScriptedModelClient`. No Foundry call in tests.
- A model states a number only from a tool result in the same turn. The Verifier recounts from stored events.
- Contract and audit-action changes: `docs/contracts.md` and doc 04 §4 first, all lanes agree. Never edit `generated.ts`.
- New api routes: update `docs/architecture/12-api.md` and the openapi snapshot when it exists.
- Prompt text change = bump the `version:` line.
