"""Repositories (docs/architecture/07-data-and-storage.md §11) and the in-memory implementation.

Every method takes the stream key ``sk`` ("tenant|session|match"). ``MemoryStore`` is the
only implementation in Sprint 1; ``TableStore`` must pass the same contract tests later.
"""

from typing import Any, Protocol

from matchcast_contracts import audit

from .messages import LineRecord
from .state import MatchState


def stream_key(stream: dict[str, str]) -> str:
    return "|".join((stream["tenant_id"], stream["session_id"], stream["match_id"]))


class EventRepo(Protocol):
    def add_event(self, sk: str, event: dict[str, Any]) -> bool: ...
    def events(self, sk: str, up_to_sequence: int | None = None) -> list[dict[str, Any]]: ...


class StateRepo(Protocol):
    def get_state(self, sk: str) -> MatchState: ...
    def put_state(self, sk: str, state: MatchState) -> None: ...


class ClaimRepo(Protocol):
    def put_claim(self, sk: str, claim: dict[str, Any], meta: dict[str, Any]) -> None: ...
    def get_claim(self, sk: str, claim_id: str) -> dict[str, Any] | None: ...
    def claims(self, sk: str) -> list[dict[str, Any]]: ...


class LineRepo(Protocol):
    def put_line(self, sk: str, line: LineRecord) -> None: ...
    def get_line(self, sk: str, line_id: str) -> LineRecord | None: ...
    def lines(self, sk: str) -> list[LineRecord]: ...


class PublicationRepo(Protocol):
    def put_publication(self, sk: str, publication: dict[str, Any]) -> None: ...
    def publications(self, sk: str) -> list[dict[str, Any]]: ...


class RecapRepo(Protocol):
    def put_recap(self, sk: str, persona: str, recap: dict[str, Any]) -> None: ...
    def get_recap(self, sk: str, persona: str) -> dict[str, Any] | None: ...


class CheckpointRepo(Protocol):
    def put_checkpoint(self, sk: str, row: dict[str, Any]) -> None: ...
    def get_checkpoint(self, sk: str) -> dict[str, Any] | None: ...


class AuditRepo(Protocol):
    def append_audit(self, sk: str, **fields: Any) -> dict[str, Any]: ...
    def audit_records(self, sk: str, from_sequence: int = 1, limit: int = 1000) -> list[dict]: ...


class MemoryStore:
    """Dictionaries behind the repository protocols; one process, no persistence."""

    def __init__(self) -> None:
        self._events: dict[str, list[dict[str, Any]]] = {}
        self._seen: dict[str, set[tuple[str, int]]] = {}
        self._state: dict[str, MatchState] = {}
        self._claims: dict[str, dict[str, dict[str, Any]]] = {}
        self._lines: dict[str, dict[str, LineRecord]] = {}
        self._publications: dict[str, list[dict[str, Any]]] = {}
        self._audit: dict[str, list[dict[str, Any]]] = {}
        self._recaps: dict[str, dict[str, dict[str, Any]]] = {}
        self._checkpoints: dict[str, dict[str, Any]] = {}

    def add_event(self, sk: str, event: dict[str, Any]) -> bool:
        """Store a semantic event once per (event_id, revision); False for a retry."""
        key = (event["event_id"], event["revision"])
        seen = self._seen.setdefault(sk, set())
        if key in seen:
            return False
        seen.add(key)
        self._events.setdefault(sk, []).append(event)
        return True

    def events(self, sk: str, up_to_sequence: int | None = None) -> list[dict[str, Any]]:
        rows = self._events.get(sk, [])
        if up_to_sequence is None:
            return list(rows)
        return [e for e in rows if e["stream_sequence"] <= up_to_sequence]

    def get_state(self, sk: str) -> MatchState:
        return self._state.get(sk, MatchState()).model_copy(deep=True)

    def put_state(self, sk: str, state: MatchState) -> None:
        self._state[sk] = state

    def put_claim(self, sk: str, claim: dict[str, Any], meta: dict[str, Any]) -> None:
        self._claims.setdefault(sk, {})[claim["claim_id"]] = {"packet": claim, **meta}

    def get_claim(self, sk: str, claim_id: str) -> dict[str, Any] | None:
        return self._claims.get(sk, {}).get(claim_id)

    def claims(self, sk: str) -> list[dict[str, Any]]:
        return list(self._claims.get(sk, {}).values())

    def put_line(self, sk: str, line: LineRecord) -> None:
        self._lines.setdefault(sk, {})[line.line_id] = line

    def get_line(self, sk: str, line_id: str) -> LineRecord | None:
        return self._lines.get(sk, {}).get(line_id)

    def lines(self, sk: str) -> list[LineRecord]:
        return list(self._lines.get(sk, {}).values())

    def put_publication(self, sk: str, publication: dict[str, Any]) -> None:
        """Idempotent by publication_id, so a replayed step does not publish twice."""
        rows = self._publications.setdefault(sk, [])
        rows[:] = [p for p in rows if p["publication_id"] != publication["publication_id"]]
        rows.append(publication)

    def put_checkpoint(self, sk: str, row: dict[str, Any]) -> None:
        self._checkpoints[sk] = row

    def get_checkpoint(self, sk: str) -> dict[str, Any] | None:
        return self._checkpoints.get(sk)

    def publications(self, sk: str) -> list[dict[str, Any]]:
        return list(self._publications.get(sk, []))

    def put_recap(self, sk: str, persona: str, recap: dict[str, Any]) -> None:
        self._recaps.setdefault(sk, {})[persona] = recap

    def get_recap(self, sk: str, persona: str) -> dict[str, Any] | None:
        return self._recaps.get(sk, {}).get(persona)

    def append_audit(self, sk: str, **fields: Any) -> dict[str, Any]:
        chain = self._audit.setdefault(sk, [])
        record = audit.append_audit(chain[-1] if chain else None, **fields)
        chain.append(record)
        return record

    def audit_records(self, sk: str, from_sequence: int = 1, limit: int = 1000) -> list[dict]:
        return [r for r in self._audit.get(sk, []) if r["sequence"] >= from_sequence][:limit]
