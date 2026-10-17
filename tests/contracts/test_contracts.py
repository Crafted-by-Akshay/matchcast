"""Use the identical JSON corpus in Python and compiled TypeScript, including transport."""

import json
import math
import subprocess
import sys
from pathlib import Path

import pytest
from matchcast_contracts import (
    ContractError,
    validate,
    validate_publication_context,
    validate_revision_change,
)

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "packages/contracts/fixtures"


def read(name: str):
    return json.loads((FIXTURES / name).read_text())


MANIFEST = read("manifest.json")
ROSTER = read(MANIFEST["roster"])
CONTEXTS = read("contexts.json")


@pytest.mark.parametrize("file", MANIFEST["valid"])
def test_valid_wire_fixture(file: str) -> None:
    packet = read(file)
    original = json.dumps(packet, sort_keys=True)
    result = validate(packet, roster=ROSTER)
    assert json.loads(json.dumps(result)) == packet
    assert json.dumps(packet, sort_keys=True) == original, "validator mutated input"


@pytest.mark.parametrize("entry", MANIFEST["invalid"], ids=lambda entry: entry["file"])
def test_invalid_wire_fixture(entry: dict) -> None:
    packet = read(entry["file"])
    original = json.dumps(packet, sort_keys=True)
    with pytest.raises(ContractError) as error:
        validate(packet, roster=ROSTER if entry["with_roster"] else None)
    assert error.value.code == entry["code"]
    assert entry["code"] in str(error.value)
    if "path" in entry:
        assert error.value.path == entry["path"]
    assert json.dumps(packet, sort_keys=True) == original, "invalid input must not be normalized"


def validate_context(entry: dict) -> dict:
    if entry["operation"] == "publication":
        return validate_publication_context(entry["packet"], entry["claims"], entry["state"])
    return validate_revision_change(entry["packet"], entry["target"], roster=ROSTER)


@pytest.mark.parametrize("entry", CONTEXTS["valid"], ids=lambda entry: entry["name"])
def test_valid_context(entry: dict) -> None:
    assert validate_context(entry) == entry["packet"]


@pytest.mark.parametrize("entry", CONTEXTS["invalid"], ids=lambda entry: entry["name"])
def test_invalid_context(entry: dict) -> None:
    with pytest.raises(ContractError) as error:
        validate_context(entry)
    assert error.value.code == entry["code"]


def test_finite_json_numbers_only() -> None:
    for value in (math.nan, math.inf, -math.inf):
        packet = read("claim-events.json")
        packet["value"] = value
        with pytest.raises(ContractError, match="invalid_schema"):
            validate(packet)


def bridge(command: list[str], packets: list) -> list:
    entries = [{"packet": packet, "roster": ROSTER} for packet in packets]
    result = subprocess.run(
        command,
        input=json.dumps(entries),
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
        cwd=ROOT,
    )
    return json.loads(result.stdout)


def test_backend_frontend_backend_and_frontend_backend_frontend_round_trip() -> None:
    packets = [read(file) for file in MANIFEST["valid"]]
    node = ["node", "packages/contracts/scripts/roundtrip.mjs"]
    python = [sys.executable, "-m", "matchcast_contracts"]
    backend = [validate(packet, roster=ROSTER) for packet in packets]
    frontend = bridge(node, backend)
    assert [validate(packet, roster=ROSTER) for packet in frontend] == packets
    assert bridge(node, bridge(python, frontend)) == packets


def test_safe_count_boundary_survives_cross_language_transport_exactly() -> None:
    packet = read("claim-count-max.json")
    assert packet["value"] == 9007199254740991
    node = ["node", "packages/contracts/scripts/roundtrip.mjs"]
    python = [sys.executable, "-m", "matchcast_contracts"]
    frontend = bridge(node, [validate(packet)])
    backend = bridge(python, frontend)
    assert frontend[0]["value"] == backend[0]["value"] == 9007199254740991
    assert bridge(node, backend) == [packet]
