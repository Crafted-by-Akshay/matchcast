# 16 Testing and quality strategy

Status: **Agreed design**. Last reviewed 22 Oct 2026. Backlog: QUA-1 to QUA-9, DAT-9, AGT-16.

## 1. Test layers

| Layer | What | Tools | Where | Runs |
| --- | --- | --- | --- | --- |
| Contract | Schema validity, Python ↔ TypeScript parity, fixtures | pytest, node:test, Ajv, jsonschema | `packages/contracts`, `tests/contracts` | Every PR |
| Unit | Reducer, metrics, Verifier checks, executors (rules and mocked model), stores | pytest, node:test | next to the code (`tests/` per package) | Every PR |
| Golden | Metrics Python vs JS values (50 events, ±0.001); audit chain vectors | pytest | `packages/metrics/tests/golden/` | Every PR |
| Integration | `api` with Azurite and in-memory bus; MCP tools against fixtures; SSE replay; store contract suite (§7) | pytest + httpx | `services/api/tests/`, `tests/store/` | Every PR |
| End to end | Every screen in headless Chromium against local `api` in rules mode, no Azure calls (§5) | Playwright (`@playwright/test`) | `tests/e2e/*.spec.ts` | Every PR |
| Realism | 200 seeds against 9 targets; determinism | `scripts/check_realism.py` | By hand (`make realism`); CI nightly is **Planned** | Not gated yet |
| AI quality | QUA-4 single vs four agents; Ask golden set; red-team set | `eval/compare.py`, `eval/ask_eval.py`, `eval/redteam.jsonl` | CI smoke (5 moments, 10 questions) per PR; full run nightly on the Mac mini | Path-gated + nightly |
| Smoke (cloud) | `/ready` 200; the whole `match-short.json` fixture posted in 10-event batches: every event taken up, at least one claim verified, and the claims and match stats stopped changing (two equal polls in the direct pipeline, 60 s unchanged in the Event Hubs or memory pipeline, `--quiet` sets the window); Verifier rejections and pending claims are allowed | `scripts/smoke_pipeline.py` | After every deploy | Every deploy |
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
- The score comes from deterministic Verifier checks only, so no model grades the system under test.
- Measures: verified-line rate, hallucinated numbers or names per 100 lines, p50 and p95 latency, tokens, cost. 3 runs per arm; mean and range in `eval/results/<date>.json` and the README.

### 4.1 Line grades and the arm scoreboard (CREW-5.1, CREW-5.2)

- **Line grade.** `packages/agents/matchcast_agents/grading.py` `grade_line` grades an aired line against the event log: each claim it was built from (correct, incorrect or unverifiable, with the engine value beside the claim value), each number the line states, and any name not in the roster. It recounts from the events and never calls a model. A claim with no engine truth is unverifiable, never correct: a history fact, a Vision metric (the log does not count them), an unknown metric, or a claim whose evidence is not in the log. A number in a sentence with a club's name is judged against the claims of the club nearest to it in that sentence (a sentence ends at a full stop, ! or ?, not one inside a number); a sentence with no club name leaves its numbers unattributed. A line built on a wrong claim is incorrect, as the Verifier's check 3 refuses such a line. The grader shares the Verifier's recount function (`recompute`), so an error in that function shows in both; it does not use the Verifier's verdicts.
- **Scoreboard.** `scoreboard` runs three rules-mode arms on one match with the same seeded wrong claims: the full crew (workflow with its Verifier), a single agent (one pass per shot or goal, claims then line, no Verifier, no Producer routing) and the crew with the Verifier check bypassed. It reports accuracy (wrong numbers aired over numbers aired), catch rate (seeded wrong claims whose wrong value no aired line states, over seeded wrong claims), lines aired, measured wall-time latency per shot or goal, and agent calls a model served. No price is applied. The single agent also skips Content Safety, which the crew arms run.
- **Live or recorded.** The rules arms run on each request and make no model call. Their latency is measured wall time on the machine that runs them. The model arms (`grading_live.live_run`) run once, by `scripts/scoreboard_live.py`, with each arm's own budget (`--max-calls`, at most 1000 per arm). A call past its budget is refused and a failed call is counted; both fall back to the rules. Per arm the record shows `model_calls`, `model_errors`, `budget_refused`, `agent_calls` and `answered_by_rules`, and an arm with any fallback answer is `mixed`, not `live`. The recording is keyed to its fixture's teams, its seed and its rate, not to a match id, because judges' sessions get fresh ids. The route shows it beside the rules arms under `recorded`: as "same events as this match" only when the digest of this match's events equals the digest the recording ran on, otherwise as a benchmark labelled "not this match". The route never calls a model. The catch rate counts only the seeded claims the crew made.
- **Scope.** The grader runs offline on the recorded events of one match. A run's history facts are cut at its run date, so a rerun on the same date gives the same grades. Grading each line as it airs needs a hook in the workflow, which the Showrunner change owns, so it is not wired here. The scoreboard uses `match-short.json`, the fixture the workflow tests use, not the season moments in `eval/frozen-moments.json`.

## 5. Browser tests (Playwright)

