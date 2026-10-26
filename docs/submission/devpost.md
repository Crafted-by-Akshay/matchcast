# Devpost submission text

Status: **Draft**, truth pass of 26 Oct against `main` and the deployed api's `/v1/status`. Fill the video URL and re-read against `docs/release-check.md` on 27 Oct. Where a part is not live it says so, and the final text keeps each "Simulated" or "Planned" note until the live URL proves otherwise.

## Project name
MatchCast

## Elevator pitch (what you built, which technologies, what it does, what problem it solves)

Football data is everywhere; explanations are not. MatchCast is an AI production crew for a live football broadcast. Four agents with distinct roles (Producer, Analyst, Narrator, Verifier) read each synthetic match event, and on a goal or a red card the crew spawns up to five specialists in parallel (replay, tactics, stats, rhythm, head-to-head history), each reporting findings with the event ids they rest on. The Verifier recounts every number from the stored event log, tries five ways to falsify the line, sends a failed line back for one repair and holds or drops it if the repair fails, so nothing that fails its checks airs. The same moment reads differently for a data-hungry analyst, a casual fan and a producer. In producer mode the two booth voices (play-by-play and colour) wait for one producer's approval after the Verifier; the derived feeds never wait, they air once verified or are dropped.

Built on Microsoft Foundry with the Microsoft Agent Framework for the agent workflow, an MCP tool server for verified match facts (Planned: a recorded run of GitHub Copilot Agent Mode calling it), Azure Container Apps, Table and Blob Storage, Azure AI Speech, Azure AI Translator, Azure AI Search, Azure AI Vision and Azure AI Content Safety (Event Hubs is in the Bicep; the live site runs an in-process stream, labelled Simulated), defined as Bicep and deployed with `azd` from `scripts/deploy_cloud.sh` (the GitHub Actions workflows are manual-only, to save cost; no keys in the repo, the services use managed identity). The teams are real national teams with real past results as reference facts (CC0); every player and every match event is fictional and comes from our own seeded simulator.

## Customer and problem

The customer is a rights holder that sells the same match to dozens of markets, with a small production team behind it. Every feed needs on-screen stats and commentary in its own language, and that team cannot double-check every number live. A single model that writes fluent text can also write a wrong score.

MatchCast gives that team a production crew of AI agents on Microsoft Foundry. The agents pick the moments, write the line for each audience and language, and a separate Verifier recounts every number from the raw event log before the line can go on screen. In producer mode the booth's play-by-play and colour lines wait for one producer's approval after the Verifier passes them; a booth line that fails its one repair waits flagged as escalated, where the producer can only kill it. The derived feeds never wait. Casual, analyst and catch-me-up are on the Watch screen today; the news ticker and audio description air on the api and show on the producer's six-up feed monitor, with a Planned tag on Watch until viewers see them; the half-time explainer is written and verified but not aired yet (Planned). Each line keeps an audit record in a hash chain.

The api translates verified English lines into ten feed languages (English, Spanish, Portuguese, Hindi, Arabic, French, German, Indonesian, Japanese, Chinese) with Azure AI Translator, and a deterministic re-check of numbers, names and neutral wording runs on each translation; a line that fails stays English and says so (ADR-0011, ADR-0023). One language picker in the header switches the whole app. Checked lines are voiced in English, Spanish, Portuguese and Hindi; the Arabic voice is Planned. Translator and Speech are live on the api (`/v1/status`, 26 Oct); the Broadcast desk's own Spanish and Hindi script templates and its Speak button are rules templates and a browser voice, labelled Simulated.

What the Verifier catches, measured: in the offline evaluation (`docs/eval/agents-eval.md`, rules agents on one frozen match) it caught 99.3% of 151 planted errors, each rejected for the right reason, with 0 false rejects on 34 honest lines; the seeded bad claim was caught 7 times out of 7 and no wrong claim reached a screen. That is the floor every model-written line is checked against, not a claim about model quality.

