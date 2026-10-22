# Release check

Status: **Draft**. Owner: Quality lane. Run it logged out, in a fresh browser profile, before filming (26 Oct) and on 27 Oct before submitting. Record the date, the commit and who ran it at the bottom. A step that fails blocks the release; fix it or write the reason next to it.

Automated cover: `make e2e` (Chromium) and `make e2e-live E2E_BASE_URL=<deployed url>` run most of the judge path. This list is what they cannot check.

## Judge path (live URL, logged out)

| # | Step | Pass when | Automated by |
| --- | --- | --- | --- |
| 1 | Open the web URL cold | Shell loads, season picker has 28 fixtures, Watch kicks off within 4 s of the engine loading | `load.spec.ts`, `timing.spec.ts @live` (QUA-9) |
| 2 | Watch for one goal | A Match Pulse card appears with a green tick; Casual and Analyst modes read differently | `pulse.spec.ts` |
| 3 | Open "Why?" and the trace panel | Cited events and each agent's step are listed | `watch.spec.ts` (EXP-6) |
| 4 | Switch to Spanish | Numbers and names are unchanged | `language.spec.ts` (QUA-9) |
| 5 | Open Broadcast | Same score as Watch; lower-third appears only after approval in producer mode | `broadcast.spec.ts` (QUA-2) |
| 6 | Open Analyst | Ledger fills; "Chain intact"; export shows a hash | `analyst.spec.ts` (QUA-3) |
| 7 | Stop the api (Mac mini or portal) and reload | Pill reads "Rules fallback", lines keep coming | `connection.spec.ts` |
| 8 | Every label | "Simulated" or "Planned" wherever an Azure service is not connected | Manual |

## Manual-only checks

- [ ] Voice: commentary is audible in Chrome and in Safari (webkit project on the Mac mini).
- [ ] Phone width (390 px): no horizontal scroll in any view.
- [ ] Lighthouse accessibility score for each view is recorded (screenshot attached to the PR).
- [ ] VoiceOver walk through Watch (Tab order, Esc closes the trace).
- [ ] Fabric capacity is paused or in its planned state; Databricks job last run is recorded.
- [ ] `scripts/cost_today.sh` shows spend under the plan targets.
- [ ] Repo is public with the MIT licence, README credits third-party assets and data, no secrets (`gitleaks` green on full history).
- [ ] Video is public, under 2 minutes, and matches `docs/video-script.md`.

## Run log

| Date | Commit | Run by | Result | Notes |
| --- | --- | --- | --- | --- |
