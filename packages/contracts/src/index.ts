import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import schema from "../matchcast_contracts/schemas/v1.json" with { type: "json" };
import { checkDetails } from "./audit.js";
import type {
  MatchCastContract, Roster, StreamIdentity, Position, FootballPayload,
  ClaimPacket, PublicationPacket, EventEnvelope,
} from "./generated.js";

export type * from "./generated.js";
export * from "./audit.js";
export const SUPPORTED_VERSIONS: readonly string[] = schema.definitions.SchemaVersion.enum;
export const SCHEMA_VERSION = SUPPORTED_VERSIONS[SUPPORTED_VERSIONS.length - 1];
const V1_0_PAYLOADS = new Set(["goal", "pass", "shot", "period_boundary", "correction", "retraction"]);

const ajv = new Ajv({ strict: true, allErrors: false, coerceTypes: false, useDefaults: false });
addFormats(ajv);
ajv.addSchema(schema);
const definitions = schema.definitions as Record<string, {
  properties?: { kind?: { const?: string } };
}>;
const validators = new Map<string, ValidateFunction>();
for (const entry of schema.oneOf) {
  const name = entry.$ref.split("/").at(-1)!;
  const kind = definitions[name].properties!.kind!.const!;
  validators.set(kind, ajv.getSchema(schema.$id + entry.$ref)!);
}

export class ContractError extends Error {
  constructor(public readonly code: string, public readonly path: string, message: string) {
    super(`${code} at ${path || "/"}: ${message}`);
    this.name = "ContractError";
  }
}

function requireContract(condition: unknown, code: string, path: string, message: string): asserts condition {
  if (!condition) throw new ContractError(code, path, message);
}

function sameStream(left: { stream: StreamIdentity }, right: { stream: StreamIdentity }): void {
  requireContract(left.stream.tenant_id === right.stream.tenant_id &&
    left.stream.session_id === right.stream.session_id && left.stream.match_id === right.stream.match_id,
  "stream_mismatch", "/stream", "context belongs to a different tenant/session/match");
}

function position(value: Position, roster: Roster, path: string): void {
  requireContract(value.x <= roster.pitch.length_m && value.y <= roster.pitch.width_m,
    "invalid_coordinates", path, "position exceeds roster pitch bounds in metres");
}

function football(payload: FootballPayload, roster: Roster, path: string): void {
  if (payload.type === "period_boundary") return;
  if (payload.type === "possession_change") {
    for (const key of ["from_team_id", "to_team_id"] as const) {
      requireContract(roster.team_ids.includes(payload[key]), "unknown_team", `${path}/${key}`,
        "team is not in the supplied roster");
    }
    requireContract(payload.from_team_id !== payload.to_team_id, "invalid_possession_change", path,
      "possession must change between two different teams");
    return;
  }
  requireContract(roster.team_ids.includes(payload.team_id), "unknown_team", path + "/team_id",
    "team is not in the supplied roster");
  const players = new Map(roster.players.map(player => [player.player_id, player.team_id]));
  const references: [string, string, boolean][] = [["player_id", payload.player_id, false]];
  if (payload.type === "pass") references.push(["recipient_player_id", payload.recipient_player_id, false]);
  if (payload.type === "tackle" || payload.type === "pressure") {
    references.push(["target_player_id", payload.target_player_id, true]);
  }
  if (payload.type === "foul") references.push(["victim_player_id", payload.victim_player_id, true]);
  for (const [key, id, opposing] of references) {
    requireContract(players.has(id), "unknown_player", `${path}/${key}`, "player is not in the supplied roster");
    const ownGoal = payload.type === "goal" && payload.own_goal;
    requireContract(ownGoal || opposing ? players.get(id) !== payload.team_id : players.get(id) === payload.team_id,
      "player_team_mismatch", `${path}/${key}`, "player/team relationship is invalid");
  }
  if (payload.type === "pass" || payload.type === "carry") {
    position(payload.start_position, roster, path + "/start_position");
    position(payload.end_position, roster, path + "/end_position");
  } else if ("position" in payload) {
    position(payload.position, roster, path + "/position");
  }
}

