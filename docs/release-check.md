# Release check

Status: **Draft**. Owner: Quality lane. Run it logged out, in a fresh browser profile, before filming (26 Oct) and on 27 Oct before submitting. Record the date, the commit and who ran it at the bottom. A step that fails blocks the release; fix it or write the reason next to it.

Automated cover: `make e2e` (Chromium) and `make e2e-live E2E_BASE_URL=<deployed url>` run most of the judge path. This list is what they cannot check.

## Judge path (live URL, logged out)

| # | Step | Pass when | Automated by |
| --- | --- | --- | --- |
| 1 | Open the web URL cold | Shell loads, season picker has 28 fixtures, Watch kicks off within 4 s of the engine loading | `load.spec.ts`, `live.spec.ts @live` (shell, `/health`, `/ready`, `/v1/status` labels, producer gate returns 401) |
| 2 | Watch for one goal | A Match Pulse card appears with a green tick; Casual and Analyst modes read differently | `pulse.spec.ts` |
| 3 | Open "Why?" and the trace panel | Cited events and each agent's step are listed | `watch.spec.ts` (EXP-6) |
| 4 | Switch to Spanish | Numbers and names are unchanged | `language.spec.ts` (QUA-9) |
| 5 | Open Broadcast | Same score as Watch; lower-third appears only after approval in producer mode | `broadcast.spec.ts` (QUA-2) |
| 6 | Open Analyst | Ledger fills; "Chain intact"; export shows a hash | `analyst.spec.ts` (QUA-3) |
| 7 | Stop the api (Mac mini or portal) and reload | Pill reads "Rules fallback", lines keep coming | `connection.spec.ts` |
| 8 | Every label | "Simulated" or "Planned" wherever an Azure service is not connected | Manual |

## Manual-only checks

- [ ] Voice: commentary is audible in Chrome and in Safari (webkit project on the Mac mini).
- [x] Phone width (390 px): no horizontal scroll in any view. Automated: `watch-mobile`, `broadcast-mobile`, `analyst-mobile` and `unified.spec.ts` assert no horizontal overflow; keep a manual look on a real phone.
- [ ] Lighthouse accessibility score for each view is recorded. 23 Oct, Lighthouse 12.2.1 against the deployed web: shell 1.00, Analyst page 0.98 (`heading-order`). Watch and Broadcast cannot be scored on their own page (they need the shell's frames), so axe inside the shell covers them (`a11y*.spec.ts`). Re-run on 26 Oct from a clean checkout and attach the numbers.
- [ ] VoiceOver walk through Watch (Tab order, Esc closes the trace).
- [ ] Fabric capacity is paused or in its planned state; Databricks job last run is recorded.
- [ ] `scripts/cost_today.sh` shows spend under the plan targets.
- [ ] Repo is public with the MIT licence, README credits third-party assets and data, no secrets (`gitleaks` green on full history).
- [ ] Video is public, under 2 minutes, and matches `docs/video-script.md`.

## Run log

| Date | Commit | Run by | Result | Notes |
| --- | --- | --- | --- | --- |
| 22 Oct | b914ad0 | Quality lane (local, Actions down) | checks, openapi, full e2e pass | gitleaks and az not installed on this machine, so secrets and bicep not run |
| 23 Oct | main 98879f5 | Quality lane, `make e2e-live` | `live.spec.ts` 4 passed against the deployed web and api | `/v1/status` on the deployed api: 5 live, 2 simulated (Foundry agents, Event Hubs), 4 planned (Content Safety, AI Search, Fabric, Databricks), 0 unavailable |

## Broadcast coverage (QUA-2)

There is no separate `broadcast.spec.ts`; loading a second cold Broadcast costs minutes of CI, so its checks live in the specs that already have it loaded:

| QUA-2 check | Spec |
| --- | --- |
| Same score as Watch | `cross-view.spec.ts`, `unified.spec.ts` (scoreboard test) |
| Lower-third only after approval in producer mode, then airs at once in demo mode | `approval.spec.ts` |
| Red-card alert on air with a verified line | `approval.spec.ts` |
| Captions show for verified lines | `voice.spec.ts` |

**Deliberate-break proof (22 Oct, b914ad0):** with `agents.js` line 157 changed so producer mode no longer queues lines for approval, `approval.spec.ts` failed both tests (`approval queue: approve, wrong-number edit rejected, kill never airs…` at line 18 and `lower-third waits for approval in producer mode…` at line 49, "the lower-third is hidden before approval"). The change was reverted; nothing from it is committed.
