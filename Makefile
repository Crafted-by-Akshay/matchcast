.PHONY: install lint typecheck test build contracts-generate contracts-check

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
