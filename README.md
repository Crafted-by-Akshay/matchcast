# MatchCast

MatchCast is an AI-powered football broadcasting platform being built for a Microsoft AI Hackathon. This repository is the initial monorepo scaffold; product features and shared contracts will be added in later phases.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/broadcast-web` | Next.js, React, and TypeScript broadcast interface |
| `services/api` | FastAPI liveness/readiness endpoints, typed configuration, and local session API |
| `services/worker` | Local-only idle worker entry point |
| `services/simulation` | Reserved for a future match simulation service |
| `services/match-state` | Reserved for future match state processing |
| `services/commentary` | Reserved for future commentary service |
| `packages/contracts` | Canonical JSON Schema, generated TypeScript, Python validation, and shared fixtures |
| `packages/shared` | Reserved for shared utilities |
| `packages/agents` | Reserved for agent orchestration (Phase 1, Step 5) |
| `tests` | Repository-level tests |
| `infra` | Reserved for future infrastructure definitions |
| `docs/evidence` | Hackathon evidence and supporting materials |
| `.github/workflows` | Reserved for CI/CD (Phase 1, Step 6) |

Engineering guidance will be established in Phase 1, Step 4; see [`AGENTS.md`](AGENTS.md).

Bootstrap Jira story MHACK832-22 suggests `apps/web/`. This repository retains the
existing `apps/broadcast-web/` location established by the initial scaffold. All npm
workspace commands use that path; there is no second frontend at `apps/web/`.

## Prerequisites

- Node.js `^20.19.0`, `^22.13.0`, or 24+ and npm
- `uv` (the Python package and project manager)

The Python workspace targets Python 3.12. `uv` can download that interpreter automatically if it is not installed locally.

## Install dependencies

From the repository root:

```sh
make install
```

This runs `npm ci` from the checked-in npm lockfile and `uv sync --locked --all-packages` from the checked-in Python lockfile.

## Run the applications

Start the Next.js app at [http://localhost:3000](http://localhost:3000):

```sh
npm run dev --workspace apps/broadcast-web
```

Start the FastAPI app at [http://localhost:8000](http://localhost:8000):

```sh
uv run --locked --package matchcast-api uvicorn app.main:app --app-dir services/api --reload
```

The liveness check is available at [http://localhost:8000/health](http://localhost:8000/health) and returns `{"status":"healthy"}` without contacting a model. Local readiness is available at [http://localhost:8000/ready](http://localhost:8000/ready); it reports the model and in-memory session store as local mocks. Configuration and readiness semantics, environment variables, and the session API are documented in [`docs/backend.md`](docs/backend.md).

In a third terminal, start the local worker:

```sh
uv run --locked --package matchcast-worker matchcast-worker
```

It prints `MatchCast worker ready: mode=local; idle scaffold; no cloud integrations`
and waits until Ctrl+C or SIGTERM. It does not process matches, connect to providers,
or run agent workflows. `--mode local` is the only supported mode; unsupported modes
exit with an error before readiness.

All three entry points work without cloud credentials or an `.env` file.
The optional [`.env.example`](.env.example) contains a placeholder for
`MATCHCAST_WORKER_MODE`; unset defaults to `local`. Replace the placeholder with
`local` before exporting it into your shell. No `.env` loader is configured for the
API or worker. Do not put credentials in the template.

## Validate

From the repository root:

```sh
make lint       # Ruff, ESLint, and generated contract drift check
make typecheck  # Frontend, contract validator, and generated type examples
make test       # Node/Python contract tests plus API and worker checks
make build      # Contracts package and web production build
```

Bootstrap verification, environment details, acceptance mapping, and outstanding
review/merge requirements are recorded in [`docs/evidence/S01.md`](docs/evidence/S01.md).

Shared wire definitions, units, ordering/correction rules, reference validation,
and versioning are documented in [`docs/contracts.md`](docs/contracts.md).
After editing the canonical schema, run `make contracts-generate`; `make
contracts-check` verifies that the checked-in TypeScript types match it. S02
acceptance evidence is in [`docs/evidence/S02.md`](docs/evidence/S02.md).

## Planned technology

The initial scaffold uses Next.js, React, TypeScript, FastAPI, `uv`, Ruff, pytest, npm, ESLint, and TypeScript. Docker and Azure Container Apps are intended deployment options; Microsoft Agent Framework, Microsoft Foundry, Azure Databricks, and MLflow are planned for later phases. This scaffold creates no cloud resources and does not implement simulation, tactical analysis, AI commentary, authentication, or agent orchestration.
