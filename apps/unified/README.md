# MatchCast unified console

This is the unified app for the hackathon. Generated folders (`watch/`, `broadcast/`, `analyst/`, `shared/`) are rebuilt with `python3 apps/unified/build.py` and are not committed.

One app for the three MatchCast dashboards, switched from one top bar:

- **Watch** (fan 3D match): the 3D app from `sources/3d-source/v2`, without its v10 Director and v11 Analyst boards.
- **Analyst** (enterprise console): `sources/enterprise-console/src` with its data.
- **Broadcast** (broadcaster desk): `sources/broadcaster-console`, same build.

Sources are in `sources/`, a copy of the three prototype folders. They are read only. `build.py` copies each view from its source folder and applies a few asserted patches. The shell, `index.html`, is written by hand.

## The shared match
- The match bar holds one season fixture (28 in the league, from `shared/fixtures.json`). The fixture sets the teams, stadium, month, kick-off, seed, half length and formations.
- Watch and Broadcast play that setup live. They take the fixture's clubs, squads and kits, so the names and colours match the Analyst.
- The Analyst opens the season's recorded run for the same fixture.
- A view keeps its own clock. Switching views does not restart a running match. A view that has not started yet kicks off at 0:00.
- At full time, the live match goes from Watch or Broadcast to the Analyst as a new library entry (the same import as a Watch dataset file). The match bar then shows the live score.
- A New match or a changed setup inside Watch or Broadcast becomes the shared match. The fixture picker then shows "Custom setup".

## The live source and the agents
- Watch is the live source. Each second it sends the match events and the explain moments it produced, with the setup they came from. The shell accepts them only from Watch, and only for the shared match.
- The score and minute go back out to Broadcast (its scoreboard) and to the Analyst (a small "Live from Watch" pill). Broadcast's pitch still runs its own engine, so its goals can differ from Watch's until the single-engine refactor.
- The Agents tab (key 4) is one pipeline for the three views. Producer picks moments and routes lines. Analyst turns events into claims with evidence. Narrator writes each English line from the claim's inputs. Verifier recounts every claim from the raw event log, repairs it once from that recount, or abstains. Predictor is a tool the agents call; the Data Scientist runs on demand in the Analyst only.
- The agents are rules in the page. No Foundry call is made, and the tab says so.
- `contracts.js` (`MCC`) holds the three shared contracts: `matchcast.event/1`, `matchcast.claim/1` and `matchcast.audit/1`. Canonical JSON (sorted keys) is hashed with SHA-256, and each audit record holds the hash of the one before it. "Verify chain" recounts the whole chain.
- `agents.js` (`AG`) runs the pipeline. A new match from Watch starts a new run and a new audit chain.
- Design and the Azure target: `/mnt/project-files/matchcast-v2/orchestration/DESIGN.md`.

## Files
- `index.html`: the shell (switcher, match bar, Agents tab, message handling).
- `contracts.js`, `agents.js`: the shared contracts and the agent pipeline, loaded by the shell.
- `live.js` (`LV`, EXP-1): posts Watch's goal and shot events to the agent api (`POST /v1/matches`, `/events`) and subscribes to its SSE stream (claims, lines, publications), which `AG.ingest` shows beside the rules claims. The top-bar pill reads 'Live agents', 'Rules fallback' (api silent for 45 s or on rules), 'Warming up the match engine' or 'Offline (simulated)' (no api). Build with `python3 build.py --api https://<api>` to set `config.js`; without it nothing is called. Only goal and shot events are mapped to contract events so far.
- `watch/index.html`, `broadcast/index.html`, `analyst/index.html`: built views. Each has `embed/hook.js` plus its own hook appended.
- `embed/`: the hooks. `hook.js` (shared by Watch and Broadcast), `watch.js`, `broadcast.js`, `analyst.js`.
- `shared/`: `players.json`, `intl.json` (3D engine), `fixtures.json` and `clubs.json` (season, generated from the Analyst data), `analyst/data/` (28 matches and the league).

## Build
- `python3 build.py`: writes the views, `shared/` and `analyst/data/` for publishing. The views load three.js 0.160.0 from jsdelivr.
- `python3 build.py <dir>`: also writes a copy in `<dir>` for tests, with three.js served from `<dir>/node_modules/three`.

