"""Append-only audit records linked by a SHA-256 hash chain.

hash = SHA-256 of the canonical JSON (sorted keys, no spaces, UTF-8) of the record
without ``hash``. ``prev_hash`` is the previous record's hash; the first record uses
``GENESIS_HASH``. The TypeScript twin in ``src/audit.ts`` must produce identical bytes.
"""

import hashlib
import json
import math
from typing import Any

from . import AUDIT_SCHEMA_VERSION, ContractError, validate

GENESIS_HASH = "0" * 64
MAX_DETAILS_BYTES = 2048
_MAX_EXACT = 9007199254740991


def _normalise(value: Any, path: str) -> Any:
    """Reject values whose JSON text could differ between Python and JavaScript."""
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, int):
        if abs(value) > _MAX_EXACT:
            raise ContractError("invalid_schema", path, "integer outside the exact JSON range")
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ContractError("invalid_schema", path, "numbers must be finite")
        if value.is_integer() and abs(value) <= _MAX_EXACT:
            return int(value)
        if "e" in repr(value):
            raise ContractError("invalid_schema", path, "number needs exponent notation")
        return value
    if isinstance(value, list):
        return [_normalise(item, f"{path}/{index}") for index, item in enumerate(value)]
    if isinstance(value, dict):
        return {key: _normalise(item, f"{path}/{key}") for key, item in value.items()}
    raise ContractError("invalid_schema", path, "value is not JSON")


def canonical_json(value: Any) -> str:
    """Sorted keys, no spaces, non-ASCII kept as UTF-8, integral floats written as integers."""
    return json.dumps(
        _normalise(value, ""),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def check_details(details: Any, path: str = "/details") -> None:
    size = len(canonical_json(details).encode("utf-8"))
    if size > MAX_DETAILS_BYTES:
        raise ContractError(
            "details_too_large", path, f"details are {size} bytes; the limit is {MAX_DETAILS_BYTES}"
        )


def record_hash(record: dict) -> str:
    """SHA-256 over the canonical JSON of the record without its ``hash`` field."""
    body = {key: value for key, value in record.items() if key != "hash"}
    return hashlib.sha256(canonical_json(body).encode("utf-8")).hexdigest()


def append_audit(
    previous: dict | None,
    *,
    stream: dict,
    actor_kind: str,
    actor_id: str,
    action: str,
    subject_id: str,
    details: dict,
    time: str,
    audit_id: str | None = None,
) -> dict:
    """Return the next record after ``previous`` (or the first record when it is None).

    Pure: nothing is stored or mutated. The caller persists the record and must
    serialise appends per stream, because the sequence and prev_hash come from ``previous``.
    """
    if previous is not None:
        if previous["stream"] != stream:
            raise ContractError("stream_mismatch", "/stream", "previous record is another stream")
        sequence, prev_hash = previous["sequence"] + 1, previous["hash"]
    else:
        sequence, prev_hash = 1, GENESIS_HASH
    record = {
        "kind": "audit_record",
        "schema_version": AUDIT_SCHEMA_VERSION,
        "stream": stream,
        "audit_id": audit_id or f"audit-{sequence}",
        "sequence": sequence,
        "time": time,
        "actor_kind": actor_kind,
        "actor_id": actor_id,
        "action": action,
        "subject_id": subject_id,
        "details": _normalise(details, "/details"),
        "prev_hash": prev_hash,
    }
    record["hash"] = record_hash(record)
    return validate(record)


def verify_chain(records: list[dict]) -> dict:
    """Check a whole chain; report the first broken record instead of raising.

    Returns ``{"valid", "final_hash", "first_broken_sequence", "reason"}``. For an empty
    chain, ``final_hash`` is ``GENESIS_HASH``. When broken, ``first_broken_sequence`` is the
    ``sequence`` field of the first bad record, or its 1-based position if that field is unusable.
    """
    previous_hash = GENESIS_HASH
    stream = records[0].get("stream") if records else None
    for index, record in enumerate(records):
        position = index + 1

        def broken(reason: str, record: dict = record, position: int = position) -> dict:
            sequence = record.get("sequence") if isinstance(record, dict) else None
            ok = isinstance(sequence, int) and not isinstance(sequence, bool) and sequence >= 1
            return {
                "valid": False,
                "final_hash": None,
                "first_broken_sequence": sequence if ok else position,
                "reason": reason,
            }

        try:
            validate(record)
        except ContractError as error:
            return broken(error.code)
        if record["kind"] != "audit_record":
            return broken("invalid_schema")
        if record["stream"] != stream:
            return broken("stream_mismatch")
        if record["sequence"] != position:
            return broken("sequence_gap")
        if record["prev_hash"] != previous_hash:
            return broken("prev_hash_mismatch")
        if record["hash"] != record_hash(record):
            return broken("hash_mismatch")
        previous_hash = record["hash"]
    return {
        "valid": True,
        "final_hash": previous_hash,
        "first_broken_sequence": None,
        "reason": None,
    }
