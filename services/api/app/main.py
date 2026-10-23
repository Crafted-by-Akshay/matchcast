"""MatchCast API liveness, honest readiness, and local isolated session operations."""

from __future__ import annotations

import os
from collections.abc import Callable
from typing import Any

from fastapi import FastAPI, HTTPException, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from matchcast_shared.azure_clients import foundry_token
from matchcast_shared.telemetry import configure_telemetry

from app.config import SettingsResult, load_settings
from app.matches import install as install_match_routes
from app.sessions import (
    InMemorySessionStore,
    SessionCreate,
    SessionRecord,
    SessionReplace,
    SessionStore,
    StreamIdentity,
)
from app.status import dependency_status

CredentialProbe = Callable[[], None]
"""Raises when no Entra credential can be obtained for Azure AI; never returns a token."""


def default_credential_probe() -> None:
    foundry_token()


def _record_json(record: SessionRecord) -> dict[str, Any]:
    return {
        "stream": record.stream.model_dump(),
        "state": record.state,
        "state_revision": record.state_revision,
    }


def create_app(
    *,
    settings_result: SettingsResult | None = None,
    session_store: SessionStore | None = None,
    credential_probe: CredentialProbe | None = None,
) -> FastAPI:
    """Build an app with injectable config and storage for deterministic tests."""

    configure_telemetry("matchcast-api")

    resolved_settings = settings_result or load_settings()
    store = InMemorySessionStore() if session_store is None else session_store
    probe = default_credential_probe if credential_probe is None else credential_probe
    application = FastAPI(title="MatchCast API", version="0.2.0")
    application.state.settings_result = resolved_settings
    origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
    if origins and "*" not in origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_methods=["GET", "POST"],
            allow_headers=["Content-Type", "Last-Event-ID", "X-Request-Id"],
            # without this a cross-origin browser reads Retry-After as absent and backs off blindly
            expose_headers=["Retry-After"],
        )
    application.state.session_store = store

    @application.exception_handler(RequestValidationError)
    async def request_validation_error_handler(
        _request: Any, exc: RequestValidationError
    ) -> JSONResponse:
        # Pydantic's default errors include raw input/context, which may contain NaN
        # (not JSON serializable) or sensitive values. Return only stable diagnostics.
        errors = [
            {"loc": list(error["loc"]), "msg": error["msg"], "type": error["type"]}
            for error in exc.errors()
        ]
        return JSONResponse(status_code=422, content={"detail": errors})

    @application.get("/health", tags=["health"])
    async def health() -> dict[str, str]:
        """Liveness only: does not require configuration or an external model."""
        return {"status": "healthy"}

    @application.get("/v1/status", tags=["health"])
    async def dependency_states() -> dict[str, Any]:
        """Live, simulated, planned or unavailable per dependency, for the status pill and page."""
        result: SettingsResult = application.state.settings_result
        mode = result.settings.mode if result.settings is not None else "local"
        registry = getattr(application.state, "matches", None)
        from matchcast_agents.ask import default_assistant

        built = default_assistant.cache_info().currsize  # do not load the KB just to poll status
        fallbacks = default_assistant().search_fallbacks if built else 0
        return dependency_status(os.environ, mode, getattr(registry, "safety", None), fallbacks)

    @application.get("/ready", tags=["health"])
    async def readiness(response: Response) -> dict[str, Any]:
        """Report local/mock versus pending/unavailable dependencies honestly."""
        result: SettingsResult = application.state.settings_result
        if result.settings is None:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            return {
                "status": "not_ready",
                "mode": "unknown",
                "configuration": {"status": "invalid", "errors": list(result.errors)},
                "dependencies": {
                    "model": {"status": "unavailable", "detail": "configuration is invalid"},
                    "session_store": {"status": "local_mock", "detail": "process-local memory"},
                },
            }

        settings = result.settings
        if settings.mode == "local":
            return {
                "status": "ready",
                "mode": "local",
                "configuration": {"status": "valid", "errors": []},
                "dependencies": {
                    "model": {"status": "local_mock", "detail": "no model connection is attempted"},
                    "session_store": {"status": "local_mock", "detail": "process-local memory"},
                },
            }

        try:
            await run_in_threadpool(probe)
        except Exception:  # any failure means no usable credential
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            return {
                "status": "not_ready",
                "mode": "cloud",
                "configuration": {"status": "valid", "errors": []},
                "dependencies": {
                    "model": {
                        "status": "unavailable",
                        "detail": "no Entra credential could be obtained for Azure AI",
                    },
                    "session_store": {"status": "local_mock", "detail": "process-local memory"},
                },
            }
        return {
            "status": "ready",
            "mode": "cloud",
            "configuration": {"status": "valid", "errors": []},
            "dependencies": {
                "model": {
                    "status": "ready",
                    "detail": "Entra credential obtained; model call not probed",
                },
                "session_store": {"status": "local_mock", "detail": "process-local memory"},
            },
        }

    @application.post("/sessions", status_code=status.HTTP_201_CREATED, tags=["sessions"])
    async def create_session(request: SessionCreate) -> dict[str, Any]:
        record = store.create(request.stream)
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="session already exists"
            )
        return _record_json(record)

    @application.get("/sessions/{tenant_id}/{session_id}/{match_id}", tags=["sessions"])
    async def inspect_session(tenant_id: str, session_id: str, match_id: str) -> dict[str, Any]:
        return _record_json(_require_session(tenant_id, session_id, match_id, store))

    @application.put("/sessions/{tenant_id}/{session_id}/{match_id}", tags=["sessions"])
    async def replace_session(
        tenant_id: str, session_id: str, match_id: str, request: SessionReplace
    ) -> dict[str, Any]:
        stream = _stream(tenant_id, session_id, match_id)
        record = store.replace(stream, request.state)
        if record is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")
        return _record_json(record)

    @application.post("/sessions/{tenant_id}/{session_id}/{match_id}/reset", tags=["sessions"])
    async def reset_session(tenant_id: str, session_id: str, match_id: str) -> dict[str, Any]:
        stream = _stream(tenant_id, session_id, match_id)
        record = store.reset(stream)
        if record is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")
        return _record_json(record)

    install_match_routes(application)
    return application


def _stream(tenant_id: str, session_id: str, match_id: str) -> StreamIdentity:
    try:
        return StreamIdentity(tenant_id=tenant_id, session_id=session_id, match_id=match_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


def _require_session(
    tenant_id: str, session_id: str, match_id: str, store: SessionStore
) -> SessionRecord:
    stream = _stream(tenant_id, session_id, match_id)
    record = store.get(stream)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")
    return record


app = create_app()
