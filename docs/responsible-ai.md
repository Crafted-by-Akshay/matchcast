# Responsible AI notes

What MatchCast does to keep its AI output honest, and where it can still be wrong. Status labels follow the repo rule: **Working** runs in the repo today, **Simulated** is a local stand-in, **Planned** is designed but not built. Design detail: [architecture/14-security-and-responsible-ai.md](architecture/14-security-and-responsible-ai.md).

## 1. Data
Every match, club and player is synthetic and fictional. No real people, clubs or matches appear in events, lines or tests. Real data is used only as aggregate statistics to calibrate the simulator (see [simulator.md](simulator.md) once merged). The red-team set includes real-person prompts to check we refuse to impersonate anyone.

## 2. What the Verifier checks
Working, in rules mode: every line passes sources, freshness, numbers recomputed from the event log, names from the roster, and persona limits before it can be published. A failed line is repaired once, then dropped. Content Safety (check 7) and Ask citations (check 6) are added with the Ask and Safety work.

What it cannot check: whether a tactical opinion is wise, whether a line is interesting, or facts that are not in the log. A line can be correct and still dull.

## 3. Content Safety and Prompt Shields
Lines and user text are blocked at severity 2 or higher in hate, sexual, violence and self-harm; injection attempts are rejected before any model sees them. **Simulated** offline by `LocalSafetyScreen` (a short word list and three injection phrases); **Planned** against Azure AI Content Safety once deployed. The offline screen is deliberately small and is not a safety claim.

## 4. Human approval
In Producer mode a line waits for approval before air; Viewers cannot approve, edit or kill. Roles and sign-in in the prototype are **Simulated**; real Entra sign-in is **Planned**. Every approval is a record in a tamper-evident audit chain that anyone can re-verify.

## 5. Known failure modes
- **Silence:** the rules Narrator writes nothing for many moments (14 of 22 in the short fixture), and Ask abstains with "I can't confirm that from the match data yet."
- **Rules fallback wording** is plain and repetitive; it is labelled as a fallback.
- **Translation:** a Spanish or Hindi line whose numbers or names differ from the English one is rejected and shown as unavailable.
- **Vision identity errors:** a second-opinion OCR read can misidentify a shirt number; it never overrides the event feed.
- **Never predicts:** future-tense questions abstain.

## 6. Languages
English, Spanish and Hindi. Tamil is off until a native speaker has reviewed it.

## 7. Red team
`eval/redteam.jsonl` holds 20 prompts (instruction override, system prompt, keys, abuse, real people, SQL writes, write tools, future, scope). `tests/test_redteam.py` runs the shield and safety prompts today (9 of 20) and guards the set from losing entries; the remaining 11 are stopped by the Ask router and are enforced by its golden-set gate. Result today: the screen layer stops 9 of 9; the router layer is not yet counted.

## 8. Reporting
Open an issue on the repo. No personal data is collected; Ask history is deleted after 24 hours (**Planned**).
