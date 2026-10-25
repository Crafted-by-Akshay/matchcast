# api: FastAPI edge (PLT-7). Build context is the repository root (uv workspace):
#   docker build -f services/api/Dockerfile -t matchcast-api .
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock ./
COPY packages packages
COPY services/api services/api
COPY services/worker services/worker
COPY services/mcp services/mcp
COPY services/recap services/recap
COPY kb kb
COPY data/season data/season
COPY data/models data/models
COPY data/history data/history
RUN uv sync --locked --no-dev --package matchcast-api
# The runtime user is not root; a checkout made under a strict umask must still be readable.
RUN chmod -R a+rX /app

FROM python:3.12-slim
RUN useradd --system --uid 10001 matchcast
WORKDIR /app
COPY --from=build /app /app
ENV PATH="/app/.venv/bin:$PATH" MATCHCAST_MODE=cloud MATCHCAST_SEASON_DIR=/app/data/season/v1
USER matchcast
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--app-dir", "services/api", "--host", "0.0.0.0", "--port", "8000"]
