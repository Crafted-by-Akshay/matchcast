# 19 Engineering practices

Status: **Agreed design**. Last reviewed 22 Oct 2026. These rules apply to every lane and every Claude Code session.

## 1. Target repository layout and ownership

```text
apps/unified/            Experience   three views + shell, build.py, Dockerfile (web)
services/api/            Agents       FastAPI edge, consumer task, routes
services/worker/         Data         Event Hubs consumer loop and reducer (library used by api)
services/mcp/            Agents       MCP tools, A2A Stats Desk, DuckDB season engine
services/recap/          Agents       Azure Function trigger
services/simulation/     Data         headless engine runner (Node 22)
packages/contracts/      Agents       JSON Schema, generated TS, validators (change needs all-lane agreement)
packages/agents/         Agents       workflow, executors, prompts, rules, ask
packages/metrics/        Data         metric functions + golden tests
kb/                      Agents       knowledge base markdown
data/                    Data         calibration targets, Databricks bundle, Fabric KQL
scripts/                 Data/Platform batch tools (fit_xg, check_realism, build_kb, cost_today, smoke_cloud)
eval/                    Quality      compare.py, ask_eval.py, golden and red-team sets, results
infra/, azure.yaml       Platform     Bicep and azd
.github/                 Platform     workflows, PR template
tests/                   Quality      repo-level contract and e2e tests
docs/                    everyone     architecture (this folder), contracts, runbooks, evidence
```

A lane edits only its own folders. A change outside them goes through a PR reviewed by the owning lane.

## 2. Branches, commits, pull requests

- Branch per story: `<lane>/<AB id>-<short-slug>`, for example `agents/AB123-verifier-checks`.
- Commit messages: imperative, ≤ 72-character subject, body says why. Include `AB#<id>`.
- PR title starts with `AB#<id>`. Use the PR template checklist (QUA-6). Small PRs: one story, or one task of a big story.
- Merge windows 13:00 and 21:00 local each build day. Squash merge.

## 3. Code standards

| Area | Rule |
| --- | --- |
| Python | 3.12, type hints everywhere, Pydantic v2 models for packets, Ruff (repo config), no bare `except`, async I/O in `api` |
| JavaScript | ES2022 modules in `apps/unified`, ESLint, no new framework in the unified app |
| Naming | Python `snake_case`, JS `camelCase`, JSON wire fields `snake_case`, env vars `UPPER_SNAKE` |
| Config | Only from environment variables, validated at start (pattern in `services/api/app/config.py`); no `.env` loader in cloud |
| Errors | RFC 9457 problem responses; never echo secrets or full prompts in errors |
| Logging | JSON, one event per line, with `trace_id`; user text only at DEBUG |
| Time | UTC everywhere; match time in milliseconds |
| Randomness | Only through seeded sub-streams ([06-simulation.md](06-simulation.md) §3) |

## 4. Versioning

| Thing | Scheme | Where it shows |
| --- | --- | --- |
| Contracts | semver; minor = additive | `schema_version` in every packet |
| Prompts | semver in the file's first line | `derivation_version` of claims and lines |
| Metrics | semver per function | `derivation_version` |
| Engine | semver in `services/simulation/package.json` | `matches.engine_version`, dataset card |
| API | URL prefix `/v1` | routes |
| KB | `v1`, `v2` index and blob versions | `kb-matchcast-v1` |

## 5. Documentation as code

- A PR that changes behaviour updates the matching file in `docs/architecture/` in the same PR. The reviewer checks this.
- A decision that changes a choice recorded here gets a new ADR in `adr/` (copy `adr/0000-template.md`). Old ADRs are never edited, only marked "Superseded by ADR-xxxx".
- Diagrams are Mermaid in the markdown, so they diff and review like code. SUB-6 exports PNGs for the README.

## 6. Dependencies and licences

- Add a dependency only with its licence checked: MIT, BSD, Apache-2.0, ISC, CC0 or CC BY are fine; anything else needs Akshay's OK.
- Record third-party assets and data with their licence in the README credits and `docs/dataset-card.md`.
- Lockfiles (`package-lock.json`, `uv.lock`) are committed; CI installs with `npm ci` and `uv sync --locked`.
