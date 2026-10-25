# Devpost submission text

Status: **Draft**. Fill the bracketed items after the first deploy and re-read against `docs/release-check.md` on 27 Oct. Everything below is written for what exists today; where a part is not live yet it says so, and the final text must keep each "Simulated" or "Planned" note until the live URL proves otherwise.

## Project name
MatchCast

## Elevator pitch (what you built, which technologies, what it does, what problem it solves)

Football data is everywhere; explanations are not. MatchCast turns a stream of synthetic football events into explainable match intelligence. Four agents with distinct roles (Producer, Analyst, Narrator, Verifier) read each event, write commentary and insight, and the Verifier recounts every number from the stored event log before a line reaches a screen. The same moment reads differently for a data-hungry analyst, a casual fan and a producer, and in Producer mode nothing goes to air without a producer's approval (the demo runs in auto mode, which airs a line once the Verifier passes it).

Built on Microsoft Foundry with the Microsoft Agent Framework for the agent workflow, an MCP tool server for verified match facts (Planned: a recorded run of GitHub Copilot Agent Mode calling it), Azure Container Apps, Event Hubs, Table and Blob Storage, Azure AI Speech, Azure AI Translator and Azure AI Search, defined as Bicep and deployed from a laptop with `azd` and `scripts/deploy_cloud.sh`; the GitHub Actions workflows are manual-only, and the OIDC deploy workflow is written but not used (no keys in the repo). All clubs, players and matches are fictional and come from our own seeded simulator.

The problem: studios, broadcasters and streamers need live narratives and recaps they can trust and tailor per audience and language. A single model that writes fluent text can also write a wrong score. MatchCast makes every claim cite its evidence and checks it before air.

The customer (an illustrative scenario): a rights holder's production team runs Hindi and Spanish feeds of the same match. Each feed needs the right score, scorer and minute on air, and today that means a stats person per feed. MatchCast writes each line once from verified claims, and the Verifier re-checks the numbers and names in the Spanish and Hindi variants before they are shown. Only checked variants go out, and the English line stays the source of truth.

## What is real today (25 Oct) and what is not

Checked against the deployed api's `/v1/status` on 25 Oct; the app and [`docs/judge/walkthrough.md`](../judge/walkthrough.md) label the same states.

- Live on Azure: the four agents on the Foundry gpt-5-mini deployment (the Producer stays rules; the rules take over if a model call fails), the Stats Desk over A2A, Table Storage, Azure AI Search, Speech, Translator, Vision, Content Safety and Entra sign-in on the Producer routes.
- Simulated: Event Hubs, which is an in-process stream today. The first load of the live app can take up to a minute while it wakes.
- Planned, not connected: Microsoft Fabric and Azure Databricks season data jobs; video auto-eventing.
- Vision: a vision tracker reads the rendered broadcast and measures its accuracy against the simulator's ground truth. Its output is a measured side-channel, not an input to the agents yet.
- The app's approval mode defaults to auto (verified lines air at once); Producer mode asks a person to approve each line.

## Built with
Microsoft Foundry, Microsoft Agent Framework, Model Context Protocol, Azure Container Apps, Azure Event Hubs, Azure Table and Blob Storage, Azure AI Speech, Azure AI Translator, Azure AI Search, Azure Key Vault, Application Insights, Bicep, azd (deploys run locally; GitHub Actions is manual-only), Python (FastAPI), JavaScript, three.js, Playwright.

## How to try it (testing instructions, §4.8)

No login is needed.
1. Open <https://ca-web-matchcast-dev.calmbay-045566e2.eastus2.azurecontainerapps.io> (the first load can take up to a minute).
2. Watch view: start the match, switch the mode between Casual and Analyst and read the same moment two ways.
3. Press Why? on a line to see the claim and its cited events; open the trace panel to see each agent's step.
4. Agents tab, Seed a bad claim: the Verifier rejects the wrong number and repairs it from the raw log.
5. Broadcast view: switch the approval mode to Producer, approve a line, and watch the lower-third go on air.
6. Locally without any cloud account: `make judge-path` (boots the api and the app and proves the flow), then the README's "Run locally".

## Demo video
[public video URL]. Under two minutes; script in `docs/video-script.md`, shot list in `docs/submission/shot-list.md`.

## Links
Repository: https://github.com/Crafted-by-Akshay/matchcast (must be public at submission; it is private today, so it needs to be made public before 27 Oct 11:59 pm PT). Architecture: `docs/architecture/`. Rules mapping: `docs/submission/rules-checklist.md`.

## Category
Best Multi-Agent System Prize (and Grand Prize).

## Credits and data
three.js (MIT), MakeHuman CC0 base meshes. All motion, the simulator and the data are our own; calibration uses aggregate statistics from CC0 and CC BY sources, never real players, clubs or events. See the README.
