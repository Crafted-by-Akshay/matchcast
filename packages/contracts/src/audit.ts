/**
 * Append-only audit records linked by a SHA-256 hash chain; byte-for-byte twin of
 * matchcast_contracts/audit.py. hash = SHA-256 of the canonical JSON (sorted keys, no
 * spaces, UTF-8) of the record without `hash`; the first record uses GENESIS_HASH.
 */
import type { AuditRecord, StreamIdentity } from "./generated.js";
import { ContractError, AUDIT_SCHEMA_VERSION, validateContract } from "./index.js";

export const GENESIS_HASH = "0".repeat(64);
export const MAX_DETAILS_BYTES = 2048;
const MAX_EXACT = Number.MAX_SAFE_INTEGER;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function canonicalise(value: unknown, path: string): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ContractError("invalid_schema", path, "numbers must be finite");
    if (Number.isInteger(value) && Math.abs(value) > MAX_EXACT) {
      throw new ContractError("invalid_schema", path, "integer outside the exact JSON range");
    }
    const text = JSON.stringify(value);
    if (text.includes("e")) throw new ContractError("invalid_schema", path, "number needs exponent notation");
    return text;
  }
  if (Array.isArray(value)) return `[${value.map((item, index) => canonicalise(item, `${path}/${index}`)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalise(item, `${path}/${key}`)}`).join(",")}}`;
  }
  throw new ContractError("invalid_schema", path, "value is not JSON");
}

/** Sorted keys (code-point order for BMP keys), no spaces, integral numbers written as integers. */
export function canonicalJson(value: unknown): string {
  return canonicalise(value, "");
}

export function checkDetails(details: unknown, path = "/details"): void {
  const size = new TextEncoder().encode(canonicalJson(details)).length;
  if (size > MAX_DETAILS_BYTES) {
    throw new ContractError("details_too_large", path, `details are ${size} bytes; the limit is ${MAX_DETAILS_BYTES}`);
  }
}

const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Synchronous SHA-256 so the same helper runs in Node and in the browser. */
export function sha256Hex(text: string): string {
  const data = new TextEncoder().encode(text);
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((data.length * 8) / 0x100000000));
  view.setUint32(padded.length - 4, (data.length * 8) >>> 0);
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, word => word.toString(16).padStart(8, "0")).join("");
}

/** SHA-256 over the canonical JSON of the record without its `hash` field. */
export function recordHash(record: Omit<AuditRecord, "hash"> | AuditRecord): string {
  const body: Record<string, unknown> = { ...record };
  delete body.hash;
  return sha256Hex(canonicalJson(body));
}

export interface AppendAuditInput {
  stream: StreamIdentity;
  actor_kind: AuditRecord["actor_kind"];
  actor_id: string;
  action: AuditRecord["action"];
  subject_id: string;
  details: { [key: string]: JsonValue };
  time: string;
  audit_id?: string;
}

/** Pure: returns the record after `previous` (the first record when null); the caller stores it. */
export function appendAudit(previous: AuditRecord | null, input: AppendAuditInput): AuditRecord {
  if (previous && canonicalJson(previous.stream) !== canonicalJson(input.stream)) {
    throw new ContractError("stream_mismatch", "/stream", "previous record is another stream");
  }
  const sequence = previous ? previous.sequence + 1 : 1;
  const record: Omit<AuditRecord, "hash"> = {
    kind: "audit_record",
    schema_version: AUDIT_SCHEMA_VERSION as AuditRecord["schema_version"],
    stream: input.stream,
    audit_id: input.audit_id ?? `audit-${sequence}`,
    sequence,
    time: input.time,
    actor_kind: input.actor_kind,
    actor_id: input.actor_id,
    action: input.action,
    subject_id: input.subject_id,
    details: input.details,
    prev_hash: previous ? previous.hash : GENESIS_HASH,
  };
  const full = { ...record, hash: recordHash(record) };
  const checked = validateContract(full);
  return checked as AuditRecord;
}

export interface ChainResult {
  valid: boolean;
  final_hash: string | null;
  first_broken_sequence: number | null;
  reason: string | null;
}

/** Check a whole chain; report the first broken record instead of throwing. */
export function verifyChain(records: unknown[]): ChainResult {
  let previousHash = GENESIS_HASH;
  const first = records[0] as { stream?: unknown } | undefined;
  const stream = first && typeof first === "object" ? canonicalJsonSafe(first.stream) : null;
  for (const [index, entry] of records.entries()) {
    const position = index + 1;
    const sequence = (entry as { sequence?: unknown } | null)?.sequence;
    const broken = (reason: string): ChainResult => ({
      valid: false,
      final_hash: null,
      first_broken_sequence: Number.isSafeInteger(sequence) && (sequence as number) >= 1 ? (sequence as number) : position,
      reason,
    });
    let record: AuditRecord;
    try {
      const packet = validateContract(entry);
      if (packet.kind !== "audit_record") return broken("invalid_schema");
      record = packet;
    } catch (error) {
      return broken(error instanceof ContractError ? error.code : "invalid_schema");
    }
    if (canonicalJsonSafe(record.stream) !== stream) return broken("stream_mismatch");
    if (record.sequence !== position) return broken("sequence_gap");
    if (record.prev_hash !== previousHash) return broken("prev_hash_mismatch");
    if (record.hash !== recordHash(record)) return broken("hash_mismatch");
    previousHash = record.hash;
  }
  return { valid: true, final_hash: previousHash, first_broken_sequence: null, reason: null };
}

function canonicalJsonSafe(value: unknown): string | null {
  try {
    return canonicalJson(value);
  } catch {
    return null;
  }
}
