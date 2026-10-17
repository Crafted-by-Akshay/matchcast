"""Replaceable session storage interface and isolated in-memory implementation."""

from __future__ import annotations

import json
import re
from copy import deepcopy
from dataclasses import dataclass
from importlib.resources import files
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field, field_validator

_SCHEMA = json.loads(
    files("matchcast_contracts").joinpath("schemas/v1.json").read_text()
)
_IDENTIFIER_PATTERN = _SCHEMA["definitions"]["Identifier"]["pattern"]


class StreamIdentity(BaseModel):
    """S02 stream identity: tenant, session, and match are all required."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    tenant_id: str = Field(strict=True)
    session_id: str = Field(strict=True)
    match_id: str = Field(strict=True)

    @field_validator("tenant_id", "session_id", "match_id")
    @classmethod
    def validate_identifier(cls, value: str) -> str:
        if not re.fullmatch(_IDENTIFIER_PATTERN, value):
            raise ValueError("must be a 1-128 character S02 identifier")
        return value

    def key(self) -> tuple[str, str, str]:
        return (self.tenant_id, self.session_id, self.match_id)


class SessionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stream: StreamIdentity


class SessionReplace(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: dict[str, Any]

    @field_validator("state")
    @classmethod
    def state_must_be_json(cls, value: dict[str, Any]) -> dict[str, Any]:
        try:
            json.dumps(value, allow_nan=False)
        except (TypeError, ValueError) as exc:
            raise ValueError("state must contain finite JSON-compatible values") from exc
        return value


@dataclass(frozen=True)
class SessionRecord:
    stream: StreamIdentity
    state: dict[str, Any]
    state_revision: int


class SessionStore(Protocol):
    """Small persistence boundary; future durable implementations can replace this."""

    def create(self, stream: StreamIdentity) -> SessionRecord | None: ...

    def get(self, stream: StreamIdentity) -> SessionRecord | None: ...

    def replace(self, stream: StreamIdentity, state: dict[str, Any]) -> SessionRecord | None: ...

    def reset(self, stream: StreamIdentity) -> SessionRecord | None: ...


class InMemorySessionStore:
    """Process-local registry keyed by the complete (tenant, session, match) tuple."""

    def __init__(self) -> None:
        self._sessions: dict[tuple[str, str, str], SessionRecord] = {}

    def create(self, stream: StreamIdentity) -> SessionRecord | None:
        key = stream.key()
        if key in self._sessions:
            return None
        record = SessionRecord(stream=stream, state={}, state_revision=0)
        self._sessions[key] = record
        return self._copy(record)

    def get(self, stream: StreamIdentity) -> SessionRecord | None:
        record = self._sessions.get(stream.key())
        return self._copy(record) if record is not None else None

    def replace(self, stream: StreamIdentity, state: dict[str, Any]) -> SessionRecord | None:
        current = self._sessions.get(stream.key())
        if current is None:
            return None
        record = SessionRecord(stream, deepcopy(state), current.state_revision + 1)
        self._sessions[stream.key()] = record
        return self._copy(record)

    def reset(self, stream: StreamIdentity) -> SessionRecord | None:
        return self.replace(stream, {})

    @staticmethod
    def _copy(record: SessionRecord) -> SessionRecord:
        return SessionRecord(record.stream, deepcopy(record.state), record.state_revision)
