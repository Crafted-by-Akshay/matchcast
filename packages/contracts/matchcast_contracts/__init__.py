"""Validate the canonical wire schemas, then explicit contextual relationships."""

import json
from datetime import datetime
from importlib.resources import files
from typing import Any

from jsonschema import Draft7Validator, FormatChecker

_SCHEMA = json.loads(files(__package__).joinpath("schemas/v1.json").read_text())
Draft7Validator.check_schema(_SCHEMA)
SUPPORTED_VERSIONS = tuple(_SCHEMA["definitions"]["SchemaVersion"]["enum"])
SCHEMA_VERSION = SUPPORTED_VERSIONS[-1]
V1_0_PAYLOADS = frozenset({"goal", "pass", "shot", "period_boundary", "correction", "retraction"})
_VALIDATORS = {}
for _entry in _SCHEMA["oneOf"]:
    _definition = _SCHEMA["definitions"][_entry["$ref"].split("/")[-1]]
    _VALIDATORS[_definition["properties"]["kind"]["const"]] = Draft7Validator(
        {"$schema": _SCHEMA["$schema"], "definitions": _SCHEMA["definitions"], **_entry},
        format_checker=FormatChecker(),
    )


class ContractError(ValueError):
    """Stable error code and JSON pointer; never silently repair invalid input."""

    def __init__(self, code: str, path: str, message: str):
        self.code = code
        self.path = path
        super().__init__(f"{code} at {path or '/'}: {message}")


def _require(condition: bool, code: str, path: str, message: str) -> None:
    if not condition:
        raise ContractError(code, path, message)


def _same_stream(left: dict, right: dict) -> None:
    _require(
        left["stream"] == right["stream"],
        "stream_mismatch",
        "/stream",
        "context belongs to a different tenant/session/match",
    )


def _position(position: dict, roster: dict, path: str) -> None:
    _require(
        position["x"] <= roster["pitch"]["length_m"]
        and position["y"] <= roster["pitch"]["width_m"],
        "invalid_coordinates",
        path,
        "position exceeds roster pitch bounds in metres",
    )


def _football(payload: dict, roster: dict, path: str) -> None:
    if payload["type"] == "period_boundary":
        return
    players = {player["player_id"]: player["team_id"] for player in roster["players"]}
    if payload["type"] == "possession_change":
        for key in ("from_team_id", "to_team_id"):
            _require(
                payload[key] in roster["team_ids"],
                "unknown_team",
                f"{path}/{key}",
                "team is not in the supplied roster",
            )
        _require(
            payload["from_team_id"] != payload["to_team_id"],
            "invalid_possession_change",
            path,
            "possession must change between two different teams",
        )
        return
    team = payload["team_id"]
    _require(
        team in roster["team_ids"],
        "unknown_team",
        path + "/team_id",
        "team is not in the supplied roster",
    )
    for key in ("player_id", "recipient_player_id", "target_player_id", "victim_player_id"):
        if key in payload:
            player = payload[key]
            _require(
                player in players,
                "unknown_player",
                f"{path}/{key}",
                "player is not in the supplied roster",
            )
            own_goal = payload["type"] == "goal" and payload["own_goal"]
            opposing = key in ("target_player_id", "victim_player_id")
            _require(
                (players[player] != team) if own_goal or opposing else (players[player] == team),
                "player_team_mismatch",
                f"{path}/{key}",
                "player/team relationship is invalid",
            )
    for key in ("position", "start_position", "end_position"):
        if key in payload:
            _position(payload[key], roster, f"{path}/{key}")


