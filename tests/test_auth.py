"""Easy Auth principal parsing and the producer role gate (PLT-5)."""

import base64
import json

import pytest
from app.auth import effective_role, parse_client_principal


def header(*roles: str, name: str = "Ada Lovelace", oid: str = "oid-1") -> str:
    claims = [{"typ": "roles", "val": role} for role in roles]
    claims += [
        {"typ": "name", "val": name},
        {"typ": "http://schemas.microsoft.com/identity/claims/objectidentifier", "val": oid},
    ]
    return base64.b64encode(json.dumps({"auth_typ": "aad", "claims": claims}).encode()).decode()


def test_parse_reads_name_id_and_roles() -> None:
    principal = parse_client_principal(header("Producer", "Viewer"))

    assert principal is not None
    assert principal.name == "Ada Lovelace"
    assert principal.user_id == "oid-1"
    assert principal.roles == ("Producer", "Viewer")


@pytest.mark.parametrize("value", [None, "", "not base64!", base64.b64encode(b"[1]").decode()])
def test_parse_treats_missing_or_malformed_as_anonymous(value: str | None) -> None:
    assert parse_client_principal(value) is None


def test_easy_auth_roles_are_taken_from_the_verified_principal() -> None:
    assert effective_role(header("Producer"), None, easy_auth=True) == "Producer"
    assert effective_role(header("Viewer", "Admin"), None, easy_auth=True) == "Admin"
    assert effective_role(header("Viewer"), None, easy_auth=True) is None


def test_easy_auth_ignores_the_development_role_header() -> None:
    assert effective_role(header("Viewer"), "Producer", easy_auth=True) is None


def test_easy_auth_without_a_caller_is_unauthenticated() -> None:
    with pytest.raises(PermissionError):
        effective_role(None, "Producer", easy_auth=True)


def test_development_header_works_only_without_easy_auth() -> None:
    assert effective_role(None, "Producer", easy_auth=False) == "Producer"
    assert effective_role(None, "Viewer", easy_auth=False) is None
    assert effective_role(header("Producer"), None, easy_auth=False) is None