## Tests
- `tests/e2e/trace.spec.ts` (EXP-6): four agents in order with durations and tools; the seeded bad claim shows the repair.
- `tests/e2e/ledger.spec.ts` (EXP-10): newest first, filters, provenance, CSV export with a matching SHA-256.
- `tests/e2e/pulse.spec.ts` (was `watch.cjs`): Match Pulse cards (tick, chips, Rules fallback chip, Why?, last 10), Casual v Analyst text and chips, Player focus lead, mode saved and restored after reload, Planned language labels.
- `tests/e2e/connection.spec.ts` (was `connection.cjs`): live, rules fallback and offline against a mock api (drives the shell directly).
- `tests/e2e/unified.spec.ts` (run with `make e2e`; was `unified.cjs`): headless Chromium. Checks the season loads, Watch and Broadcast start on the shared fixture with its clubs, the Analyst routes to it, switching keeps Watch running, Watch's events reach the agents, the audit chain verifies, the Broadcast scoreboard shows Watch's score, full time reaches the Analyst, a fixture change reloads Watch, the keyboard shortcuts work (1 to 4), and the phone layout has no horizontal scroll. Saves screenshots.
- `tests/e2e/cross-view.spec.ts` (EXP-2): Watch paused then Broadcast opened (same minute, score, paused), Broadcast replays events, Analyst pill score and last five events, Broadcast follows once Watch resumes.

## Match Pulse and watch modes (EXP-3, EXP-4)
- The shell posts one card per agent line to Watch (`type: 'pulse'`). Watch shows it for 12 s, keeps the last 10 in a scrollable log, and marks each with the Verifier's tick (green) or an amber dot, plus a 'Rules fallback' chip when the in-page rules wrote it. 'Why?' lists the cited events; the 3D replay with highlights is Planned.
- Casual shows the plain line and no chips; the other modes show the full line with chips. Player focus leads the line with the player's name; My club accents the club's cards.
- The watch mode is saved in localStorage (`mcx-mode`) and restored on reload. It is sent to the shell as the persona (`casual`, `analyst`, `club:<key>`, `player:<name>`, `metric:<name>`), and `live.js` reopens the api stream for it.
- The language picker labels everything except English, Spanish and Hindi as Planned.

