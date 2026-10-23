# Pipeline audit: the five challenge stages

Audit date 22 Oct 2026, Agents lane. Method: `make judge-path` locally, then a read of the code path behind each stage, a persona comparison on a seeded match, and a check that each on-screen insight can be traced to a Verifier verdict. Where a claim needs a test, the test is named. Anything not really working is called out as a gap.

## Summary

| Stage | Works for a judge today | Weakest point | Owner of fix |
| --- | --- | --- | --- |
| (a) Ingest synthetic events live | Yes: events stream into the page and the engine | The UI posts only goal and shot events to the API, so the server never sees passes, pressures, tackles, fouls or cards | Experience (handed off) |
| (b) Interpret into stats, patterns, context | Yes: counts, xG and Match Pulse | Server metrics lacked passes, pressures and possession changes | Agents (fixed here) |
| (c) Explain why a moment matters | Partly | Goal lines said what happened, not why it matters | Agents (fixed here) |
| (d) Render alongside the match | Yes: Watch, Analyst and Broadcast views | Insight cards do not say whether the server Verifier checked them | Experience (handed off) |
| (e) Personalise | Yes: personas and watch modes | Watch-mode lines exist only for moments after the stream opens; `club:<display name>` was refused | Agents (fixed here) and Experience |

## (a) Ingest synthetic events live

- **A judge sees:** the match plays, the event ticker and counters move as passes, tackles and shots happen.
- **Where:** Watch view (`apps/unified`), live feed and Match Pulse.
- **Code path:** simulator events, `apps/unified/live.js` batches to `POST /v1/matches/{id}/events`, `services/api/app/matches.py` validates against the contract and applies `matchcast_agents.state.apply`, then the Producer decides which events become moments.
- **Test:** `tests/test_api_pipeline.py`, `tests/test_api_matches.py`, `packages/agents/tests/test_workflow.py`.
- **Weakest point:** `live.js` posts only goal and shot events. Server statistics, claims and lines therefore cover a thin slice of the log. Fix: Experience posts every contract event type (message sent). The API accepts all types already.

## (b) Interpret into stats, patterns and context

- **A judge sees:** shots, shots on target, tackles, fouls, cards, xG, and now passes, pressures and possession won, per team, each as a claim with a source range.
- **Where:** Analyst view, Ask panel (`/ask`), claims table, Match Pulse.
- **Code path:** `state.py` reducer (`COUNTED`, `counted()`), `rules/analyst.py` builds claims, `xg.py` for xG, `ask/assistant.py` live metrics.
- **Test:** `packages/agents/tests/test_verifier.py` (recount), `test_narrator_context.py::test_passes_pressures_and_possession_are_counted_and_recounted`, `test_ask.py`.
- **Weakest point (fixed):** the server could not count passes, pressures or possession changes, so "how many passes" got no answer. They are now counted by the same reducer the Verifier recounts with, and the Ask router answers them (one-metric watch mode does not offer them yet: no moment carries those claims, so it would stay silent; **Planned**). Older checkpoints without those keys still load (`test_an_old_checkpoint_without_the_new_keys_still_counts`).

## (c) Explain why a moment matters

- **A judge sees:** after a goal, a line that says what it means for the match: "It opens the scoring", "It levels the match", "<club> take the lead", "<club> stretch their lead", "<club> are back in it". A red card says the side is a player short.
- **Where:** the on-air line, the approval queue, the Broadcast teleprompter.
- **Code path:** `rules/narrator.py` `goal_context()` reads only the two goal claims, so it adds no new number to verify. The model-mode prompt (`prompts/narrator.md` rule 6) asks for the same clause.
- **Test:** `packages/agents/tests/test_narrator_context.py`.
- **Weakest point (fixed):** before this change a goal line only restated the score. Shots on target, yellow cards and red cards now carry a consequence clause too (words only, no number the Verifier would have to tie to a claim); tackles and fouls still explain by metric only.

## (d) Render insight on screen alongside the match

- **A judge sees:** the match with Watch, Analyst and Broadcast views, lines on air, Match Pulse cards, trace and audit.
- **Where:** top-bar switcher (keys 1, 2, 3).
- **Code path:** `GET /v1/matches/{id}/stream` (SSE `state`, `claim`, `line`, `publication`, `audit`), Producer approval before air (`POST /v1/lines/{id}/approve`).
- **Test:** `tests/e2e/unified.spec.ts`, `onair.spec.ts`, `approval.spec.ts`, `pulse.spec.ts`; API side `tests/test_api_pipeline.py`.
- **Weakest point:** some on-screen insights come from the in-page rules pipeline (`agents.js`), not the API. Those are not checked by the server Verifier. Server lines always are: a line reaches `publication` only after `verdict == verified` (model lines need review first). Fix: Experience labels each card "API-Verified" or "In-page (Simulated)" (message sent).

### Is every on-screen insight Verifier-checked?

- API path: yes. `MatchWorkflow` never publishes a line without a Verifier verdict; a rejection is repaired once or abstains and is audited. Tested in `test_workflow.py` and `tests/test_api_pipeline.py`.
- In-page path: the page has its own client-side checks but they are not the server Verifier. That is the gap above; until the label ships treat those cards as Simulated.
- Translations: a translated variant is shown only after the number and name re-check passes (`test_translate.py`).

## (e) Personalise

- **A judge sees:** Casual, Analyst and Broadcast voices; watch modes My club, Player focus, One metric; EN/ES/HI.
- **Where:** persona picker and watch-mode controls in Watch; Ask and recap by persona.
- **Code path:** `personas.py` (limits, aliases, `normalise`, `add_persona`), `rules/narrator.py` per-persona text, `ask/assistant.py`.
- **Test:** `test_personas.py`, `test_workflow.py`, `test_narrator_context.py::test_published_goal_lines_explain_and_differ_by_persona`, `test_ask.py`.

### Do personas differ in substance, not wording?

Compared on the same seeded goal moment:

- **Casual:** plain words, one number at most, names the scorer and the effect ("It opens the scoring").
- **Analyst:** names the metric and both team values ("Score: Northgate FC 1, Harbour United 0"), up to six numbers, the match-state label.
- **Broadcast:** broadcaster tone, two numbers, calls the moment.
- **My club:** says what the moment means for the chosen club only.
- **Player focus:** silent unless the moment is about that player.
- **One metric:** quotes only that metric, nothing else.

So the information carried differs (which numbers, which entities, whether a line appears at all), not only the phrasing. Weak spot: Casual and Broadcast share the same underlying claims, so they differ mostly in length, tone and number budget.

- **Weakest points:** (1) watch-mode lines exist only from the moment the stream opens (no back-fill; documented in 12-api.md §3). (2) `club:<display name>` returned 422 and only the slug worked. Fixed in `normalise` (`test_club_watch_accepts_the_display_name_or_the_slug`).

## Weakest three gaps and what was done

1. UI ingest sends only goals and shots: handed to Experience.
2. In-page insights not API-Verified and unlabelled: handed to Experience (label required).
3. No "why it matters" and missing passes, pressures, possession metrics: fixed in this PR with tests.
