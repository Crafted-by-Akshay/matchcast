/* Generated from matchcast_contracts/schemas/v1.json. Do not edit. Run make contracts-generate. */

/**
 * MatchCast wire contracts v1.1.0. Contextual validation is specified in docs/contracts.md.
 */
export type MatchCastContract =
  | Roster
  | EventEnvelope
  | TrackingFrame
  | StateRevisionPacket
  | ClaimPacket
  | PublicationPacket
  | AuditRecord
  | OnAirPacket
  | FeedDropPacket
  | CrewLedgerPacket
  | CrewSpawnPacket;
export type SchemaVersion = "1.0.0" | "1.1.0" | "1.2.0" | "1.3.0";
export type Identifier = string;
export type Sequence = number;
export type Counter = number;
export type Timestamp = string;
export type FootballPayload =
  Goal | Pass | Shot | PeriodBoundary | Tackle | Foul | Card | Carry | PossessionChange | Pressure;
export type ClaimPacket = {
  kind: "claim";
  schema_version: SchemaVersion;
  stream: StreamIdentity;
  claim_id: Identifier;
  source: EventSources | IntervalSources;
  metric: Identifier;
  value: number;
  units: "count" | "m" | "ms" | "s" | "m/s" | "ratio";
  derivation_version: string;
  snapshot: StateRevisionReference;
  max_evidence_sequence: Counter;
  approval_status: "pending" | "approved" | "rejected" | "retracted";
  trace_id?: Identifier;
  tool_call_ids?: Identifier[];
  evidence_ids?: Identifier[];
};
export type Sha256 = string;
export type FeedKey = "casual" | "analyst" | "audio_description" | "catch_me_up" | "half_time" | "ticker";