## Trace panel (EXP-6)
- `trace-panel.js` (`TP`): 'How was this made?' on any line (a Match Pulse card or the Agents tab's Provenance) opens a timeline: Producer task, Analyst claim with its tool names, Narrator draft, Verifier verdict and repair, Producer approval and publication, each with its time and 'rules' or 'model'. Rules steps carry no tokens. Data is the claim's own trace (`agents.js`) and its audit records.
- 'Seed a bad claim' (Agents tab) makes the next score claim wrong so the Verifier rejects and repairs it; the trace shows the reason and the repair. Lines from the api show what the stream carried until the server trace summaries (AGT-3) are added to it.


## One match source (EXP-2)
- Watch is the only engine. Four times a second it sends the pitch state (22 players' positions, velocities and headings, the ball, score, clock, pause, speed and stats) and the shell forwards it to Broadcast, along with Watch's events.
- Broadcast runs in consumer mode (`window.MC_CONSUMER`, `consumerStep` in `embed/broadcast.js`, patched into `stepSim` by `build.py`): it moves its players and ball toward the latest frame, takes the score, minute, half and stats from it, and replays Watch's events onto its own event bus. Its desk modules (odds, calls, focus board, lower-thirds) read that. Its own play and pause buttons are disabled; Watch's controls drive the match.
- The Analyst's live pill shows the same score and minute and lists the last five events in its tooltip.
- Action poses: each player in a frame carries its current action (kick, shot, header, slide, dive, throw, skill, celebration and so on; `actOf` in `embed/watch.js`). Broadcast applies it in `consumerStep` and runs the action clock itself, so it draws the same poses. Test: `tests/e2e/animation.spec.ts`. The referees' signals are not carried yet.
- Known gaps: the Analyst's season pages are still recorded runs, only the live pill follows Watch.
## Claims ledger (EXP-10)
- The Agents tab's claims table is the ledger: time, metric, value, units, agent, source (model or rules), verdict, reason, approval; newest first. Filters for verdict, agent and metric. A row opens its provenance (source events, audit records, trace). 'Export CSV' downloads the filtered rows and shows the file's SHA-256, which equals `shasum -a 256` of the download.
- It lives in the shell's Agents tab, not inside the Analyst view (the enterprise console's own ledger page still shows its prototype data). Tool calls per claim are in the trace panel (EXP-6).

## Limits
- The views are separate engines inside frames. Their own headers stay under the shell bar, and the Analyst keeps its own design. A single merged code base would be a larger job.
- Each view runs its own simulation. Watch is the only live source for the score, the events and the agents. Broadcast shows Watch's score, but its pitch and goals come from its own engine, and the Analyst's season runs are headless recordings. The live full-time handoff is the way to get the played match into the Analyst. Making Broadcast and the Analyst consume Watch's events directly is the next refactor (option A in the orchestration design).
- The agents and the Verifier are rules, not models. They are labelled as simulated, and the Azure parts are not connected.
- The shell is in English only. Broadcast has its own EN and Tamil script.
- Azure parts, Entra roles and the Foundry agents are simulated and labelled as such in each view.
- Tested in local headless Chromium. Not yet tested inside the claude.ai artifact host.

## Lower-thirds, teleprompter and the approval queue (EXP-7, EXP-11)
- Broadcast accepts an `air` message only from the shell (`e.source === window.parent`), because the approval gate lives in the shell; `broadcast.spec.ts` sends a forged one and checks nothing airs.
- The lower-third and teleprompter sit inside the live view (`#bc-view`), because the desk's CSS hides every other direct child of `body`. `tests/e2e/broadcast.spec.ts` (QUA-2) checks they are visible on screen, not only un-hidden.
- Agents tab, Approval queue: **Demo** mode airs verified Broadcast lines at once. **Producer** mode holds each one until a person approves, edits or kills it. The signed-in producer is a simulated account (Planned: Entra ID).
- Broadcast shows an approved line as a lower-third for 8 seconds and keeps the last five in the teleprompter list. A pending or killed line reaches no view, including Watch's Match Pulse.
- Edit is re-verified: every number in the new text must already be in the verified line (or its minute), otherwise it is rejected and not aired. Approve, edit and kill each write `line_approved`, `line_edited` or `line_killed` to the audit chain with the person's name.

## Captions and voice (EXP-8)
`voice.js` shows every verified line as a caption and, when "Voice" in the top bar is on, speaks it. With the api, a publication's `audio_url` (Azure Speech mp3 from `/v1/audio/...`) is played; without it the browser's own voice is used and labelled "Browser voice (simulated)"; the Azure Speech voice is Planned. A line older than 5 s is shown but never spoken. Each claim is spoken once. Voice names live in `voices.json` (shown on the button; the api reads them, the browser fallback cannot use Azure voice names)`voices.json` (play-by-play, analyst, Spanish, Hindi). Voice is off by default (browsers need a click to play audio) and the choice is remembered. Planned: the Speech resource and synthesis service (api and Bicep), Spanish/Hindi voices once EXP-17 lands, and per-role voice choice.

## Spanish and Hindi lines (EXP-17)
Choosing Spanish or Hindi in Watch shows Match Pulse cards in that language. With no api, a rules Translator writes each verified score, shot and xG line from fixed templates; names and numbers are copied untouched. The Verifier then re-checks the translation: the names and numbers must be the same and in the same order as the English line (so a swapped score or swapped clubs fails) and it may contain no name that is not in the English line or the roster, otherwise the translation is rejected (`translation_rejected` in the audit chain) and the card keeps the English line with "Translation unavailable". Moment prose from Watch has no template, so it stays English. The chosen language is also sent to the api stream (`lang`) for the model Translator. This re-check covers the rules Translator only; re-checking the api's model translations in the page is Planned. Also Planned: Azure AI Translator, voices (EXP-8), Broadcast captions, the 500,000-character guard and Content Safety on translations, which live in the api.

## Audit chain from the server (EXP-12)
With an api configured, "Verify chain" in the Agents tab fetches `GET /v1/matches/{id}/audit`, pages through the records (1000 a call, `from_seq`), recomputes every hash in the page (same rules as `verifyChain` in packages/contracts: sorted-key canonical JSON, SHA-256, genesis of 64 zeros) and shows "Chain intact · N records · server" or the first broken sequence and reason. With no api, or if the api cannot answer, it checks the in-page chain and says so. The Analyst's own Trust & audit page still verifies its in-page chain (Planned: switch it to the same call).

## Wild-moment alerts (EXP-9)
A red card or turning point is a deterministic trigger. The Producer marks that claim priority 1, it follows the normal Verifier path and the approval queue, and Broadcast shows it as a red "ALERT · … · verified" lower-third. Alerts sort first in the approval queue. Win-probability swings and goals against the run of play need the prediction stream and are Planned.

## Accessibility (EXP-14)
The shell: arrow keys, Home and End move between the dashboard tabs (tab 1 to 4 still switch from anywhere outside a field); a skip link jumps to the match view; every button and tab shows a focus ring; each published line is announced through a polite live region (`#sr-lines`); tab labels, the selected tab and the filter buttons meet WCAG AA contrast (axe-core reports no serious or critical issue on the Agents tab). The trace panel is a native dialog, so Esc closes it. Not yet checked: the three views inside their frames (QUA-9 `a11y.spec.ts` covers them) and a VoiceOver listen-through.
## Analyst Data platform page (EXP-13)
- `analyst-pages/*.js` holds Analyst pages we own; `build.py` appends them after the prototype pages. `10_data_platform.js` adds Platform > Data platform.
- It shows the Fabric dashboard clip or screenshot (`shared/fabric-dashboard.mp4` / `.png`) and the Databricks model card (`shared/model-card.json`). Each block says **Planned** and names its ticket (DAT-8, DAT-6) until the file exists. Fabric is labelled paused after filming.
- Test: `tests/e2e/analyst.spec.ts`.

## Data Scientist page uses the agent api (AGT-14, task 139)
- `analyst-pages/20_ds_agent.js` wraps the prototype's `d2_agAsk`/`d2_agDraw`. With an api configured (`window.parent.MATCHCAST_API`) the question goes to `POST /v1/ds/ask`; a verified answer shows its table, a bar chart drawn from the rows and the SQL. Any other verdict shows the api's text and no chart ("Could not verify this result."). If the api is silent or errors, the in-page rules answer and the chip says "Data Scientist · rules".
- Tests: the three `data scientist:` cases in `tests/e2e/analyst.spec.ts`.

## Analyst accessibility (EXP-14)
- `analyst-pages/00_a11y.js` sets `lang`, redefines the light-theme `--good`/`--warn` tokens (the dark theme keeps its own) and darkens club crests that failed WCAG AA contrast, names unlabelled chart SVGs and makes `#main` keyboard-focusable. It exists because `sources/` is read only.
- `tests/e2e/a11y-analyst.spec.ts` runs axe (WCAG 2 A/AA) on 13 Analyst pages in both the light and dark scheme and fails on any serious or critical violation (minor and moderate are not checked). Uses `@axe-core/playwright` (dev dependency). Watch and Broadcast are still to audit.
## Copilot Ask answered by the agents (EXP-5)
A question typed in Watch's Copilot Ask tab goes to the shell (the suggested chips still use Watch's own live-data answers). With the api live, the shell posts it to `POST /v1/matches/{id}/ask` and shows the answer with its verdict. Otherwise the in-page rules answer from the event log: who has the most shots or goals, the score, xG, each counted from the log with the events cited and a "Verified" tick; anything else gets "I can't confirm that from the match data yet." Questions are cut at 300 characters and limited to 5 a minute per browser. Planned: Prompt Shields on input and the knowledge-base route (AGT-12, AGT-16), which live in the api.

