# Video script: 2-minute MatchCast demo

Status: **Draft for Akshay's review** (AB#338, SUB-1). Rules: public, under 2 minutes, narration in English. The Spanish switch is shown for a few seconds only.

Film from the deployed unified app with a fixed seed so every take is the same: `?seed=2026&half=45&st=1&month=3&h=NAV&a=LOM&speed=4` (add `&seedBadClaim=1` for scene 3). Every scene depends on stories that are P0 or P1 and scheduled before 26 Oct.

| # | Scene | Start | Seconds | Shows | URL or state to film | Depends on (story, sprint) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | The problem | 0:00 | 10 | Fans and analysts get the same stats feed; nobody explains why a moment matters. Title card, then the Watch view. | Watch, paused at 0:00, default fixture | EXP-1 (S1) |
| 2 | Live match and voice | 0:10 | 25 | Kick-off, a Match Pulse card with a tick, commentary spoken by Azure AI Speech, captions. | Watch playing, a goal moment, voice on | EXP-3 (S1), EXP-8 (S2) |
| 3 | Verifier rejects and repairs | 0:35 | 15 | Trace panel: Analyst claim with a wrong number, Verifier recounts from the event log, repairs once, line goes out corrected. | Watch with `seedBadClaim=1`, trace panel open | AGT-7 (S1), AGT-8 (S2), EXP-6 (S2) |
| 4 | Casual vs analyst, then Spanish | 0:50 | 15 | Same moment in Casual and Analyst mode (different text), then Spanish with numbers and names unchanged. | Watch, mode switch, language switch | EXP-4 (S1), EXP-17 (S3) |
| 5 | Producer approval | 1:05 | 10 | Broadcast view: a line waits in the approval queue, the producer approves, the lower-third goes on air. | Broadcast, producer mode | EXP-11 (S3), EXP-7 (S2) |
| 6 | MCP in Copilot | 1:15 | 10 | VS Code Copilot Agent Mode calls the MatchCast MCP tools and gets verified match facts. | Copilot Agent Mode, `get_match_state` call | AGT-10 (S2), PLT-11 (S3) |
| 7 | Architecture | 1:25 | 20 | One diagram: Event Hubs, Foundry agents on Agent Framework, Databricks and Fabric for season data, Container Apps, Speech. | Architecture diagram from the README | SUB-6 (S4), PLT-3 (S1) |
| 8 | Evaluation number | 1:45 | 10 | Single agent vs four agents on 30 moments: verified-line rate and hallucinations per 100 lines. | `eval/results` chart or README table | QUA-4 (S3) |
| 9 | Close | 1:55 | 5 | Logo, repo URL, "Synthetic data only". | End card | none |
|  | **Total** |  | **120** |  |  |  |

## Narration draft (English, about 2.5 words a second)

1. "Football data is everywhere. Explanations are not. MatchCast turns synthetic match events into stories anyone can follow."
2. "Events stream in live. A Match Pulse card says what just happened and why it matters, spoken by Azure AI Speech."
3. "Every number is checked. Here the Analyst gets a count wrong. The Verifier recounts from the raw log, repairs it once, and only then does the line go out."
4. "A casual fan and an analyst get different explanations of the same moment. One click and it is in Spanish, with every number intact."
5. "Nothing reaches air without a human. The producer approves the line, and the lower-third appears."
6. "The same verified facts are available to developers through an MCP server, here inside GitHub Copilot."
7. "Four agents on Microsoft Agent Framework and Foundry, with Event Hubs, Databricks and Fabric behind them."
8. "On thirty fixed moments, we measured one agent against four: verified lines and mistakes per hundred lines (numbers added once QUA-4 has run)."
9. "MatchCast. Explainable football, verified."

## Open points for Akshay

- Scene 8 shows real numbers only after QUA-4 runs (needs the model quota). If it slips, shorten scene 8 to 5 s and give the time to scene 7.
- Scene 2 voice needs Azure AI Speech live (EXP-8); fall back to captions only if it is not working on filming day (26 Oct).
- Scene 6 needs a recording of Copilot Agent Mode (PLT-11).
