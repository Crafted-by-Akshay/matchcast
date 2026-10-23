# mcp: MCP tool server and Stats Desk (PLT-7). Build context is the repository root (uv workspace):
#   docker build -f services/mcp/Dockerfile -t matchcast-mcp .
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock ./
COPY packages packages
COPY services/api services/api
COPY services/worker services/worker
COPY services/recap services/recap
COPY services/mcp services/mcp
COPY data/season data/season
COPY data/models data/models
RUN uv sync --locked --no-dev --package matchcast-mcp

FROM python:3.12-slim
RUN useradd --system --uid 10001 matchcast
WORKDIR /app
COPY --from=build /app /app
ENV PATH="/app/.venv/bin:$PATH" MATCHCAST_MODE=cloud MATCHCAST_STORE=table MATCHCAST_SEASON_DIR=/app/data/season/v1 MATCHCAST_MCP_ALLOWED_HOSTS="*"
USER matchcast
EXPOSE 8001
CMD ["uvicorn", "matchcast_mcp.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8001"]
