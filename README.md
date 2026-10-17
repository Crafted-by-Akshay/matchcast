# MatchCast

MatchCast is an AI-powered football broadcasting platform being built for a Microsoft AI Hackathon. This repository is the initial monorepo scaffold; product features and shared contracts will be added in later phases.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/broadcast-web` | Next.js, React, and TypeScript broadcast interface |
| `services/api` | FastAPI service and initial health endpoint |
| `services/simulation` | Reserved for a future match simulation service |
| `services/match-state` | Reserved for future match state processing |
| `services/commentary` | Reserved for future commentary service |
| `packages/contracts` | Reserved for shared data contracts (Phase 1, Step 3) |
| `packages/shared` | Reserved for shared utilities |
| `packages/agents` | Reserved for agent orchestration (Phase 1, Step 5) |
| `tests` | Repository-level tests |
| `infra` | Reserved for future infrastructure definitions |
| `docs/evidence` | Hackathon evidence and supporting materials |
| `.github/workflows` | Reserved for CI/CD (Phase 1, Step 6) |

Engineering guidance will be established in Phase 1, Step 4; see [`AGENTS.md`](AGENTS.md).

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
uv run --package matchcast-api uvicorn app.main:app --app-dir services/api --reload
```

The API health check is available at [http://localhost:8000/health](http://localhost:8000/health) and returns `{"status":"healthy"}`.

## Validate

From the repository root:

```sh
make lint       # Ruff and ESLint
make typecheck  # TypeScript compiler
make test       # API health and smoke tests
make build      # Production build of the web application
```

## Planned technology

The initial scaffold uses Next.js, React, TypeScript, FastAPI, `uv`, Ruff, pytest, npm, ESLint, and TypeScript. Docker and Azure Container Apps are intended deployment options; Microsoft Agent Framework, Microsoft Foundry, Azure Databricks, and MLflow are planned for later phases. This scaffold creates no cloud resources and does not implement simulation, tactical analysis, AI commentary, authentication, or agent orchestration.
