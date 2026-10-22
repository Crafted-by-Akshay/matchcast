# 16 Testing and quality strategy

Status: **Agreed design**. Last reviewed 22 Oct 2026. Backlog: QUA-1 to QUA-8, DAT-9, AGT-16.

## 1. Test layers

| Layer | What | Tools | Where | Runs |
| --- | --- | --- | --- | --- |
| Contract | Schema validity, Python ↔ TypeScript parity, fixtures | pytest, node:test, Ajv, jsonschema | `packages/contracts`, `tests/contracts` | Every PR |
| Unit | Reducer, metrics, Verifier checks, executors (rules and mocked model), stores | pytest, node:test | next to the code (`tests/` per package) | Every PR |
| Golden | Metrics Python vs JS values (50 events, ±0.001); audit chain vectors | pytest | `packages/metrics/tests/golden/` | Every PR |
| Integration | `api` with Azurite and in-memory bus; MCP tools against fixtures; SSE replay | pytest + httpx | `services/api/tests/` | Every PR |
| End to end | Watch, Broadcast, Analyst in headless Chromium against local `api` in rules mode | Playwright | `tests/e2e/*.spec.ts`, `apps/unified/tests/` | Every PR |
| Realism | 200 seeds against 9 targets; determinism | `scripts/check_realism.py` | CI when engine paths change | Path-gated |
| AI quality | QUA-4 single vs four agents; Ask golden set; red-team set | `eval/compare.py`, `eval/ask_eval.py`, `eval/redteam.jsonl` | CI smoke (5 moments, 10 questions) per PR; full run nightly on the Mac mini | Path-gated + nightly |
| Smoke (cloud) | `/ready` 200; one event round-trip to a publication | `scripts/smoke_cloud.py` | After every deploy | Every deploy |
| Release | Logged-out walk-through of the judge path | `docs/release-check.md` | Before the video and on 27 Oct | Manual |

## 2. Test pyramid targets

- Unit and contract tests: every new function or branch gets a test. A PR without tests for new logic is sent back (QUA-6).
- Coverage is not a gate; the acceptance criteria of the story are.
- No live Foundry calls in PR CI. Model calls use recorded responses (`tests/fixtures/model/*.json`) through a fake client with the same interface. Live calls run only in the nightly eval and the cloud smoke test.

## 3. Definition of done (every story)

1. Every acceptance criterion in the Azure Boards story has a test or a recorded manual check in the PR.
2. `make lint typecheck test build` passes locally and in CI.
3. Docs updated: the architecture file that describes the change, and `docs/contracts.md` if a contract changed.
4. No new secret, and gitleaks passes.
5. UI labels honest: "Simulated" where not connected.
6. The reviewer session approved in a fresh context, and Akshay merged.
7. A short handoff note in the lane's task file.

## 4. Evaluation method (QUA-4)

- 30 fixed moments (5 per scene family) from recorded matches.
- Arm A: one `gpt-6-luna` agent with the same tools and a combined prompt. Arm B: the four-agent workflow.
- The score comes from deterministic Verifier checks only, so the system under test never grades itself.
- Measures: verified-line rate, hallucinated numbers or names per 100 lines, p50 and p95 latency, tokens, cost. 3 runs per arm; mean and range in `eval/results/<date>.json` and the README.
