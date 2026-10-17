import { validateContract, type MatchCastContract, type SchemaVersion,
  type EventEnvelope, type ClaimPacket } from "../../packages/contracts/src/index.js";

// The frontend receives a generated discriminated union only after runtime validation.
export function decodeFrontend(input: unknown, roster: unknown): MatchCastContract {
  return validateContract(input, roster);
}

// @ts-expect-error: unsupported versions must not widen to string in generated types.
const unsupported: SchemaVersion = "2.0.0";
// @ts-expect-error: unknown event variants require a versioned contract change.
const untypedEvent: EventEnvelope["payload"]["type"] = "teleport";
// @ts-expect-error: an arbitrary status must not masquerade as approved evidence.
const unreviewed: ClaimPacket["approval_status"] = "automatic";
void [unsupported, untypedEvent, unreviewed];
