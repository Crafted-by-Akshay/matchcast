.PHONY: smoke-foundry install lint typecheck test build contracts-generate contracts-check serve-e2e e2e e2e-webkit e2e-live

install:
	npm ci
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

contracts-generate:
	npm run generate --workspace @matchcast/contracts

contracts-check:
	npm run check:generated --workspace @matchcast/contracts

serve-e2e:
	node tests/e2e/serve.mjs

e2e:
	npm run e2e -- $(E2E_ARGS)

e2e-webkit:
	npm run e2e-webkit

e2e-live:
	npm run e2e-live

smoke-foundry:
	uv run --locked --group smoke python scripts/smoke_foundry.py