/** Validate unknown wire input without mutation/coercion. Player references require a roster. */
export function validateContract(input: unknown, rosterInput?: unknown): MatchCastContract {
  requireContract(typeof input === "object" && input !== null && !Array.isArray(input),
    "invalid_schema", "/", "packet must be an object");
  const record = input as Record<string, unknown>;
  if ("schema_version" in record) requireContract(
    typeof record.schema_version === "string" && SUPPORTED_VERSIONS.includes(record.schema_version),
    "unsupported_schema_version", "/schema_version", `supported versions are ${SUPPORTED_VERSIONS.join(", ")}`);
  const validator = typeof record.kind === "string" ? validators.get(record.kind) : undefined;
  requireContract(validator, "invalid_schema", "/kind", "unsupported packet kind");
  if (!validator(input)) {
    const error = validator.errors![0];
    throw new ContractError("invalid_schema", error.instancePath, error.message ?? "schema validation failed");
  }
  const packet = input as MatchCastContract;
  if (packet.kind === "roster") {
    const ids = packet.players.map(player => player.player_id);
    requireContract(new Set(ids).size === ids.length && !ids.includes(packet.ball_id),
      "invalid_roster", "/players", "player IDs must be unique and distinct from the ball");
    requireContract(packet.players.every(player => packet.team_ids.includes(player.team_id)),
      "unknown_team", "/players", "roster player has an unknown team");
  }
  let roster: Roster | undefined;
  if (rosterInput !== undefined && rosterInput !== null) {
    const context = validateContract(rosterInput);
    requireContract(context.kind === "roster", "invalid_schema", "/roster", "expected roster context");
    roster = context;
    sameStream(packet, roster);
  }
  if (packet.kind === "event" || packet.kind === "tracking_frame") {
    requireContract(packet.clock.period_elapsed_ms <= packet.event_time_ms &&
      (packet.clock.period !== 1 || packet.clock.period_elapsed_ms === packet.event_time_ms),
    "invalid_clock", "/clock", "inconsistent period and total active match time");
  }
  if (packet.kind === "tracking_frame") {
    requireContract(roster, "roster_required", "/stream", "tracking requires roster context");
    const payload = packet.payload;
    requireContract(payload.pitch.length_m === roster.pitch.length_m && payload.pitch.width_m === roster.pitch.width_m,
      "pitch_mismatch", "/payload/pitch", "frame and roster must use identical pitch dimensions");
    const known = new Set(roster.players.map(player => player.player_id));
    const seen = new Set<string>();
    for (const [index, player] of payload.players.entries()) {
      const path = `/payload/players/${index}`;
      requireContract(known.has(player.player_id), "unknown_player", path, "player is not in the supplied roster");
      requireContract(!seen.has(player.player_id), "duplicate_reference", path, "duplicate player");
      seen.add(player.player_id);
      position(player.position, roster, path + "/position");
    }
    requireContract(!payload.complete || seen.size === known.size, "incomplete_tracking", "/payload/players",
      "complete frame must contain every roster player");
    requireContract(payload.ball.ball_id === roster.ball_id, "unknown_ball", "/payload/ball",
      "ball is not in the supplied roster");
    position(payload.ball.position, roster, "/payload/ball/position");
  }
  if (packet.kind === "event") {
    let payload: FootballPayload | EventEnvelope["payload"] | undefined = packet.payload;
    let path = "/payload";
    requireContract(V1_0_PAYLOADS.has(payload.type) || packet.schema_version !== "1.0.0",
      "unsupported_schema_version", "/payload/type", "this event type needs schema_version 1.1.0");
    if (payload.type === "correction" || payload.type === "retraction") {
      requireContract(packet.revision === 0 && payload.target_event_id !== packet.event_id &&
        payload.target_stream_sequence < packet.stream_sequence && payload.new_revision === payload.target_revision + 1,
      "invalid_revision", "/payload", "invalid target or revision transition");
      payload = payload.type === "correction" ? payload.replacement : undefined;
      path += "/replacement";
      requireContract(!payload || V1_0_PAYLOADS.has(payload.type) || packet.schema_version !== "1.0.0",
        "unsupported_schema_version", path + "/type", "this event type needs schema_version 1.1.0");
    }
    if (payload && payload.type !== "period_boundary") {
      requireContract(roster, "roster_required", "/stream", "player references need roster");
      football(payload, roster, path);
    }
  }
  if (packet.kind === "claim") {
    requireContract(packet.max_evidence_sequence <= packet.snapshot.max_evidence_sequence,
      "future_evidence", "/max_evidence_sequence", "evidence cannot exceed committed snapshot");
    const source = packet.source;
    if (source.type === "events") {
      const ids = source.events.map(event => event.event_id);
      requireContract(new Set(ids).size === ids.length, "duplicate_reference", "/source/events",
        "source event IDs must be unique");
      requireContract(source.events.every(event => event.stream_sequence <= packet.max_evidence_sequence),
        "future_evidence", "/source/events", "source exceeds maximum evidence sequence");
    } else {
      requireContract(source.from_event_time_ms <= source.to_event_time_ms &&
        source.from_stream_sequence <= source.to_stream_sequence,
      "invalid_interval", "/source", "interval bounds are reversed");
      requireContract(source.to_stream_sequence <= packet.max_evidence_sequence &&
        source.to_event_time_ms <= packet.snapshot.event_time_ms,
      "future_evidence", "/source", "interval exceeds committed evidence");
    }
  }
  if (packet.kind === "audit_record") {
    checkDetails(packet.details);
    requireContract(packet.sequence > 1 || packet.prev_hash === "0".repeat(64), "invalid_chain", "/prev_hash",
      "the first record must use the all-zero genesis hash");
  }
  if (packet.kind === "publication") {
    requireContract(Date.parse(packet.expires_at) > Date.parse(packet.published_at),
      "invalid_expiry", "/expires_at", "expiry must follow publication wall time");
    requireContract(packet.event_time_ms <= packet.state.event_time_ms,
      "future_evidence", "/event_time_ms", "publication is ahead of its state");
  }
  return packet;
}

