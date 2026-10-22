"""Caller identity from Container Apps Easy Auth (PLT-5).

Easy Auth validates the Entra token and sends the caller as base64 JSON in the
`X-MS-CLIENT-PRINCIPAL` header, replacing any value a client supplies. The header is only
trusted when `MATCHCAST_EASY_AUTH=1` (set by Bicep when authentication is configured).
Without it, only the local `X-MatchCast-Role` development header is read.
"""

from __future__ import annotations

import base64
import binascii
import json
import os
from dataclasses import dataclass

from fastapi import Header

PRODUCER_ROLES = ("Producer", "Admin")
ROLE_CLAIM_TYPES = ("roles", "http://schemas.microsoft.com/ws/2008/06/identity/claims/role")
NAME_CLAIM_TYPES = ("name", "preferred_username")


@dataclass(frozen=True)
class Principal:
    user_id: str
    name: str
    roles: tuple[str, ...]


def parse_client_principal(value: str | None) -> Principal | None:
    """Decode the Easy Auth header. Returns None for anonymous or malformed values."""
    if not value:
        return None
    try:
        data = json.loads(base64.b64decode(value, validate=True))
    except (binascii.Error, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    claims = [c for c in data.get("claims", []) if isinstance(c, dict)]
    roles = tuple(
        str(c.get("val")) for c in claims if c.get("typ") in ROLE_CLAIM_TYPES and c.get("val")
    )
    name = next((str(c["val"]) for c in claims if c.get("typ") in NAME_CLAIM_TYPES), "")
    user_id = next(
        (
            str(c["val"])
            for c in claims
            if c.get("typ") == "http://schemas.microsoft.com/identity/claims/objectidentifier"
        ),
        str(data.get("userId", "")),
    )
    if not (user_id or name):
        return None
    return Principal(user_id=user_id, name=name, roles=roles)


def easy_auth_enabled() -> bool:
    return os.environ.get("MATCHCAST_EASY_AUTH") == "1"


def effective_role(
    principal_header: str | None, role_header: str | None, *, easy_auth: bool
) -> str | None:
    """The producer-level role of the caller: 'Admin', 'Producer', or None.

    With Easy Auth on, only the verified principal counts. Otherwise the development header
    is used. Raises PermissionError('unauthenticated') when Easy Auth is on and no caller
    arrived, so the route can answer 401 and the browser can start the sign-in.
    """
    if easy_auth:
        principal = parse_client_principal(principal_header)
        if principal is None:
            raise PermissionError("unauthenticated")
        for role in ("Admin", "Producer"):
            if role in principal.roles:
                return role
        return None
    return role_header if role_header in PRODUCER_ROLES else None


def caller_role(
    x_ms_client_principal: str | None = Header(default=None),
    x_matchcast_role: str | None = Header(default=None),
) -> str | None:
    """FastAPI dependency: the caller's producer-level role."""
    from app.matches import Problem  # local import: matches imports this module

    try:
        return effective_role(
            x_ms_client_principal, x_matchcast_role, easy_auth=easy_auth_enabled()
        )
    except PermissionError as error:
        raise Problem(401, "unauthenticated", "sign in to use this route") from error
