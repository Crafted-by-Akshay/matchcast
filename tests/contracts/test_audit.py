"""Audit hash chain: shared vectors, tamper detection and canonical JSON edge cases."""

import copy
import json
from pathlib import Path

import pytest
from matchcast_contracts import ContractError, validate
from matchcast_contracts.audit import (
    GENESIS_HASH,
    append_audit,
    canonical_json,
    record_hash,
    verify_chain,
)

FIXTURES = Path(__file__).resolve().parents[2] / "packages/contracts/fixtures"
VALID = json.loads((FIXTURES / "audit-valid.json").read_text())
TAMPERED = json.loads((FIXTURES / "audit-tampered.json").read_text())


def rebuild(records: list[dict]) -> list[dict]:
    chain: list[dict] = []
    previous = None
    for record in records:
        previous = append_audit(
            previous,
            stream=record["stream"],
            actor_kind=record["actor_kind"],
            actor_id=record["actor_id"],
            action=record["action"],
            subject_id=record["subject_id"],
            details=record["details"],
            time=record["time"],
            audit_id=record["audit_id"],
        )
        chain.append(previous)
    return chain


def test_valid_chain_has_the_shared_final_hash() -> None:
    result = verify_chain(VALID["records"])
    assert result["valid"] is True
    assert result["final_hash"] == VALID["final_hash"]
    assert VALID["records"][0]["prev_hash"] == GENESIS_HASH


def test_append_reproduces_the_fixture_exactly() -> None:
    assert rebuild(VALID["records"]) == VALID["records"]


def test_edited_details_report_the_first_broken_record() -> None:
    result = verify_chain(TAMPERED["records"])
    assert result["valid"] is False
    assert result["first_broken_sequence"] == TAMPERED["first_broken_sequence"] == 2
    assert result["reason"] == "hash_mismatch"


def test_rehashing_a_tampered_record_breaks_the_next_link() -> None:
    records = copy.deepcopy(VALID["records"])
    records[0]["details"]["value"] = 99
    records[0]["hash"] = record_hash(records[0])
    result = verify_chain(records)
    assert (result["valid"], result["first_broken_sequence"]) == (False, 2)
    assert result["reason"] == "prev_hash_mismatch"


@pytest.mark.parametrize(
    ("mutate", "sequence", "reason"),
    [
        (lambda r: r.pop(1), 3, "sequence_gap"),
        (lambda r: r.reverse(), 3, "sequence_gap"),
        (lambda r: r.__setitem__(1, {"kind": "audit_record"}), 2, "invalid_schema"),
    ],
)
def test_structural_breaks(mutate, sequence: int, reason: str) -> None:
    records = copy.deepcopy(VALID["records"])
    mutate(records)
    result = verify_chain(records)
    assert result["valid"] is False
    assert result["reason"] == reason
    assert result["first_broken_sequence"] == sequence


def test_empty_chain_is_valid_and_ends_at_genesis() -> None:
    assert verify_chain([]) == {
        "valid": True,
        "final_hash": GENESIS_HASH,
        "first_broken_sequence": None,
        "reason": None,
    }


def test_records_from_another_stream_are_rejected() -> None:
    records = copy.deepcopy(VALID["records"])
    records[2]["stream"]["match_id"] = "other"
    records[2]["hash"] = record_hash(records[2])
    assert verify_chain(records)["reason"] == "stream_mismatch"


def test_append_rejects_a_different_stream() -> None:
    other = {**VALID["records"][0]["stream"], "session_id": "other"}
    with pytest.raises(ContractError, match="stream_mismatch"):
        append_audit(
            VALID["records"][0],
            stream=other,
            actor_kind="system",
            actor_id="api",
            action="export_created",
            subject_id="export-1",
            details={},
            time="2026-10-22T10:01:00.000Z",
        )


def test_unknown_action_is_rejected() -> None:
    record = copy.deepcopy(VALID["records"][0])
    record["action"] = "line_deleted"
    with pytest.raises(ContractError, match="invalid_schema"):
        validate(record)


def test_canonical_json_is_stable_across_languages() -> None:
    value = {"b": [1.0, 2.5, None, True], "a": "Köln ☃", "c": {"z": 0, "y": -3.25}}
    assert canonical_json(value) == ('{"a":"Köln ☃","b":[1,2.5,null,true],"c":{"y":-3.25,"z":0}}')


@pytest.mark.parametrize("bad", [float("nan"), 1e-7, 1e21, 2**53])
def test_numbers_that_could_differ_between_languages_are_rejected(bad: float) -> None:
    with pytest.raises(ContractError):
        canonical_json({"value": bad})
