.PHONY: install lint typecheck test build

install:
	npm ci
	uv sync --locked --all-packages

lint:
	uv run --locked --all-packages ruff check .
	npm run lint --workspace apps/broadcast-web

typecheck:
	npm run typecheck --workspace apps/broadcast-web

test:
	uv run --locked --all-packages pytest

build:
	npm run build --workspace apps/broadcast-web
