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

## One match source (EXP-2)
- Watch is the only engine. Four times a second it sends the pitch state (22 players' positions, velocities and headings, the ball, score, clock, pause, speed and stats) and the shell forwards it to Broadcast, along with Watch's events.
- Broadcast runs in consumer mode (`window.MC_CONSUMER`, `consumerStep` in `embed/broadcast.js`, patched into `stepSim` by `build.py`): it moves its players and ball toward the latest frame, takes the score, minute, half and stats from it, and replays Watch's events onto its own event bus. Its desk modules (odds, calls, focus board, lower-thirds) read that. Its own play and pause buttons are disabled; Watch's controls drive the match.
- The Analyst's live pill shows the same score and minute and lists the last five events in its tooltip.
- Known gaps: Broadcast shows running and positioning but not kick, tackle or fall animations (the frames carry no action state); the Analyst's season pages are still recorded runs, only the live pill follows Watch.
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
- Agents tab, Approval queue: **Demo** mode airs verified Broadcast lines at once. **Producer** mode holds each one until a person approves, edits or kills it. The signed-in producer is a simulated account (Planned: Entra ID).
- Broadcast shows an approved line as a lower-third for 8 seconds and keeps the last five in the teleprompter list. A pending or killed line reaches no view, including Watch's Match Pulse.
- Edit is re-verified: every number in the new text must already be in the verified line (or its minute), otherwise it is rejected and not aired. Approve, edit and kill each write `line_approved`, `line_edited` or `line_killed` to the audit chain with the person's name.

## Wild-moment alerts (EXP-9)
A red card or turning point is a deterministic trigger. The Producer marks that claim priority 1, it follows the normal Verifier path and the approval queue, and Broadcast shows it as a red "ALERT · … · verified" lower-third. Alerts sort first in the approval queue. Win-probability swings and goals against the run of play need the prediction stream and are Planned.
