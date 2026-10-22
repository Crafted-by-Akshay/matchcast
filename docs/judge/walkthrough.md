# First-time judge walkthrough (about 3 minutes)

Open the app URL. The first page load starts Watch, which draws a synthetic match in 3D; on a laptop GPU it takes a few seconds. All clubs, players and events are synthetic.

1. **Take the tour (20 s).** Press **Tour** in the top bar (or open `/?tour=1`). Five steps: Watch, Agents, Broadcast, Analyst, Prove it. Keys 1 to 4 switch views at any time (not while a text box or the tour has focus).
2. **Watch (60 s).** Pick a watch mode with the chip at the bottom left (Casual, Analyst, My club, Player focus, One metric). Match Pulse cards appear as moments happen. Each card says who checked it:
   - `✓ API-Verified`: the agent api wrote the line and its Verifier recounted every number from the stored events.
   - `In-page (Simulated)` with `✓ Verified in page`: the in-page rules wrote and checked it in your browser; the server did not.
   Press **Why?** for the evidence and **How was this made?** for the agent steps. The top-bar pill says `Live agents`, `Rules fallback` or `Offline (simulated)`; **Status** lists what is live, simulated or planned.
3. **Agents (40 s).** Open the Agents tab. It shows the claim ledger, the audit chain (**Verify chain** recomputes the hashes) and the Producer approval queue. Turn on **Seed a bad claim** to see the Verifier reject a wrong score and repair it from the event log. With a live api the same switch makes the server Verifier do it from minute 12; the note next to the switch says which pipeline you are seeing.
4. **Broadcast (30 s).** The same match as a broadcast desk: lower thirds, teleprompter and voiced lines. The language buttons (EN, ES, HI) apply to every view; a line without a Verifier-checked translation stays English and says so.
5. **Analyst (30 s).** The same match as an analyst workspace: match centre, players, reports, Trust and audit. Roles and sign-in are Planned (simulated).

## Repeatable runs

`/?seed=2026&speed=4&seedBadClaim=1#watch` plays the same match at 4x with the bad-claim demo switched on.

## What is real and what is not

Labelled in the app and in `docs/judge/pipeline-audit.md`. In short: the simulator, the in-page agents and the contract checks run in your browser. The agent api, Foundry models, Speech and Translator are used only when the deployment has them; otherwise the UI says Simulated or Planned.
