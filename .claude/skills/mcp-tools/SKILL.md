---
name: mcp-tools
description: Use when building or calling the MatchCast MCP tool server, the A2A Stats Desk, in-process tool twins, or wiring Copilot Agent Mode to the tools.
---

# MCP tools

Spec: `docs/architecture/04-agents.md` §6 and `docs/architecture/12-api.md`. Server: `services/mcp` (story AGT-10; check `ls services/mcp` and the open PRs before assuming it has landed). In-process twins live in `packages/agents/matchcast_agents/tools/inprocess.py` and are what the rules-mode Analyst uses.

## Tools (Streamable HTTP, one server)
`get_state`, `get_events` (max 200), `get_metrics` (recomputes with `packages/metrics`, returns `derivation_version`), `get_evidence`, `get_replay_clip`, `predict_danger` (ONNX from Blob), `query_season` (SELECT only, limit 1,000, returns `sql_hash`), `describe_views`, `search_kb`.
- Every call carries `match_id` and `up_to_sequence`: a tool must never return anything after that sequence.
- Results are at most 20 KB. Reject non-SELECT SQL and unknown views.
- Stats Desk is an A2A partner at `/a2a` with an Agent Card at `/.well-known/agent-card.json`; `compare_to_season` is deterministic (DuckDB), no model.
- A tool failure makes the Analyst use the in-process twin and audit `fallback_used` with reason `tool_error`.

## Rules
- Tool definitions and the in-process twin must return identical values for the same input: one test calls both.
- Metrics come from `packages/metrics` only (Data lane); do not reimplement a formula in a tool.
- Auth: external route is behind Easy Auth; Copilot Agent Mode uses `.vscode/mcp.json` (AGT-10, PLT-11). Evidence for PLT-11 is a recording of a real `get_state` call from Copilot: label anything not recorded as Planned.
- No key in `.vscode/mcp.json`; use the Easy Auth sign-in.