export interface Roster {
  kind: "roster";
  schema_version: SchemaVersion;
  stream: StreamIdentity;
  pitch: Pitch;
  ball_id: Identifier;
  /**
   * @minItems 2
   * @maxItems 2
   */
  team_ids: [Identifier, Identifier];
  /**
   * @minItems 1
   */
  players: [RosterPlayer, ...RosterPlayer[]];
}
export interface StreamIdentity {
  tenant_id: Identifier;
  session_id: Identifier;
  match_id: Identifier;
}
export interface Pitch {
  length_m: number;
  width_m: number;
}
export interface RosterPlayer {
  player_id: Identifier;
  team_id: Identifier;
}
export interface EventEnvelope {
  kind: "event";
  schema_version: SchemaVersion;
  stream: StreamIdentity;
  event_id: Identifier;
  stream_sequence: Sequence;
  revision: Counter;
  event_time_ms: Counter;
  emitted_at: Timestamp;
  clock: MatchClock;
  payload:
    | Goal
    | Pass
    | Shot
    | PeriodBoundary
    | Tackle
    | Foul
    | Card
    | Carry
    | PossessionChange
    | Pressure
    | Correction
    | Retraction;
}
export interface MatchClock {
  period: 1 | 2 | 3 | 4;
  period_elapsed_ms: Counter;
}
export interface Goal {
  type: "goal";
  player_id: Identifier;
  team_id: Identifier;
  own_goal: boolean;
  position_unit: "m";
  position: GroundPosition;
}
export interface GroundPosition {
  x: number;
  y: number;
  z: 0;
}
export interface Pass {
  type: "pass";
  player_id: Identifier;
  recipient_player_id: Identifier;
  team_id: Identifier;
  position_unit: "m";
  start_position: GroundPosition;
  end_position: GroundPosition;
}
export interface Shot {
  type: "shot";
  player_id: Identifier;
  team_id: Identifier;
  position_unit: "m";
  position: GroundPosition;
  on_target: boolean;
}
export interface PeriodBoundary {
  type: "period_boundary";
  boundary: "started" | "ended";
}
export interface Tackle {
  type: "tackle";
  player_id: Identifier;
  team_id: Identifier;
  target_player_id: Identifier;
  outcome: "won" | "lost";
  position_unit: "m";
  position: GroundPosition;
}
export interface Foul {
  type: "foul";
  player_id: Identifier;
  team_id: Identifier;
  victim_player_id: Identifier;
  advantage: boolean;
  position_unit: "m";
  position: GroundPosition;
}
export interface Card {
  type: "card";
  player_id: Identifier;
  team_id: Identifier;
  colour: "yellow" | "second_yellow" | "red";
  reason: string;
}
export interface Carry {
  type: "carry";
  player_id: Identifier;
  team_id: Identifier;
  position_unit: "m";
  start_position: GroundPosition;
  end_position: GroundPosition;
  duration_ms: number;
}
export interface PossessionChange {
  type: "possession_change";
  from_team_id: Identifier;
  to_team_id: Identifier;
  cause: "tackle" | "interception" | "loose_ball" | "out_of_play" | "foul";
}
export interface Pressure {
  type: "pressure";
  player_id: Identifier;
  team_id: Identifier;
  target_player_id: Identifier;
  distance_m: number;
  closing_speed_mps: number;
  position_unit: "m";
  position: GroundPosition;
}
export interface Correction {
  type: "correction";
  target_event_id: Identifier;
  target_stream_sequence: Sequence;
  target_revision: Counter;
  new_revision: Counter;
  replacement: FootballPayload;
  reason: string;
}
export interface Retraction {
  type: "retraction";
  target_event_id: Identifier;
  target_stream_sequence: Sequence;
  target_revision: Counter;
  new_revision: Counter;
  reason: string;
}
export interface TrackingFrame {
  kind: "tracking_frame";
  schema_version: SchemaVersion;
  stream: StreamIdentity;
  event_id: Identifier;
  stream_sequence: Sequence;
  revision: Counter;
  event_time_ms: Counter;
  emitted_at: Timestamp;
  clock: MatchClock;
  payload: TrackingPayload;
}
export interface TrackingPayload {
  pitch: Pitch;
  position_unit: "m";
  clock_unit: "ms";
  complete: boolean;
  /**
   * @minItems 1
   */
  players: [TrackedPlayer, ...TrackedPlayer[]];
  ball: TrackedBall;
}
export interface TrackedPlayer {
  player_id: Identifier;
  position: GroundPosition;
}
export interface TrackedBall {
  ball_id: Identifier;
  position: Position;
}
export interface Position {
  x: number;
  y: number;
  z: number;
}
export interface StateRevisionPacket {
  kind: "state_revision";
  schema_version: SchemaVersion;
  stream: StreamIdentity;
  snapshot: StateRevisionReference;
}
export interface StateRevisionReference {
  state_revision: Counter;
  max_evidence_sequence: Counter;
  event_time_ms: Counter;
}
export interface EventSources {
  type: "events";
  /**
   * @minItems 1
   */
  events: [SourceEventReference, ...SourceEventReference[]];
}
export interface SourceEventReference {
  event_id: Identifier;
  stream_sequence: Sequence;
  revision: Counter;
}
export interface IntervalSources {
  type: "interval";
  from_event_time_ms: Counter;
  to_event_time_ms: Counter;
  from_stream_sequence: Sequence;
  to_stream_sequence: Sequence;
}
export interface PublicationPacket {
  kind: "publication";
  schema_version: SchemaVersion;
  stream: StreamIdentity;
  publication_id: Identifier;
  /**
   * @minItems 1
   */
  claim_ids: [Identifier, ...Identifier[]];
  state: StateRevisionReference;
  persona: Identifier;
  language: "en" | "ta";
  event_time_ms: Counter;
  published_at: Timestamp;
  expires_at: Timestamp;
  audio_generation_id: Identifier | null;
  text: string;
}
export interface AuditRecord {
  kind: "audit_record";
  schema_version: SchemaVersion;
  stream: StreamIdentity;
  audit_id: Identifier;
  sequence: Sequence;
  time: Timestamp;
  actor_kind: "agent" | "person" | "system";
  actor_id: Identifier;
  action:
    | "event_rejected"
    | "moment_skipped"
    | "claim_created"
    | "line_drafted"
    | "line_verified"
    | "line_review"
    | "line_rejected"
    | "line_repair_requested"
    | "line_abstained"
    | "line_approved"
    | "line_edited"
    | "line_killed"
    | "publication_created"
    | "translation_rejected"
    | "fallback_used"
    | "recap_created"
    | "ask_answered"
    | "talk_answered"
    | "export_created"
    | "safety_blocked"
    | "a2a_call"
    | "a2a_failed"
    | "ds_answered"
    | "ds_unverified"
    | "feed_killed"
    | "feed_resumed";
  subject_id: Identifier;
  details: {
    [k: string]: unknown;
  };
  prev_hash: Sha256;
  hash: Sha256;
}
export interface OnAirPacket {
  kind: "onair";
  schema_version: "1.2.0";
  stream: StreamIdentity;
  publication_id: Identifier;
  feed: FeedKey;
  lang: string;
  text: string;
  /**
   * @minItems 1
   */
  source_event_ids: [Identifier, ...Identifier[]];
  claim_ids: Identifier[];
  match_time_ms: Counter;
  aired_at: Timestamp;
  repair_count: number;
}
export interface FeedDropPacket {
  kind: "feed_drop";
  schema_version: "1.2.0";
  stream: StreamIdentity;
  publication_id: Identifier;
  feed: FeedKey;
  /**
   * @minItems 1
   */
  source_event_ids: [Identifier, ...Identifier[]];
  reason_code:
    | "number_mismatch"
    | "unknown_player"
    | "unknown_source"
    | "stale_state"
    | "unsupported_statement"
    | "unsafe_content"
    | "length_exceeded"
    | "citation_missing"
    | "repeat"
    | "translation";
  repair_count: number;
  audit_id: Identifier;
  match_time_ms: Counter;
}
export interface CrewLedgerPacket {
  kind: "crew_ledger";
  schema_version: "1.3.0";
  stream: StreamIdentity;
  moment_id: Identifier;
  at_ms: Counter;
  called: Identifier[];
  skipped: Identifier[];
  why: string;
  routed_by: "rules" | "model" | "fallback";
  spawn_reason: string;
}
export interface CrewSpawnPacket {
  kind: "crew_spawn";
  schema_version: "1.3.0";
  stream: StreamIdentity;
  moment_id: Identifier;
  spawn_id: Identifier;
  agent_id: Identifier;
  role: string;
  parent_id: Identifier;
  status: "running" | "done" | "no_data" | "failed" | "budget_exhausted";
  started_ms: Counter;
  ended_ms: Counter | null;
  tokens: Counter;
  why: string;
}
