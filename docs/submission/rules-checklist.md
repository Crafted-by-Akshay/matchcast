# Official Rules → evidence checklist

Source: the Official Rules at <https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md> (read 22 Oct 2026). Status: **Draft**, owner Platform lane. Update the Status column at each release check (`docs/release-check.md`) and on 27 Oct before submitting. Dates are Pacific Time.

Status values: **Done** (evidence exists in the repo), **Pending** (needs a deploy, a recording or an Akshay action), **Akshay** (only the entrant can do or confirm it).

## Dates (§1)

| Date | What | Status |
| --- | --- | --- |
| 27 Oct 11:59 pm | Submission closes. Demo video, GitHub URL, description and a working link must be on the Hackathon Website by then | Pending |
| 27 Oct – 10 Nov 11:59 pm | Judging. The Project must stay available free of charge and without restriction (§4.8), so Azure runs until 10 Nov (`docs/runbook-shutdown.md`: tear down on 11 Nov) | Pending |
| by 20 Nov | Winners announced | n/a |

## Entry and eligibility (§3, §4, §4.10)

| Requirement | Evidence | Status |
| --- | --- | --- |
| Registered on the Hackathon Website (registration closed 20 Oct, 12:00 pm) | Akshay registered 17 Oct | Done (Akshay to re-confirm) |
| Eligibility under §3 (age, residence, employer exclusions) | Not checkable from the repo | Akshay |
| One Representative submits for a team | Akshay is the sole entrant | Akshay |
| Submission entered on the Projects page with every required field | See "Devpost fields" below | Pending |

## The challenge (§4.1)

| Requirement | Where it is shown | Status |
| --- | --- | --- |
| (a) Ingest synthetic events as they happen | Seeded simulator and `matchcast.event/1` contract (`docs/architecture/06-simulation.md`, `packages/contracts`); `scripts/replay_match.py` replays a match at 1x/4x; api `POST /v1/matches/{id}/events`; Event Hubs mode `MATCHCAST_PIPELINE=eventhubs` (written, **not run against a real hub**) | Done locally; hub Pending |
| (b) Interpret into stats, patterns, context | `packages/metrics` (xG, indices), reducer `services/worker`, `docs/metrics.md` | Done |
| (c) Explain why a moment matters | Analyst claims with cited events, Match Pulse, Why? and trace panel (`docs/architecture/04-agents.md`) | Done |
| (d) Render alongside the match | Watch, Analyst, Broadcast views (`apps/unified`) | Done |
| (e) Personalise: analyst vs casual fan | Watch modes (Casual, Analyst, My club, Player focus, One metric), favourites, persona streams | Done in the browser; check the live URL |
| Player identification, name tags | Name tags and player focus in Watch | Done (verify at release) |
| Pass quality, speed metrics | `packages/metrics`, Analyst view | Verify exact set before the video |
| Auto-eventing from video | Vision identification route is a second opinion on shirt numbers, not an event generator | Planned: label it so |
| Narrative generation and recaps | Narrator lines; automated full-time recap function (`services/recap`) | Done locally; function **not deployed** |
| Explainability (control vs chaos, pressure, rhythm) | Match Pulse and Analyst panels | Verify wording at release |
| Data innovation: synthetic datasets | Season export (`scripts/export_season.py`) and replay converter now. The seeded simulator, `docs/simulator.md`, `docs/dataset-card.md`, `scripts/check_realism.py` and `data/calibration/targets.json` are on the Data lane's PR #47, **not on main yet** | Pending #47 |
| Multi-language storytelling | Spanish and Hindi through Azure AI Translator, Verifier re-checks numbers and names (`docs/architecture/10-voice-and-translation.md`). Infra written in Bicep, **not provisioned or called against Azure**; no client reads the variants yet | Pending: do not claim until the live URL shows it |

## Categories (§4.2)

Target: **Best Multi-Agent System Prize** (one category prize per entrant), also competing for the Grand Prize.