def validate(packet: Any, *, roster: Any = None) -> dict:
    """Validate one JSON-compatible packet. Player-bearing packets require a roster.

    The returned object is the original input; validation does not coerce or mutate.
    Approval provenance, historical ordering, and current state need external context.
    """
    _require(isinstance(packet, dict), "invalid_schema", "/", "packet must be an object")
    try:
        json.dumps(packet, allow_nan=False)
    except (ValueError, TypeError) as exc:
        raise ContractError(
            "invalid_schema", "/", "packet must contain finite JSON values"
        ) from exc
    if "schema_version" in packet:
        _require(
            packet["schema_version"] in SUPPORTED_VERSIONS,
            "unsupported_schema_version",
            "/schema_version",
            f"supported versions are {', '.join(SUPPORTED_VERSIONS)}",
        )
    kind = packet.get("kind")
    _require(
        isinstance(kind, str) and kind in _VALIDATORS,
        "invalid_schema",
        "/kind",
        "unsupported packet kind",
    )
    error = next(_VALIDATORS[kind].iter_errors(packet), None)
    if error is not None:
        path = "/" + "/".join(str(part) for part in error.absolute_path)
        raise ContractError("invalid_schema", path, error.message)

    if kind == "roster":
        ids = [player["player_id"] for player in packet["players"]]
        _require(
            len(ids) == len(set(ids)) and packet["ball_id"] not in ids,
            "invalid_roster",
            "/players",
            "player IDs must be unique and distinct from the ball",
        )
        _require(
            all(p["team_id"] in packet["team_ids"] for p in packet["players"]),
            "unknown_team",
            "/players",
            "roster player has an unknown team",
        )
    if roster is not None:
        roster = validate(roster)
        _require(roster["kind"] == "roster", "invalid_schema", "/roster", "expected roster context")
        _same_stream(packet, roster)

    if kind in ("event", "tracking_frame"):
        clock = packet["clock"]
        _require(
            clock["period_elapsed_ms"] <= packet["event_time_ms"]
            and (clock["period"] != 1 or clock["period_elapsed_ms"] == packet["event_time_ms"]),
            "invalid_clock",
            "/clock",
            "inconsistent period and total active match time",
        )
    if kind == "tracking_frame":
        _require(
            roster is not None, "roster_required", "/stream", "tracking requires roster context"
        )
        payload = packet["payload"]
        _require(
            payload["pitch"] == roster["pitch"],
            "pitch_mismatch",
            "/payload/pitch",
            "frame and roster must use identical pitch dimensions",
        )
        known = {p["player_id"] for p in roster["players"]}
        seen = set()
        for index, player in enumerate(payload["players"]):
            path = f"/payload/players/{index}"
            _require(
                player["player_id"] in known,
                "unknown_player",
                path,
                "player is not in the supplied roster",
            )
            _require(
                player["player_id"] not in seen, "duplicate_reference", path, "duplicate player"
            )
            seen.add(player["player_id"])
            _position(player["position"], roster, path + "/position")
        _require(
            not payload["complete"] or seen == known,
            "incomplete_tracking",
            "/payload/players",
            "complete frame must contain every roster player",
        )
        _require(
            payload["ball"]["ball_id"] == roster["ball_id"],
            "unknown_ball",
            "/payload/ball",
            "ball is not in the supplied roster",
        )
        _position(payload["ball"]["position"], roster, "/payload/ball/position")
    if kind == "event":
        payload = packet["payload"]
        path = "/payload"
        _require(
            payload["type"] in V1_0_PAYLOADS or packet["schema_version"] != "1.0.0",
            "unsupported_schema_version",
            "/payload/type",
            "this event type needs schema_version 1.1.0",
        )
        if payload["type"] in ("correction", "retraction"):
            _require(
                packet["revision"] == 0
                and payload["target_event_id"] != packet["event_id"]
                and payload["target_stream_sequence"] < packet["stream_sequence"]
                and payload["new_revision"] == payload["target_revision"] + 1,
                "invalid_revision",
                "/payload",
                "invalid target or revision transition",
            )
            payload = payload.get("replacement")
            path += "/replacement"
        _require(
            payload is None
            or payload["type"] in V1_0_PAYLOADS
            or packet["schema_version"] != "1.0.0",
            "unsupported_schema_version",
            path + "/type",
            "this event type needs schema_version 1.1.0",
        )
        if payload is not None and payload["type"] != "period_boundary":
            _require(
                roster is not None, "roster_required", "/stream", "player references need roster"
            )
            _football(payload, roster, path)
    if kind == "claim":
        maximum = packet["max_evidence_sequence"]
        snapshot = packet["snapshot"]
        _require(
            maximum <= snapshot["max_evidence_sequence"],
            "future_evidence",
            "/max_evidence_sequence",
            "evidence cannot exceed committed snapshot",
        )
        source = packet["source"]
        if source["type"] == "events":
            ids = [event["event_id"] for event in source["events"]]
            _require(
                len(set(ids)) == len(ids),
                "duplicate_reference",
                "/source/events",
                "source event IDs must be unique",
            )
            _require(
                all(e["stream_sequence"] <= maximum for e in source["events"]),
                "future_evidence",
                "/source/events",
                "source exceeds maximum evidence sequence",
            )
        else:
            _require(
                source["from_event_time_ms"] <= source["to_event_time_ms"]
                and source["from_stream_sequence"] <= source["to_stream_sequence"],
                "invalid_interval",
                "/source",
                "interval bounds are reversed",
            )
            _require(
                source["to_stream_sequence"] <= maximum
                and source["to_event_time_ms"] <= snapshot["event_time_ms"],
                "future_evidence",
                "/source",
                "interval exceeds committed evidence",
            )
    if kind == "publication":
        _require(
            datetime.fromisoformat(packet["expires_at"])
            > datetime.fromisoformat(packet["published_at"]),
            "invalid_expiry",
            "/expires_at",
            "expiry must follow publication wall time",
        )
        _require(
            packet["event_time_ms"] <= packet["state"]["event_time_ms"],
            "future_evidence",
            "/event_time_ms",
            "publication is ahead of its state",
        )
    return packet


