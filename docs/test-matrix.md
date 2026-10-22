# Test matrix

What each layer of the suite covers, which browser runs it, and what only a person or the live URL can check.
Every Playwright spec runs in Chromium against the built unified app with the api mocked; none calls Azure or Foundry
(`docs/architecture/16-testing-and-quality.md`). Last full run: main 6eb3160, 83 passed and 1 skipped in 33 minutes.

## Browser spec by product area

| Area (challenge stage) | Specs | What they prove |
| --- | --- | --- |
| Ingest (a): events reach the screen | `connection`, `unified`, `cross-view`, `load` | The shell sends the match start and events to the api, Watch is the only engine, Broadcast and Analyst follow it, views load lazily |
| Interpret (b): stats and context | `pulse`, `watch`, `analyst` | Match Pulse, watch modes, Analyst pages from the stored events, Data Scientist fallbacks, recap card |
| Explain (c): why it matters | `trace`, `ledger`, `ask-talk`, `language` | Trace panel, claims ledger, Ask answers from the event log or abstains, translated lines keep their numbers and names |
| Render (d): next to the match | `broadcast`, `broadcast-layout`, `animation`, `replay`, `onair`, `referee-signals`, `broadcast-lang` | What a viewer of the desk sees, overlays that do not cover each other, same poses as Watch, instant replay, on-air log export, referee signals, English, Spanish and Hindi script |
| Personalise (e) | `pulse` (modes), `voice`, `talk`, `speech`, `approval` | Modes and favourites, captions with and without audio, push-to-talk, Azure Speech fallbacks, nothing airs in producer mode before approval |
| Trust | `approval`, `audit`, `vision-crops` | Forged messages do not air, the audit chain is checked and a break is shown, OCR crops respect the api's rate limit |
| Accessibility | `a11y`, `a11y-analyst`, `a11y-broadcast`, `shell-a11y`, `loading-states` | axe-core WCAG 2 A/AA with no serious or critical findings, keyboard and screen-reader behaviour, a view that cannot start says why |

## Other layers

| Layer | Where | Runs in |
| --- | --- | --- |
| Python unit and contract tests | `tests/`, `packages/*/tests`, `services/*/tests` | `make test`; the autouse guard in the root `conftest.py` gives every test a credential that cannot get a token and refuses any connection outside this machine (`tests/test_no_azure_guard.py`) |
| Contract drift, lint | `make lint` | local and CI |
| Evaluation (single agent vs four agents) | `eval/compare.py`, `tests/test_eval_compare.py` | offline with the fake model; live run waits on model quota |
| Red team prompts | `eval/redteam.jsonl`, `tests/test_redteam.py` | offline for the shield and safety layers; the `ask` layer is covered by the Ask golden set |
| Dependency scan | `docs/security-scan.md` | `npm audit`, `pip-audit` |
| Judge path | `make judge-path` | local, no cloud calls |

## Shared fakes

| Fake | Where | Used for |
| --- | --- | --- |
| Azure network guard | `tests/e2e/fixtures.ts` (auto fixture, `azureHits`) | Any request to an Azure host fails the test; off for live runs |
| Speech SDK and speechSynthesis | `fakeSpeechSdk` in `tests/e2e/fixtures.ts` | Token flow, voices per role and language, browser-voice fallback |
| Table Storage, Blob | `packages/agents/tests/fake_tables.py` | Store contract, workflow, state writer |
| Foundry completions | `fake_openai(outcome)` in `packages/agents/tests` | Agent resilience and live-agent paths |
| Event Hubs producer, consumer, batch | `tests/test_eventhubs.py` | Ingest and the worker consumer |
| api mocks in the browser | `page.route('http://api.test/...')` plus a `**/config.js` route | One-off replies per spec |

Backend fakes live beside the tests that use them; moving them into one shared module is a follow-up for Quality (QUA-9 task 310).

## Not covered by the automated suite

| Check | Why | Who and when |
| --- | --- | --- |
| Safari / WebKit | No WebKit build in the cloud container; `make e2e-webkit` is meant for the Mac mini | Akshay's Mac, record the result here |
| Live-mode runs (`make e2e-live`) | Needs the deployed URL (`E2E_BASE_URL`) | After deploy, as part of the release check |
| Real Azure Speech, Translator, Vision and Foundry output | CI must not call Azure | Release check on 26 and 27 Oct (`docs/release-check.md`) |
| Real GPU rendering | The cloud runs software WebGL, so frame rate is not measured here | Mac mini |
