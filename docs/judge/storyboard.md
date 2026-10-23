# Demo storyboard (under 2 minutes)

This is the beat-by-beat plan for the judge video. It matches `docs/video-script.md` and `docs/submission/shot-list.md` on the rules (under two minutes, so end by 1:58) and adds what is live today; if they disagree, fix the other two, not this one.

Each beat names the screen, what the viewer should see, and the one claim it supports. For a repeatable match use the runner's fixture URL (`node services/simulation/run.cjs --seeds 2026 --url`; seed 2026 is `/watch/index.html?seed=2026&half=45&st=1&month=3&h=NAV&a=LOM`, goals at 18.4 and 22.4 since the fixed-step fix in #223, first match after page load). `?seed=2026` alone gives a different fixture. Confirm on the dry run: see `docs/judge/filming-seeds.md`. If a beat is not working on the day, cut it; do not narrate it. All clubs, players and events are synthetic.

| # | Time | Screen | What happens | What to say | Judging criterion |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:00 to 0:10 | Intro, then Watch | The synthetic match kicks off. The top-bar pill reads `Rules fallback` while the agents run as rules (expected today), `Live agents` once Foundry is live. If it reads `Warming up the match engine`, wait; if `Offline (simulated)`, do not film. | "Synthetic football events in, explained match intelligence out." | Category fit (stages a and d) |
| 2 | 0:10 to 0:30 | Watch, Match Pulse | The first Match Pulse card arrives (a goal if one has come; with the fixture URL the live app repeats the runner's goal minutes, see `docs/judge/filming-seeds.md`). The card says why it matters and shows `✓ API-Verified`. Press Why? to show the evidence. | "The Verifier recounts every number from the stored events before a line reaches the screen." | Agentic design (Verifier) |
| 3 | 0:30 to 0:45 | Watch mode chip | Switch Casual fan to Analyst: the next moment arrives with different numbers and depth (modes do not back-fill earlier cards). | "A casual fan and a data-hungry analyst get different experiences from one match." | Category fit (stage e) |
| 4 | 0:45 to 1:05 | Agents tab | Seed a bad claim is on from the start (the URL), so the in-page Verifier rejects a wrong score and the repair shows in the trace. The api's own corruption starts at match minute 12, so use a later part of the take if you want the api Verifier. Verify chain. | "A wrong number is caught and repaired from the event log; the audit chain is tamper-evident." Say which pipeline the note beside the switch names. | Agentic design, tech |
| 5 | 1:05 to 1:20 | Language buttons | Switch to ES: the line keeps its numbers and names, with a Verifier-checked translation. Film only an `✓ API-Verified` card in ES; cut the beat if the deployed URL shows only English. | "Translated by Azure AI Translator, then re-checked for numbers and names." | Real-world impact |
| 6 | 1:20 to 1:35 | Ask | In the Copilot Ask tab ask "how many shots on target does Thames Rovers have?" and show the answer, the citation and the source chip; then "who will win the league?", which is refused. | "It answers from the match record, and says no when it cannot confirm." | Agentic design, UX |
| 7 | 1:35 to 1:50 | Broadcast, then Analyst | Lower third and teleprompter with a voiced line; one cut to the Analyst workspace. | "The same verified insight for a broadcast desk and an analyst." | UX, real-world impact |
| 8 | 1:50 to 1:58 | Status dialog | Open Status: what is live, simulated and planned. | "Everything not live is labelled Simulated or Planned." | Honesty, tech |

## Before you film

1. Open `/v1/status` and check what is live. Say on camera exactly what the pill says.
1a. Do a dry run with seed 2026 at 4x and note when the first Match Pulse card, the first goal and match minute 12 arrive, on a real GPU. If seed 2026 shows no early goal on the dry run, try seeds 1 or 13 (`docs/judge/filming-seeds.md`).
2. Foundry agents are rules-only until model quota is approved; do not say "GPT" or "Foundry model" on camera until `/v1/status` lists them live.
3. AI Search, Fabric and Databricks are Planned. Do not show them as running.
4. Voiced Talk replies are not shown in this video. The text Talk reply (walkthrough step 6) is fine to show.
5. Speech needs a user gesture: click once in the page before beat 7.
