.PHONY: live-eval realism judge-path openapi-generate smoke-foundry install lint typecheck test build contracts-generate contracts-check serve-e2e e2e e2e-webkit e2e-live

install:
	npm ci
	npm ci --prefix services/simulation
	uv sync --locked --all-packages

lint:
	uv run --locked --all-packages ruff check .
	npm run lint
	$(MAKE) contracts-check

typecheck:
	npm run typecheck

test:
	npm run build --workspace @matchcast/contracts
	npm run test --workspace @matchcast/contracts
	uv run --locked --all-packages pytest

build:
	npm run build

# Refresh docs/api/openapi.json after a route change; the openapi CI job fails on any drift.
openapi-generate:
	PYTHONPATH=services/api uv run --locked --all-packages python -c "import json; from app.main import app; print(json.dumps(app.openapi(), indent=2, sort_keys=True))" > docs/api/openapi.json

contracts-generate:
	npm run generate --workspace @matchcast/contracts

contracts-check:
	npm run check:generated --workspace @matchcast/contracts

serve-e2e:
	node tests/e2e/serve.mjs

e2e:
	npm run e2e -- $(E2E_ARGS)

realism:
	uv run --locked python scripts/check_realism.py --matches 200 $(REALISM_ARGS)

e2e-webkit:
	npm run e2e-webkit

e2e-live:
	npm run e2e-live

smoke-foundry:
	uv run --locked --group smoke python scripts/smoke_foundry.py

# One command once the gpt-6-luna quota lands: smoke the deployment, then the live comparison and
# the per-agent eval. Needs FOUNDRY_PROJECT_ENDPOINT and az login; costs tokens (eval/README.md).
live-eval: smoke-foundry
	uv run --locked --all-packages python eval/compare.py --live
	uv run --locked --all-packages python eval/agents_eval.py --live

judge-path:
	uv sync --locked --all-packages
	uv run python scripts/judge_path.py