- **Runner:** `@playwright/test`, pinned in the root `package.json`, config `playwright.config.ts`. One runner only: the prototype scripts `apps/unified/tests/unified.cjs`, `lazy.cjs` and `timing.cjs` are ported into specs in QUA-1 and then deleted.
- **Browsers:** project `chromium` in CI (the preinstalled Chromium; WebGL through SwiftShader, flags as in `unified.cjs`). Project `webkit` runs on the Mac mini before release as the Safari check.
- **What it runs against:** `webServer` starts `make serve-e2e`, which builds the unified app with `--api http://localhost:8000` and starts `api` with `MATCHCAST_MODE=local`, `MATCHCAST_AGENT_MODE=rules`, `MATCHCAST_STORE=memory`. Foundry, Speech, Translator, Vision and AI Search are replaced by fakes in local mode; the browser Speech SDK is replaced by a stub through `page.addInitScript`. CI never calls Azure.
- **Determinism:** fixed seed and speed in the URL (`?seed=2026&half=45&st=1&month=3&h=NAV&a=LOM&speed=4`), `?seedBadClaim=1` for the repair path. Wait for DOM state or bus messages, never fixed sleeps.
- **Live mode:** specs tagged `@live` also run against the deployed URL with `E2E_BASE_URL` (read-only checks, used by QUA-8 and after deploys).
- **Network guard:** specs import `test` from `tests/e2e/fixtures.ts`, which blocks requests to Azure hosts (`azure.com`, `cognitiveservices.azure.com`, `openai.azure.com`, `search.windows.net`) and fails the test that made one. Fake the call instead. The guard is off for live runs (`E2E_BASE_URL`).
- **On failure:** screenshot, video and trace kept and uploaded by CI as the `playwright-report` artefact. One retry in CI, none locally; a test that passes only on retry is reported as flaky and fixed, never skipped.
- **Time budget:** each spec under 3 minutes; the whole e2e job under 10 minutes.
- **Commands:** `make e2e` (Chromium), `make e2e-webkit`, `make e2e-live E2E_BASE_URL=https://…`.

| Spec | Covers | Story |
| --- | --- | --- |
| `watch.spec.ts` | Load, kick-off, Match Pulse card with tick, "Why?" replay, mode switch changes text, mode kept after reload, trace panel | QUA-1 (EXP-3, EXP-4, EXP-6) |
| `broadcast.spec.ts` | Same score as Watch, lower-third only after approval in producer mode, captions, red-card alert | QUA-2 (EXP-7, EXP-8, EXP-9) |
| `analyst.spec.ts` | Ledger fills, provenance, approve/edit/kill as a mocked Producer, "Chain intact", export hash, Data platform page | QUA-3 (EXP-10 to EXP-13) |
| `cross-view.spec.ts` | Same score, minute and last 5 events in all three views; pause carries over | QUA-9 (EXP-2) |
| `connection.spec.ts` | No `--api` → "Offline (simulated)"; api stopped → "Rules fallback"; SSE drop → reconnect without duplicates | QUA-9 (EXP-1) |
| `language.spec.ts` | Spanish and Hindi lines keep numbers and names; a fake bad translation shows "Translation unavailable" | QUA-9 (EXP-17) |
| `ask-talk.spec.ts` | Ask answerable and unanswerable; typed Talk to a player and the producer; no Speech key in network traffic | QUA-9 (EXP-5, EXP-16) |
| `condensed.spec.ts` | Fast-forward wipe shows the minute range; stats include fast-forwarded passes | QUA-9 (DAT-10) |
| `vision.spec.ts` | Tracking lab shows both accuracy numbers; OCR route mocked with `page.route`; never more than 15 calls a minute; bad OCR text rejected | QUA-9 (DAT-11) |
| `a11y.spec.ts` | `@axe-core/playwright` on each view: no serious or critical issues; Tab order; Esc closes the trace | QUA-9 (EXP-14) |
| `timing.spec.ts` `@live` | Watch interactive within 4 s against the warm live URL | QUA-9 (EXP-15) |

## 6. Every acceptance criterion has a test

| Story type | Required evidence |
| --- | --- |
| Screen or UI behaviour | A case in the Playwright spec named in the story's tasks |
| API route | Integration test with httpx; error codes from [12-api.md](12-api.md) |
| Agent or Verifier behaviour | Unit test with recorded model responses; eval run if a prompt changed |
| Metric or simulator | Golden or property-based test; realism check if the engine changed |
| Infrastructure | `az bicep build`, `azd provision --preview` output in the PR, cloud smoke after deploy |
| Portal or manual-only (Lighthouse, VoiceOver, Fabric paused) | Screenshot or recording attached to the PR, listed in `docs/release-check.md` |

## 7. Storage and database tests

- `tests/store/test_store_contract.py` runs the same cases against `MemoryStore` and against `TableStore` on Azurite (a CI service container): idempotent upsert with the same key, ETag conflict on `matchstate/current`, audit 409 then retry once, values over 60 KB moved to Blob `overflow/`, no read across stream keys, the 24-hour `conversations` sweep.
- Any new store, including a database added under ADR-0015, must pass this suite unchanged before a story can use it.
