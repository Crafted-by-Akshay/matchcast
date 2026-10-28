# Demo and Devpost fact check against the real pipeline

Checked 22 Oct 2026 by the Agents lane against `main` at 71d94a3 (rows 1 and 2 updated 28 Oct against `main`): `docs/submission/devpost.md`, `docs/submission/shot-list.md` and `docs/video-script.md`. Each row says what the text claims, what the code does, and the fix. Fix owners are suggestions.

| # | Claim | What is true today | Fix |
| --- | --- | --- | --- |
| 1 | Filming URL `?seed=2026&speed=4` and `&seedBadClaim=1` (video-script line 5, shot-list "Before filming" 3) | Read now. `apps/unified/index.html` reads `seed` and `speed` at boot (around lines 1608 and 1609) and `seedBadClaim` on the Agents view (line 1763), which ticks the bad-claim switch. Checked 28 Oct against `main`. | Quality: check the filming steps against the current Watch and Agents routes before filming. The filming URL is repeatable without setup-screen clicks. |
| 2 | "Seed a bad claim" shows the Verifier rejecting a wrong number and repairing it "from the raw event log" (devpost step 4, shot 3) | The switch (`index.html` `ag-bad`) sets two things. The in-page rules pipeline corrupts the next score claim (`agents.js` `seedBad`), and the live api gets `seed_bad_claim` when a match is created (`live.js` `seedBad`, sent from `/v1/matches`). The api plants the wrong claim at minute 12 (`matches.py` `seed_bad_claim_at_ms`). The switch takes effect only for matches created after it is ticked. | Narration: say which pipeline the trace came from. Tick the switch before starting a new match if the video needs the api Verifier. |
| 3 | Shot 8 "Single agent vs four agents ... `docs/eval/agents-eval.md` table" | `agents-eval.md` has no single-agent arm. The comparison is `eval/compare.py` (QUA-4) and its recorded result `eval/results/offline.json` says `single_model: FakeModel (offline stand-in)`. | Show it only with the caption **Simulated single model**, or re-run `eval/compare.py` with a live model once Foundry quota arrives. Quote `offline.json`, not `agents-eval.md`. |
| 4 | "Azure AI Search" in the elevator pitch and "Built with" | No AI Search index is built or called. Retrieval is the in-memory BM25 "Search fallback" (05-assistant-rag.md). | Quality: move Azure AI Search to the Planned list, or keep it only after 145 and 146 are done. |
| 5 | "The Verifier recounts every number from the stored event log before a line reaches a screen" (pitch) | True for lines that come from the API stream. The Watch page also runs its own rules pipeline whose cards are not API-Verified, and the UI posts only goal and shot events to the API (audit, stage a). | Qualify to "every line the API publishes", or ship the Experience hand-offs (post all event types, label API-Verified vs in-page) before filming. |
| 6 | "Table-backed storage (tested on Azurite)" | Table store contract tests run on a fake (`packages/agents/tests/fake_tables.py`); Azurite appears in the CI workflow and `services/worker/tests/test_table_repo.py`. Both are true, but local `make test` does not need Azurite. | Wording is fine; add "and on a fake in unit tests". |
| 7 | Spanish with numbers unchanged (shot 4) | Backend is done (`variants[lang]`, name/number re-check), but the UI does not render `variants` yet (hand-off sent). The rules-mode translation in the page is a separate path. | Keep the shot's own rule: film it only if the deployed URL shows verified Spanish; otherwise cut. |
| 8 | Proof lines `PASS  match to verified claims - OK: <n> verified claims`, `app shell has the three views`, `Judge path OK` | `scripts/judge_path.py` prints these step names (`step(...)`); the exact wording of the claims step was not re-run for this check. | Quality: re-run `make judge-path` on the filming machine and paste the real lines. |
| 9 | Copilot Agent Mode calling the MCP tool (shot 6) | Already conditional on PLT-11; the MCP server itself is tested (`tests/test_api_mcp.py`). | None; cut if not recorded. |

## What the demo can safely say

- Four agents, Producer approval, audit chain, trace panel, seeded bad claim caught 7 of 7 and 0 wrong claims shown (`docs/eval/agents-eval.md`, rules mode).
- Casual and Analyst voices carry different numbers and entities (`docs/judge/pipeline-audit.md`, stage e).
- Goal lines say why the moment matters.

## Open items for other lanes

Rows 1, 2 and 5 are Experience work, rows 3, 4 and 8 are Quality's submission docs. Nothing here changes a contract.
