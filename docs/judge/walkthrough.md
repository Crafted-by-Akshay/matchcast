# First-time judge walkthrough (about 4 minutes)

Open the app URL. The first load can take up to a minute while the agent api wakes. Everything you see is synthetic: clubs, players and match events are fictional. The national teams are real teams with real past results, used as reference facts only (ADR-0020).

1. **Browse (30 s).** Home, Matches and My Club are plain pages and do not start the match engine. My Club has a Copilot panel for the club you pick. The **More** menu holds Highlights, My List, Analyze, Production Studio, Tour and Status & service details.
2. **Watch (80 s).** The synthetic match (Argentina v Brazil, seed 2026) starts on load. The commentary card has two commentary styles, Fan and Analyst, and a **Feed** picker with six feeds: Casual, Analyst, Audio description, Catch me up, Half-time explainer and News ticker. Choose a language in the header (ten languages). A line without a Verifier-checked translation stays in English, and the app says so.
   Every line on air was recounted by the Verifier before it reached the screen. Press **How was this made?** for each agent's steps. The header pill says `Live agents` or `Rules fallback`, and **Status & service details** lists what is live, simulated or planned.
3. **Copilot (40 s).** Open the Copilot on Watch. Its tabs are Ask, Insights, Tactics, Talk and Verify. In Ask, try a team question such as "how many shots on target does Thames Rovers have?". An answer carries a source chip that says where it came from: `from the match record`, `from the knowledge base`, `from AI Search` or `Search fallback`. A question about history, such as the last meeting of two national teams, is answered from the CC0 results file. A question nobody can confirm gets a refusal rather than a guess.
4. **Production Studio (60 s).** It opens with a quiet preview and the production controls. The two booth voices (play-by-play and colour) wait in the producer queue until someone approves or kills them. The six feeds need no approval: each airs once the Verifier passes it, and is dropped with an audit record if it fails repair. Advanced controls sit under the tools disclosure.
5. **Analyze (40 s).** The Overview is the season view. The **Overview / Full analysis** switch opens the complete analysis console for the match you chose, with its match evidence and audit history.
6. **Tour (optional, 20 s).** **Tour** in the More menu runs five steps and switches the view at each one.

Roles in the analysis workspace are Planned (simulated). Entra sign-in is enforced only on the Producer line routes of the api, so browsing and watching need no sign-in.

## Repeatable run

`/?seed=2026#watch` gives the same match every time, because the engine is seeded. Another seed gives another match, and every browser gets the same result for the same seed (#463).

## What is real and what is not

Each part of the app is labelled **Live**, **Simulated** or **Planned** where it appears, and `/v1/status` is the source of truth. On 28 Oct 2026 the deployed api reports the agents (Analyst, Narrator and Verifier on the gpt-5-mini deployment in Microsoft Foundry; the Producer chooses among rules candidates), Stats Desk, Table Storage, AI Search, Speech, Translator, Vision, Content Safety and Entra sign-in as live. Event Hubs is simulated (an in-process stream, because the api runs in `direct` mode). Microsoft Fabric and Azure Databricks are planned and not connected.

The simulator, the in-page rules agents and the contract checks run in your browser. The api, the Foundry models and the Azure services are used when the deployment has them, and when a call fails the rules twin answers and the audit records the fallback (ADR-0014). The architecture, the Azure services table and the evidence are in the [README](../../README.md).
