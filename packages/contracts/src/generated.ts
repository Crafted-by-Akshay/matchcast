/* Generated from matchcast_contracts/schemas/v1.json. Do not edit. Run make contracts-generate. */

/**
 * MatchCast wire contracts v1.0.0. Contextual validation is specified in docs/contracts.md.
 */
export type MatchCastContract =
  Roster | EventEnvelope | TrackingFrame | StateRevisionPacket | ClaimPacket | PublicationPacket;
export type SchemaVersion = "1.0.0";
export type Identifier = string;
export type Sequence = number;
export type Counter = number;
export type Timestamp = string;
export type FootballPayload = Goal | Pass | Shot | PeriodBoundary;
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
};

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
  payload: Goal | Pass | Shot | PeriodBoundary | Correction | Retraction;
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
