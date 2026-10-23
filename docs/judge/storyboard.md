# Demo storyboard (under 2 minutes)

Each beat names the screen, what the viewer should see, and the one claim it supports. Film against the deployed URL with `/?seed=2026&speed=4&seedBadClaim=1#watch` so every take is the same match. If a beat is not working on the day, cut it; do not narrate it. All clubs, players and events are synthetic.

| # | Time | Screen | What happens | What to say | Judging criterion |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:00 to 0:10 | Intro, then Watch | The synthetic match kicks off. The top-bar pill reads Live agents (or Rules fallback; say which). | "Synthetic football events in, explained match intelligence out." | Category fit (stages a and d) |
| 2 | 0:10 to 0:30 | Watch, Match Pulse | A goal arrives. The card says why it matters and shows `✓ API-Verified`. Press Why? to show the evidence. | "The Verifier recounts every number from the stored events before a line reaches the screen." | Agentic design (Verifier) |
| 3 | 0:30 to 0:45 | Watch mode chip | Switch Casual fan to Analyst: the same moment, different numbers and depth. | "A casual fan and a data-hungry analyst get different experiences from one match." | Category fit (stage e) |
| 4 | 0:45 to 1:05 | Agents tab | Seed a bad claim is on from minute 12. The Verifier rejects a wrong score and the repair shows in the trace. Verify chain. | "A wrong number is caught and repaired from the event log; the audit chain is tamper-evident." Say which pipeline the note beside the switch names. | Agentic design, tech |
| 5 | 1:05 to 1:20 | Language buttons | Switch to ES: the line keeps its numbers and names, with a Verifier-checked translation. Cut this beat if the deployed URL only shows English. | "Translated by Azure AI Translator, then re-checked for numbers and names." | Real-world impact |
| 6 | 1:20 to 1:35 | Ask | Ask "who has the most shots?" Show the answer, the citation and the source chip; then an unanswerable question that is refused. | "It answers from the match record, and says no when it cannot confirm." | Agentic design, UX |
| 7 | 1:35 to 1:50 | Broadcast, then Analyst | Lower third and teleprompter with a voiced line; one cut to the Analyst workspace. | "The same verified insight for a broadcast desk and an analyst." | UX, real-world impact |
| 8 | 1:50 to 2:00 | Status dialog | Open Status: what is live, simulated and planned. | "Everything not live is labelled Simulated or Planned." | Honesty, tech |

## Before you film

1. Open `/v1/status` and read the overall state. Film "Live agents" only when the pill says so.
2. Foundry agents are rules-only until model quota is approved; do not say "GPT" or "Foundry model" on camera until `/v1/status` lists them live.
3. AI Search, Fabric and Databricks are Planned. Do not show them as running.
4. Do not film the voiced Talk replies: that story moved to the Voice and talk replies lane.
5. Speech needs a user gesture: click once in the page before beat 7.