Live on Foundry (25 Oct, gpt-5-mini, `docs/eval/agents-eval-live.md`, a smaller replay of 14 verified lines): seeded bad claim caught 7 of 7 with 0 wrong claims shown, and 100% of 58 planted errors caught for the right reason. Ask, which has no model, answered 40 of 40 and stopped all 20 red-team prompts, as offline. Weak spots in the same run: 46.2% of 26 honest lines were rejected (the Verifier errs towards holding a line), so only 4 of 22 moments got a live line end to end (14 of 22 on rules), with no wrong line aired; 83.3% of 18 Narrator first drafts stayed inside their claims and the roster; 3 model calls fell back to the rules. A re-run after the crew deploy will replace these numbers; until it is recorded, these are the live numbers we quote.

Resilience, shown on screen: the Agents tab's **Cut the model** button cuts one match's model mid-match. Each agent's rules twin takes over (ADR-0014), the status pill reads rules fallback, the lines keep coming and every fallback is audited; **Restore the model** brings the model back after the circuit breaker's 30 s. The header's **Event → on air** pill shows the measured median time from a Watch event to the verified line arriving in the browser.

Evidence: we have not yet run this with a rights holder. The team above is a design target, not a named customer or pilot. We will say so in the video and the README rather than claim one.

## What is real today (26 Oct) and what is not

- **Live** at https://ca-web-matchcast-dev.calmbay-045566e2.eastus2.azurecontainerapps.io (api `/v1/status` lists each part): the four agents on Foundry gpt-5-mini through the Agent Framework graph, with rules twins that take over if a call fails; the Stats Desk partner agent over A2A; Table Storage; Azure AI Speech, Translator, Vision, Content Safety and Search; Entra sign-in on the producer routes.
- **In the app**: Watch, Analyst and Broadcast views on one match; the Crew pill and Agents tab with the spawn tree and the three-arm scoreboard (full crew, single agent, crew without the Verifier) graded against the simulator's truth, rules-only and labelled so; the failure drill; the Event → on air pill; the six-up feed monitor on the desk; catch-me-up on request in the viewer's language.
- **Simulated**: Event Hubs (an in-process stream on the live site); the desk's script templates and browser voice; analyst panels without a recounted source, each labelled.
- **Planned**: the half-time explainer as an aired feed; the ticker and audio description on the Watch screen; a model adversary for claims the rules cannot recount (every metric has a rules recount today); the Arabic voice; Microsoft Fabric and Azure Databricks season jobs; video auto-eventing.

## Built with
Microsoft Foundry, Microsoft Agent Framework, Model Context Protocol, Azure Container Apps, Azure Event Hubs, Azure Table and Blob Storage, Azure AI Speech, Azure AI Translator, Azure AI Search, Azure Key Vault, Application Insights, Bicep, azd, Python (FastAPI), JavaScript, three.js, Playwright.

## How to try it (testing instructions, §4.8)

No login is needed.
1. Open [live demo URL].
2. Watch view: the match starts on load. Pick Casual or Analyst in the Feed picker and read the same moment two ways; pick a language in the header.
3. Press Why? on a line to see the claim and its cited events; open the trace panel to see each agent's step.
4. Crew pill (Agents tab): on a goal, the spawn tree shows the specialists the crew ran; the scoreboard grades the full crew against a single agent and against the crew without its Verifier.
5. Agents tab, Seed a bad claim: the Verifier rejects the wrong number and repairs it from the raw log. Then **Cut the model**: the rules twins take over and the lines keep coming.
6. Broadcast view: the six-up feed monitor, and in producer mode approve a booth line and watch it go on air.
7. Locally without any cloud account: `make judge-path` (boots the api and the app and proves the flow), then the README's "Run locally".

## Demo video
[public video URL]. Under two minutes; script in `docs/video-script.md`. (`docs/submission/shot-list.md` predates the crew build and national teams; the 26 Oct shot list replaces it.)

## Links
Repository: https://github.com/Crafted-by-Akshay/matchcast (must be public at submission). Architecture: `docs/architecture/`. Rules mapping: `docs/submission/rules-checklist.md`.

## Category
Best Multi-Agent System Prize (and Grand Prize).

## Credits and data
three.js (MIT), MakeHuman CC0 base meshes. All motion, the simulator and the match data are our own; national team names and real past international results (martj42, CC0) are reference facts (ADR-0020); calibration uses aggregate statistics from CC0 and CC BY sources, never real players or real match events. See the README.
