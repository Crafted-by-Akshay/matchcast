# Devpost submission text

Status: **Draft**. Fill the bracketed items after the first deploy and re-read against `docs/release-check.md` on 27 Oct. Everything below is written for what exists today; where a part is not live yet it says so, and the final text must keep each "Simulated" or "Planned" note until the live URL proves otherwise.

## Project name
MatchCast

## Elevator pitch (what you built, which technologies, what it does, what problem it solves)

Football data is everywhere; explanations are not. MatchCast turns a stream of synthetic football events into explainable match intelligence. Four agents with distinct roles (Producer, Analyst, Narrator, Verifier) read each event, write commentary and insight, and the Verifier recounts every number from the stored event log before a line reaches a screen. The same moment reads differently for a data-hungry analyst, a casual fan and a producer. The booth lines wait for a producer's approval; the six feeds auto-air once the Verifier passes them.

Built on Microsoft Foundry with the Microsoft Agent Framework for the agent workflow, an MCP tool server for verified match facts (Planned: a recorded run of GitHub Copilot Agent Mode calling it), Azure Container Apps, Event Hubs, Table and Blob Storage, Azure AI Speech, Azure AI Translator and Azure AI Search, defined as Bicep and deployed with `azd` and GitHub Actions using OIDC (no keys in the repo). All clubs, players and matches are fictional and come from our own seeded simulator.

## Customer and problem

The customer is a rights holder that sells the same match to dozens of markets, with a small production team behind it. Every feed needs on-screen stats and commentary in its own language, and that team cannot double-check every number live. A single model that writes fluent text can also write a wrong score.

MatchCast gives that team a production crew of AI agents on Microsoft Foundry. The agents pick the moments, write the line for each audience and language, and a separate Verifier recounts every number from the raw event log before the line can go on screen. The booth lines (play-by-play and colour) wait for one producer's approval. The six feeds auto-air once the Verifier passes them, and each graphic keeps an audit trail.

English, Hindi and Spanish lines are on the booth today. Translation runs only on verified English, and a deterministic re-check of numbers and names runs on the translation; a line that fails drops to English (ADR-0011). Translator and Speech calls are Simulated until they run live.

What the Verifier catches, measured: in the offline evaluation (`docs/eval/agents-eval.md`, rules agents on one frozen match) it caught 99.3% of 151 planted errors, each rejected for the right reason, with 0 false rejects on 34 honest lines; the seeded bad claim was caught 7 times out of 7 and no wrong claim reached a screen. That is the floor every model-written line is checked against, not a claim about model quality.

Evidence: we have not yet run this with a rights holder. The team above is a design target, not a named customer or pilot. We will say so in the video and the README rather than claim one.

## What is real today (22 Oct) and what is not

Replace this section with the final state at submission.

- Working end to end locally and in the browser: simulator, agents (rules mode and Foundry-ready live mode), Verifier, Watch / Analyst / Broadcast views, approval queue, audit chain, MCP server, Event Hubs pipeline mode (tested with fakes), Table-backed storage (tested on Azurite).
- Written, not yet provisioned: the Azure deployment. **No live URL until the first deploy.** Speech, Translator, Content Safety and Search are in Bicep (Vision is planned for its own story); the app labels them Simulated or Planned until they are called for real.
- Planned: Microsoft Fabric and Azure Databricks season data jobs; video auto-eventing.

## Built with
Microsoft Foundry, Microsoft Agent Framework, Model Context Protocol, Azure Container Apps, Azure Event Hubs, Azure Table and Blob Storage, Azure AI Speech, Azure AI Translator, Azure AI Search, Azure Key Vault, Application Insights, Bicep, azd, GitHub Actions (OIDC), Python (FastAPI), JavaScript, three.js, Playwright.

## How to try it (testing instructions, §4.8)

No login is needed.
1. Open [live demo URL].
2. Watch view: start the match, switch the mode between Casual and Analyst and read the same moment two ways.
3. Press Why? on a line to see the claim and its cited events; open the trace panel to see each agent's step.
4. Agents tab, Seed a bad claim: the Verifier rejects the wrong number and repairs it from the raw log.
5. Broadcast view, producer mode: approve a line and watch the lower-third go on air.
6. Locally without any cloud account: `make judge-path` (boots the api and the app and proves the flow), then the README's "Run locally".

## Demo video
[public video URL]. Under two minutes; script in `docs/video-script.md`, shot list in `docs/submission/shot-list.md`.

## Links
Repository: https://github.com/Crafted-by-Akshay/matchcast (must be public at submission). Architecture: `docs/architecture/`. Rules mapping: `docs/submission/rules-checklist.md`.

## Category
Best Multi-Agent System Prize (and Grand Prize).

## Credits and data
three.js (MIT), MakeHuman CC0 base meshes. All motion, the simulator and the data are our own; calibration uses aggregate statistics from CC0 and CC BY sources, never real players, clubs or events. See the README.
