# MatchCast architecture blueprint

The single source of truth for how MatchCast is built. Every Claude Code lane reads the files listed for its task before writing code. When code and these files disagree, stop and raise it: either the code is wrong or the doc needs a PR.

Last reviewed 22 Oct 2026. Structure: [arc42](https://arc42.org/overview) sections, [C4](https://c4model.com) diagrams, and decision records (ADRs). Diagrams are Mermaid and render on GitHub.

## Status legend

- **Agreed design**: build to it.
- **Proposed**: build to it, but the linked ADR still needs Akshay's OK; keep the change easy to swap. (None open as of 22 Oct 2026.)
- **Simulated**: shown in the UI but not connected; must carry the "Simulated" label.

## Contents

| File | Answers | arc42 section |
| --- | --- | --- |
| [01-goals-and-constraints.md](01-goals-and-constraints.md) | What we must achieve, the rules we can't break, measurable quality targets | 1, 2, 10 |
| [02-context-and-containers.md](02-context-and-containers.md) | System context, every container, Azure resources, stage map | 3, 5 |
| [03-runtime-flows.md](03-runtime-flows.md) | 11 sequence and state diagrams: live loop, line lifecycle, approval, Ask, Talk, translation, vision, recap, resume, Data Scientist, build-time data | 6 |
| [04-agents.md](04-agents.md) | The four agents, on-demand agents, workflow graph, packets, Verifier checks, MCP tools, prompts | 5, 8 |
| [05-assistant-rag.md](05-assistant-rag.md) | The chatbot: knowledge base, ingestion, index schema, answering, fallbacks, quality gate | 5, 8 |
| [06-simulation.md](06-simulation.md) | Synthetic match generator, seeding, condensed broadcast, realism targets, xG, data licences | 5 |
| [07-data-and-storage.md](07-data-and-storage.md) | Database design: keys, ERD, every table and blob path, DuckDB views, Event Hubs, Eventhouse, retention, repository layer, when a real database is allowed | 5, 8 |
| [08-analytics-and-ml.md](08-analytics-and-ml.md) | Metrics engine, Data Scientist workspace (real vs simulated), Databricks jobs, Fabric | 5 |
| [09-vision-identification.md](09-vision-identification.md) | Auto-eventing from pixels and shirt-number OCR | 5 |
| [10-voice-and-translation.md](10-voice-and-translation.md) | Speech in and out, live translation with re-checks | 5 |
| [11-frontend.md](11-frontend.md) | Unified app structure, bus messages, connection states, personalisation, CSP | 5 |
| [12-api.md](12-api.md) | REST routes, SSE, MCP and A2A, Event Hubs messages, error codes, rate limits | 5 |
| [13-deployment-and-operations.md](13-deployment-and-operations.md) | Azure topology, Bicep modules, RBAC matrix, container settings, CI/CD, environments, runbooks | 7 |
| [14-security-and-responsible-ai.md](14-security-and-responsible-ai.md) | Trust boundaries, STRIDE threat model, AI safety controls | 8 |
| [15-observability.md](15-observability.md) | Spans, dashboards, alerts, sampling | 8 |
| [16-testing-and-quality.md](16-testing-and-quality.md) | Test layers, definition of done, evaluation method, Playwright specs per screen, test evidence per story type, store tests | 10 |
| [17-risks-and-debt.md](17-risks-and-debt.md) | Risks with owners, accepted debt | 11 |
| [18-glossary.md](18-glossary.md) | Shared vocabulary | 12 |
| [19-engineering-practices.md](19-engineering-practices.md) | Repo layout and ownership, branches, code standards, versioning, docs as code, licences | 8 |
| [adr/](adr/) | 15 decisions with context, options and consequences | 9 |

Related: [../contracts.md](../contracts.md) (wire formats, canonical), [../backend.md](../backend.md) (S03 local API).

## Reading map for Claude Code

Paste this block into the root `CLAUDE.md`. Each lane's own `CLAUDE.md` repeats only its row.

```markdown
## Architecture (read before coding)
Source of truth: docs/architecture/README.md. If code and docs disagree, stop and say so.
- Every task: 01-goals-and-constraints.md §4-5, 19-engineering-practices.md, 18-glossary.md
- Platform lane: 13-deployment-and-operations.md, 14-security-and-responsible-ai.md, 15-observability.md, adr/0005-0008
- Agents lane: 04-agents.md, 05-assistant-rag.md, 12-api.md, 03-runtime-flows.md (F1-F6, F8-F10), adr/0002, 0009, 0013, 0014, 0016 (talk orders), 0020 (talk knowledge and call)
- Experience lane: 11-frontend.md, 10-voice-and-translation.md, 12-api.md §2-3, 03-runtime-flows.md (F1, F3-F6)
- Data lane: 06-simulation.md, 07-data-and-storage.md, 08-analytics-and-ml.md, 09-vision-identification.md, adr/0004, 0006, 0007, 0010, 0012, 0015
- Quality lane: 16-testing-and-quality.md, 01-goals-and-constraints.md §5, 14-security-and-responsible-ai.md §3-4, 17-risks-and-debt.md
- Changing a contract: docs/contracts.md first, then 07-data-and-storage.md
- Making a decision not covered here: write an ADR from adr/0000-template.md in the same PR
```

## How to change these docs

1. Change the doc in the same PR as the code it describes.
2. A changed decision gets a new ADR; the old one is marked "Superseded".
3. Update "Last reviewed" at the top of each file you touch.