| Criterion in the rules | Evidence |
| --- | --- |
| Specialised agents with distinct roles | Producer, Analyst, Narrator, Verifier (`docs/architecture/04-agents.md`) |
| Coordinate through shared state and handoffs | Workflow with shared match state and an audit trail; trace panel shows each step |
| Recover from failures | Verifier rejects and repairs once; rules fallback when the model fails (`connection.spec.ts`); failure drills in `docs/runbook-failure-drills.md` |
| An outcome a single agent could not match | Single agent vs four agents on fixed moments (`docs/eval/agents-eval.md`, `eval/`): **numbers only after the model quota arrives and the eval runs**; do not quote a number until it exists |
| Orchestration approach | Microsoft Agent Framework graph (`packages/agents`, `test_af_graph.py`); GitHub Copilot Agent Mode with the MCP server (PLT-11 evidence pending) |

## Submission requirements (§4.4)

| Requirement | Evidence | Status |
| --- | --- | --- |
| Newly built Project (§4.3: created after registration opened 29 Sep) | Work began 17 Oct (project notes); `main`'s history starts 22 Oct with PR #5, earlier prototypes are not in this repo | Akshay to confirm no code predates 29 Sep |
| Pitch: what you built, which Microsoft and Azure technologies, what it does, what problem it solves | `docs/submission/devpost.md` | Draft, update after deploy |
| Demo video under 2 minutes, public URL on YouTube, Vimeo, Facebook Video or Youku, showing the Project running on its platform | `docs/video-script.md`, `docs/submission/shot-list.md`; shots come from `make judge-path` and the live URL | Pending: record 26 Oct |
| No third-party trademarks or copyrighted music in the video | Fictional brands only, no music, or a CC0 track with the licence in the README | Pending |
| Public GitHub repository URL | `Crafted-by-Akshay/matchcast`; must be public at submission | Akshay (visibility) |
| Not a winner of another contest | n/a | Akshay |
| No obscene, offensive, political or harmful content | Synthetic football only | Done |

## Other rules

| Rule | Evidence | Status |
| --- | --- | --- |
| §4.5 Multiple submissions must differ | One submission | Done |
| §4.6, §4.11 Original work, owned by the entrant, open source used within its licence | MIT `LICENSE`; README credits three.js, MakeHuman (CC0) and data sources; CC0 assets only; no Mixamo | Done; keep README credits current |
| §4.7 Synthetic, football-realistic data; sourced footage cleared | Synthetic only. Calibration uses aggregate stats from CC0/CC BY sources (targets file with licences, arrives with #47) | Done |
| §4.8 Working link for judges, free, no login or with credentials in the instructions, until judging ends 10 Nov | Needs the deployed web URL and a README "Try it". Easy Auth allows anonymous access (`AllowAnonymous`) | Pending (deploy) |
| §4.9 English materials | All docs and the video are English; Spanish and Hindi only as product output | Done |
| §4.12 No financial or preferential support from the Sponsor (Microsoft) | Azure is paid for by the entrant within a $100 cap. **Do not use credits, sponsorships or Microsoft-provided funding or licences.** Akshay was weighing the Azure free account ($200 credit): decide with §4.12 in mind | Akshay |
| §5 Changes after the deadline only for IP or PII problems | `gitleaks` on full history is clean; synthetic names only | Done |

## Judging criteria (§6.2, 20% each)

| Criterion | What judges look for | Our evidence |
| --- | --- | --- |
| Technological Implementation | Creative synthetic data, quality practices, hero technologies, structured and documented code | Seeded simulator and realism check; tests per lane, contract drift check, ADRs, security scan; Foundry, Agent Framework, MCP, Container Apps, Event Hubs, Table/Blob, Speech, Translator, AI Search in Bicep. Mark anything not provisioned as **Planned** |
| Agentic Design & Innovation | Orchestration, MCP, multi-agent collaboration, novelty | Four agents with a Verifier that recounts from the event log; MCP server; audit chain |
| Real-World Impact & Applicability | Significance, production readiness, impact | Studio and broadcast roles, approval before air, audit chain, runbooks, `docs/architecture/13` and `14`; failure drills (two observed, the Azure ones not run) |
| User Experience & Presentation | Intuitive UX, video value, frontend/backend balance | Three views, loading and offline states, accessibility specs, the video |
| Adherence to Category | Matches the Multi-Agent description | Table under "Categories" |

Stage One (§6.1) is pass/fail: the Project reasonably fits the theme and applies the featured technologies.

## Devpost fields to prepare

Project name, elevator pitch (`devpost.md`), built-with list, demo video URL, repo URL, live demo URL, testing instructions (no login needed; "Try it" steps), images (architecture diagram, Watch, Analyst, Broadcast), category selection (Multi-Agent), and the team Representative.
