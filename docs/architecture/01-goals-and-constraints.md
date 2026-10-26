# 01 Goals, constraints and quality targets

Status: **Agreed design**. Last reviewed 22 Oct 2026. Owner: Akshay (product), Platform lane (architecture).

## 1. What MatchCast is

MatchCast turns a synthetic football match into explained, verified, personalised insight. It does this live for three audiences in one app: fans (Watch), broadcasters (Broadcast) and analysts (Analyst). Four AI agents (Producer, Analyst, Narrator, Verifier) on Azure AI Foundry produce every line a viewer sees. Every number and name is checked against match state before it is shown.

## 2. Goals

| ID | Goal | Measured by |
| --- | --- | --- |
| G1 | Win the Grand Prize and Best Multi-Agent at Microsoft's "Inside the Game" hackathon | Judging: 5 criteria at 20% each (rules §6.2) |
| G2 | Cover all five challenge stages visibly: (a) ingest, (b) interpret, (c) explain, (d) render, (e) personalise (rules §4.1) | Every component in [02-context-and-containers.md](02-context-and-containers.md) names its stage |
| G3 | Every on-screen number and name is correct, or the line is not shown | Verifier pass rate and zero hallucinated numbers in the QUA-4 evaluation |
| G4 | Football-realistic synthetic data | 9 realism targets in [06-simulation.md](06-simulation.md) pass over 200 seeds |
| G5 | Live demo judges can open free until 10 Nov 2026, 11:59 pm PT (rules §4.8) | Logged-out release check (QUA-8) |
| G6 | Total Azure spend about $49 worst case (about $60 with Translator, Vision and Content Safety under their hard caps, accepted by Akshay on 22 Oct), hard cap $100 | `scripts/cost_today.sh`, budget alerts at $40 and $50 |

## 3. Stakeholders

| Who | Needs |
| --- | --- |
| Judges | Open the demo without setup, see multi-agent behaviour, trust the numbers, understand the architecture in 2 minutes |
| Casual fan (persona `casual`) | Short plain-language lines, voice, own language |
| Analyst (persona `analyst`) | Metrics with values and provenance, query workbench, exports |
| Broadcaster / producer (persona `broadcast`, role Producer) | Lower-thirds, teleprompter, approval before air, alerts |
| Builders (5 Claude Code lanes) | Unambiguous specs, contracts, folder ownership, definition of done |

## 4. Constraints

| ID | Constraint | Source |
| --- | --- | --- |
| C1 | Match data must be synthetic and football-realistic | Rules §4.7 |
| C2 | Any third-party SDK, API or data must be licensed for this use | Rules §4.3, §4.11 |
| C3 | Public GitHub repo, demo video under 2 minutes, English submission | Rules §4.4, §4.9 |
| C4 | Submission closes 27 Oct 2026, 11:59 pm PT | Rules |
| C5 | Agents run on Azure AI Foundry models; model `gpt-5-mini` (Global Standard, East US 2) | Akshay, 21 Oct; [ADR-0024](adr/0024-gpt-5-mini-deployment.md) |
| C6 | No secret in the repo, the browser, chat or logs, ever | Akshay; [14-security-and-responsible-ai.md](14-security-and-responsible-ai.md) |
| C7 | No real player names, club names, crests or match events in generated data | Akshay, 18 Oct; rules §4.6 |
| C8 | 3D assets CC0 only, motion is our own code | Akshay, 18 Oct |
| C9 | Languages in v1: English, Spanish, Hindi. Tamil only after a native-speaker review | Akshay, 21 Oct |
| C10 | Every Foundry call is live (no cached answers); Speech paid tier, no free allowance counted | Akshay, 21 Oct |
| C11 | Anything not really connected is labelled "Simulated" in the UI | Project rule since 18 Oct |
| C12 | Build runs locally on the Mac mini with Claude Code (5 lanes) | Akshay, 21 Oct |

## 5. Quality targets

Each target is testable. The test that proves it is named in the last column.

| ID | Quality | Target | Proven by |
| --- | --- | --- | --- |
| Q1 | Latency, live line | Event to verified line on screen: p95 ≤ 6 s with live agents; ≤ 1 s in rules mode | QUA-1 trace timings, App Insights workbook |
| Q2 | Latency, priority 1 moment | Goal, red card or penalty: Producer task within 2 s of the event; Broadcast alert within 3 s | AGT-4, EXP-9 acceptance tests |
| Q3 | Latency, Ask chatbot | Answer p95 ≤ 8 s; refusal or abstain message ≤ 8 s | `eval/ask_eval.py` |
| Q4 | Latency, translation | Translated line and voice follow the English line within 3 s p95 (EXP-17) | App Insights span `translate` |
| Q5 | Latency, voice | First audio byte ≤ 2 s after publication | Span `synthesize` |
| Q6 | Correctness | 0 hallucinated numbers or names per 100 published lines in QUA-4 arm B | `eval/compare.py` |
| Q7 | Grounding, chatbot | ≥ 95% of answers pass the Verifier; hit@5 ≥ 0.9 on the golden set; 5 of 5 unanswerable questions abstain | `eval/ask_eval.py` |
| Q8 | Resilience | After a forced restart of `api`, claims resume within 60 s with no duplicate claim IDs and an intact audit chain | AGT-13, QUA-5 |
| Q9 | Degradation | Model failure switches that agent to rules within 20 s and labels the line "Rules fallback" | AGT-9 |
| Q10 | Determinism | Same seed gives byte-identical event JSON | DAT-9 replay test |
| Q11 | Realism | 9 targets inside their pass bands over 200 seeds | `scripts/check_realism.py` |
| Q12 | First load | Watch interactive ≤ 4 s cold cache on 50 Mbps; other views lazy-load | EXP-15 timing test |
| Q13 | Cold start | `api` from zero replicas to first claim ≤ 45 s, and ≤ 5 s when warm, with "Warming up the match engine" shown while cold | PLT-9, EXP-1 |
| Q14 | Accessibility | Lighthouse accessibility ≥ 90 per view; WCAG AA contrast; live region announces lines | EXP-14 |
| Q15 | Security | No secrets in repo or env vars; no high or critical dependency issues | QUA-7 scans |
| Q16 | Cost | Month-to-date spend under $40 before 27 Oct; under $50 at shutdown | PLT-10 |

## 6. Scope

**In scope (v1):** everything in the Azure Boards backlog (67 stories), including Databricks, Fabric, Event Hubs, Entra roles, Content Safety, CI/CD, Bicep, the RAG chatbot, vision identification and live translation.

**Out of scope (v1):**
- Real match data, real broadcasts or real people.
- Mobile native apps. The web app works on phones, but it is designed for desktop.
- Multi-tenant production hosting. One tenant `demo` exists; the contracts carry `tenant_id` so this can change later.
- Microsoft 365 Copilot or Teams bot. This is a possible add-on only.
- Tamil output, until a native speaker reviews it.

## 7. Glossary pointer

Terms such as claim, publication, persona, moment, seed and xG are defined in [18-glossary.md](18-glossary.md).