export function validateRevisionChange(messageInput: unknown, targetInput: unknown, roster?: unknown): EventEnvelope {
  const message = validateContract(messageInput, roster);
  const target = validateContract(targetInput, roster);
  requireContract(message.kind === "event" && target.kind === "event" &&
    (message.payload.type === "correction" || message.payload.type === "retraction") &&
    target.payload.type !== "correction" && target.payload.type !== "retraction",
  "invalid_revision", "/payload", "expected revision message and semantic event target");
  sameStream(message, target);
  const change = message.payload;
  requireContract(change.target_event_id === target.event_id && change.target_stream_sequence === target.stream_sequence &&
    change.target_revision === target.revision, "invalid_revision", "/payload",
  "target identity/sequence/current revision mismatch");
  return message;
}

/** Reference validation only. Approval authenticity, factual recomputation, and delivery-time expiry are external. */
export function validatePublicationContext(input: unknown, claimInputs: unknown[], stateInput: unknown): PublicationPacket {
  const publication = validateContract(input);
  const state = validateContract(stateInput);
  requireContract(publication.kind === "publication" && state.kind === "state_revision",
    "invalid_schema", "/kind", "expected publication and current state packet");
  sameStream(publication, state);
  const sameRevision = (reference: PublicationPacket["state"]) =>
    reference.state_revision === state.snapshot.state_revision &&
    reference.max_evidence_sequence === state.snapshot.max_evidence_sequence &&
    reference.event_time_ms === state.snapshot.event_time_ms;
  requireContract(sameRevision(publication.state), "stale_revision", "/state",
    "publication must reference the supplied current snapshot");
  const byId = new Map<string, ClaimPacket>();
  for (const inputClaim of claimInputs) {
    const claim = validateContract(inputClaim);
    requireContract(claim.kind === "claim", "invalid_schema", "/claims", "expected claim packets");
    requireContract(!byId.has(claim.claim_id), "duplicate_reference", "/claims", "duplicate claim ID");
    byId.set(claim.claim_id, claim);
  }
  for (const id of publication.claim_ids) {
    const claim = byId.get(id);
    requireContract(claim, "missing_claim", "/claim_ids", "referenced claim is absent");
    sameStream(publication, claim);
    requireContract(claim.approval_status === "approved", "unapproved_claim", "/claim_ids",
      "only approved claims may be published");
    requireContract(sameRevision(claim.snapshot), "stale_revision", "/claim_ids",
      "claim must reference the supplied current snapshot");
  }
  return publication;
}
