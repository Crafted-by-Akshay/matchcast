# 17 Risks and technical debt

Status: **Living list**. Last reviewed 22 Oct 2026. Review at every merge window.

## 1. Risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| R1 | Foundry quota for `gpt-5-mini` not approved in time (request sent 21 Oct) | Medium | High | Rules mode with the same interfaces; demo stays complete and labelled | Platform |
| R2 | No embeddings quota | Medium | Medium | Keyword-only search (BM25), documented | Agents |
| R3 | AI Search Free service deleted after inactivity during judging | Low | Medium | Blob fallback `kb/v1/chunks.jsonl` with in-memory search; "Search fallback" chip | Agents |
| R4 | Engine too slow for full-density simulation (> 60 s per 90 minutes headless) | Medium | Medium | Option B for the live view; dataset keeps full density | Data |
| R5 | Single `api` replica is a single point of failure | Medium | Medium | Checkpoints and resume in ≤ 60 s; kill-and-resume clip turns it into a demo | Agents |
| R6 | Event Hubs Basic: one consumer group shared by 3 readers | Low | Medium | Separate checkpoint folders; move to Standard (about $0.03 an hour) if readers interfere | Platform |
| R7 | Entra tenant blocks app registration | Low | Medium | Signed demo code labelled "Simulated sign-in" | Platform |
| R8 | Cost overrun | Low | High | Alerts at $40 and $50, scale to zero, Fabric paused, Databricks stopped, rate limits | Platform |
| R9 | Hindi or Spanish translation changes a number or name | Medium | Low | Deterministic re-check drops that language for the line | Agents |
| R10 | Vision OCR target (≥ 85%) not met | Medium | Low | Report the measured number honestly | Data |
| R11 | Five lanes overrun the Max 5x usage pool | Medium | High | Pace by `/usage`; Sonnet for building, Haiku for search and tests | Akshay |
| R12 | Merge conflicts between lanes | Medium | Medium | Strict folder ownership; merge windows 13:00 and 21:00 | Quality |

## 2. Accepted technical debt

| Debt | Why accepted | Pay back when |
| --- | --- | --- |
| One cloud environment (no staging) | Time and cost | After the hackathon |
| `api` max one replica; in-memory rate limits | Simplicity; demo load is small | If more than about 50 concurrent viewers |
| Three engines' code in iframes (unified app) | Large refactor otherwise | After the hackathon |
| Vision uses the renderer's camera matrix, not one solved from pitch lines | Time | After the hackathon |
| Table Storage instead of a database with queries | Cost | If cross-match queries are needed live (season uses DuckDB already) |