## Full-time recap in the Analyst library (AGT-15, task 105)
- At full time the shell adds `recap: { api, session_id, match_id }` to the import message it sends the Analyst (only when Watch is the source and an api is configured; `LV.key` exposes the run's key). `embed/analyst.js` stores it on the imported match.
- `analyst-pages/30_recap.js` wraps the Match centre page: for such a match it shows a Full-time recap card from `GET /v1/matches/{id}/recap/analyst`, polling every 5 s for a minute ("Being written by the agents…"), then "Planned: not ready". It shows only the sentences whose verdict is `verified` (the rest are counted as "unverified hidden", never displayed; none verified means no recap text; the word count is recomputed from the shown sentences), and "Rules fallback" when the api's mode is `rules`. Recorded season matches have no recap card. Watch and Broadcast recap cards belong to their lanes.

## Instant replay (Broadcast)
- `embed/replay.js` (appended after `broadcast.js` by `build.py`) keeps the last 60 s of Watch's frames in Broadcast. The "Instant replay" bar on the live view plays back the last 10, 20 or 30 s at normal or half speed, with a red REPLAY tag and a Back to live button; it returns to live by itself at the end.
- Only player and ball positions are replayed. Clock, score and stats stay live, events and agent lines are not replayed, and Watch keeps running underneath. The buttons stay disabled until two frames are buffered. The buffer is in the page, so it is empty after a reload. Test: `tests/e2e/replay.spec.ts`.
- The desk's CSS hides every direct child of `body` except `#bc`, `#stage` and `#load`, so overlays for Broadcast must be appended inside `#bc-view`.

## Vision accuracy in the Tracking lab (DAT-11, tasks 274 and 278)
- The prototype tracker (`autoevent.js`, the 👁 Vision button) already runs inside the Watch build: it reads the 640-wide broadcast render (the canvas is 640x316 in practice, not 640x360 as doc 09 says) at about 5 Hz, and its scorer compares the result with engine truth.
- While Vision is on, `embed/watch.js` posts `visReport()` to the shell every 5 s. The shell keeps the latest report (`M.vision`) and forwards it to the Analyst, which shows it at the top of Data science > Tracking lab (`analyst-pages/40_vision.js`): recall, precision, position error, glyph-reader identity, passes, ball, speed.
- Identity with Azure AI Vision Read OCR as a second opinion, the crop queue and the `/vision/identify` api are **Planned** (tasks 275 and 277); the panel says so.
- Tests: `tracking lab:` and `vision on in Watch reaches the Tracking lab` in `tests/e2e/analyst.spec.ts`.

## Talk by voice (EXP-16)
Ask the producer in Broadcast has a hold-to-talk mic (`MCS.ptt` in `embed/hook.js`): hold, speak, release and the words fill the box and submit it; Space or Enter on the focused button works too, and typing always works. Watch's talk-to-player already had a mic. Both use the browser's speech recognition (the button is disabled where the browser has none). Orders that change play are labelled "Game mode" in Watch and never touch the event record behind the claims. Planned, all needing the api: the Speech token endpoint with the Azure Speech SDK, the `/talk` role agents with Verifier and Content Safety, and a spoken reply from the api's voices. No Speech key is ever placed in the page.

## On-air log (AB#362)
- On-air log (`embed/onair.js`): every line that reached air is logged; "Export on-air JSON" saves `matchcast.onair/1` (id, minute, text, alert, verdict; marked simulated) and shows the file's SHA-256. Pending and killed lines are never in it. Test: `tests/e2e/onair.spec.ts`.

## Broadcast overlay layout
- The replay bar, on-air log, lower-third and teleprompter sit inside the live view. Below 560 px wide they stack (teleprompter on one line at the top, replay bar under it, lower-third and on-air log at the bottom) so none cover each other. `tests/e2e/broadcast-layout.spec.ts` checks the four boxes for overlap on a desktop and a phone viewport.

## Fast first load (EXP-15)
- Only Watch loads at first; Broadcast and Analyst load on first switch (`tests/e2e/load.spec.ts`: no request to `analyst/` while only Watch runs). Compression, cache headers and the file list of the web image are in `nginx.conf` and the Dockerfile (PLT-7, `tests/test_web_image.py`).
- Timings (headless Chromium, software WebGL, cache off, local server, 22 Oct): season picker 0.7 s, Watch started 11 s, Analyst ready 21 s, Broadcast ready 56 s. Software rendering is far slower than a real GPU, so the 4 s target is **not yet measured**; it needs the live URL with the api warm. `load.spec.ts` records these marks as a test annotation on every run.

## Loading states and where Watch's start time goes (EXP-15)
- Profile of Watch alone (headless Chromium, SwiftShader software WebGL, cache off, local server, 22 Oct, ~10 s to kick-off): about 9.3 s is native work (`(program)`: software shader compile and rasterising), about 1.5 s is our JavaScript (`paintPitch` 0.5 s of grass noise, `glbFrom` 0.36 s decoding the player model, three.js first-use shader setup 0.5 s). Network is under 0.1 s locally; on the wire `players.json` is 5.8 MB raw (2.6 MB gzip, pre-compressed by the web image) and three.js 1.3 MB raw. So the JS and network share is a couple of seconds and the rest depends on the GPU: a real browser with hardware WebGL should be far faster than this sandbox, but that is **not yet measured**; the 4 s target needs the live URL on a real machine.
- Only Watch is loaded at first (one iframe); Broadcast and Analyst are created on first switch.
- The shell now says what is happening: with no WebGL, Watch and Broadcast show "This view needs WebGL" at once (Analyst and Agents still work); a view still loading after 25 s shows a note and a "Reload this view" button. Test: `tests/e2e/loading-states.spec.ts`.
- Ideas not done (visual risk, in the prototype source): fewer grass-noise specks in `paintPitch`, decode the player model off the main thread.

## Server translations (EXP-17, api PR 118)
When the api sends `variants: {es|hi: text}` on a publication (only after its own number, name and citation re-check), `agents.js` ingest stores it as that language's translation (`api: true`, shown as "Translated by Azure AI Translator") and Watch renders it as text. A language the api did not send keeps the rules-template line, so nothing changes until Platform sets `TRANSLATOR_ENDPOINT`. Test: the `api variants` case in `tests/e2e/language.spec.ts`.
