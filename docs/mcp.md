# MatchCast MCP tools

The match data tools from `docs/architecture/04-agents.md` §6, served over MCP Streamable HTTP at
`/mcp`. Agents and GitHub Copilot (VS Code agent mode) call the same tools; every call names a match
and an `up_to_sequence` and is refused beyond the stored state, so nothing can read the future.

## Tools in this version

| Tool | Arguments (all take `session_id`, `match_id`) | Returns |
| --- | --- | --- |
| `get_state` | `up_to_sequence` | score, clock, possession, revision, last 10 event ids |
| `get_events` | `up_to_sequence`, `from_seq`, `to_seq`, `kinds?` | contract events (max 200) |
| `get_metrics` | `up_to_sequence`, `names` (`goals:<team_id>`, `shots:...`) | value, units, `derivation_version` |
| `get_evidence` | `claim_id` | claim, tool call ids, formula inputs, source events |
| `get_replay_clip` | `up_to_sequence`, `event_id` | events within 5 s of the event |
| `describe_views` | none (not match-scoped) | season views with columns and types |
| `query_season` | `sql` (one SELECT, max 1,000 rows, 5 s) | columns, rows, `sql_hash`, `elapsed_ms` |
| `search_kb` | `query`, `corpus?`, `top` (1 to 8) | chunks with id, corpus, title, section, text, score (BM25 over `kb/` today; AI Search once ingested) |

Results are capped at 20 KB. The season and knowledge tools are not match-scoped: they read static, synthetic data. Not built
yet: `predict_danger` (needs the danger model) and the
`window_s`, `team_id`, `player_id` arguments of `get_metrics` (DAT-3 metrics). The agents still call
the in-process twins in `matchcast_agents.tools`; switching them to an MCP client
(`MATCHCAST_TOOLS=inproc|mcp`) needs the shared store from DAT-2.

## Where it runs

- Now: the api mounts the server at `/mcp` and shares its in-memory store, so any match created
  through `/v1/matches` can be queried. Set `MATCHCAST_MCP_MOUNT=0` to turn that off.
- Later: the `mcp` container (`services/mcp`) with a Table Storage store. Easy Auth fronts the
  external route; set `MATCHCAST_MCP_ALLOWED_HOSTS` to the FQDN (or `*` behind Easy Auth).

## Try it from VS Code

1. Start the api: `uv run --package matchcast-api uvicorn app.main:app --app-dir services/api`.
2. Create a match and post events (see `docs/backend.md`), or run the fixture from the tests.
3. Open `.vscode/mcp.json`, start `matchcast-local`, and in Copilot Chat (agent mode) ask for the
   current goals for each team. Copilot should call `get_metrics` with the match ids.
4. For the cloud demo, replace `<api-fqdn>` in `matchcast-demo` and sign in when VS Code asks.

The 10-second Copilot clip for the video is recorded by hand once the cloud route exists.