def validate_revision_change(message: Any, target: Any, *, roster: Any = None) -> dict:
    """Check a correction/retraction against its supplied current semantic event."""
    message = validate(message, roster=roster)
    target = validate(target, roster=roster)
    _require(
        message["kind"] == target["kind"] == "event"
        and message["payload"]["type"] in ("correction", "retraction")
        and target["payload"]["type"] not in ("correction", "retraction"),
        "invalid_revision",
        "/payload",
        "expected revision message and semantic event target",
    )
    _same_stream(message, target)
    change = message["payload"]
    _require(
        change["target_event_id"] == target["event_id"]
        and change["target_stream_sequence"] == target["stream_sequence"]
        and change["target_revision"] == target["revision"],
        "invalid_revision",
        "/payload",
        "target identity/sequence/current revision mismatch",
    )
    return message


def validate_publication_context(publication: Any, claims: list, state: Any) -> dict:
    """Require referenced approved claims at the supplied current state revision.

    This checks references, not the truth of a claim or the authority of its approver.
    Expiry at delivery/synthesis time remains a consumer obligation.
    """
    publication = validate(publication)
    state = validate(state)
    _require(
        publication["kind"] == "publication" and state["kind"] == "state_revision",
        "invalid_schema",
        "/kind",
        "expected publication and current state packet",
    )
    _same_stream(publication, state)
    _require(
        publication["state"] == state["snapshot"],
        "stale_revision",
        "/state",
        "publication must reference the supplied current snapshot",
    )
    by_id = {}
    for claim in claims:
        claim = validate(claim)
        _require(claim["kind"] == "claim", "invalid_schema", "/claims", "expected claim packets")
        _require(
            claim["claim_id"] not in by_id, "duplicate_reference", "/claims", "duplicate claim ID"
        )
        by_id[claim["claim_id"]] = claim
    for claim_id in publication["claim_ids"]:
        _require(claim_id in by_id, "missing_claim", "/claim_ids", "referenced claim is absent")
        claim = by_id[claim_id]
        _same_stream(publication, claim)
        _require(
            claim["approval_status"] == "approved",
            "unapproved_claim",
            "/claim_ids",
            "only approved claims may be published",
        )
        _require(
            claim["snapshot"] == state["snapshot"],
            "stale_revision",
            "/claim_ids",
            "claim must reference the supplied current snapshot",
        )
    return publication
