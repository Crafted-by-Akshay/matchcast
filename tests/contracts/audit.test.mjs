import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  appendAudit, canonicalJson, ContractError, GENESIS_HASH, recordHash, sha256Hex, validateContract, verifyChain,
} from "../../packages/contracts/dist/src/index.js";

const fixtures = new URL("../../packages/contracts/fixtures/", import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, fixtures), "utf8"));
const valid = read("audit-valid.json");
const tampered = read("audit-tampered.json");

test("valid chain has the same final hash as Python", () => {
  const result = verifyChain(valid.records);
  assert.equal(result.valid, true);
  assert.equal(result.final_hash, valid.final_hash);
  assert.equal(valid.records[0].prev_hash, GENESIS_HASH);
});

test("append reproduces the Python fixture exactly", () => {
  let previous = null;
  const rebuilt = valid.records.map(record => {
    previous = appendAudit(previous, {
      stream: record.stream, actor_kind: record.actor_kind, actor_id: record.actor_id, action: record.action,
      subject_id: record.subject_id, details: record.details, time: record.time, audit_id: record.audit_id,
    });
    return previous;
  });
  assert.deepEqual(rebuilt, valid.records);
});

test("edited details report the first broken record", () => {
  const result = verifyChain(tampered.records);
  assert.equal(result.valid, false);
  assert.equal(result.first_broken_sequence, tampered.first_broken_sequence);
  assert.equal(result.reason, tampered.reason);
});

test("rehashing a tampered record breaks the next link", () => {
  const records = structuredClone(valid.records);
  records[0].details.value = 99;
  records[0].hash = recordHash(records[0]);
  const result = verifyChain(records);
  assert.deepEqual([result.valid, result.first_broken_sequence, result.reason], [false, 2, "prev_hash_mismatch"]);
});

test("structural breaks", () => {
  const gap = structuredClone(valid.records); gap.splice(1, 1);
  assert.deepEqual([verifyChain(gap).first_broken_sequence, verifyChain(gap).reason], [3, "sequence_gap"]);
  const swapped = structuredClone(valid.records).reverse();
  assert.equal(verifyChain(swapped).reason, "sequence_gap");
  const junk = structuredClone(valid.records); junk[1] = { kind: "audit_record" };
  assert.deepEqual([verifyChain(junk).first_broken_sequence, verifyChain(junk).reason], [2, "invalid_schema"]);
  const otherStream = structuredClone(valid.records);
  otherStream[2].stream.match_id = "other"; otherStream[2].hash = recordHash(otherStream[2]);
  assert.equal(verifyChain(otherStream).reason, "stream_mismatch");
});

test("empty chain is valid and ends at genesis", () => {
  assert.deepEqual(verifyChain([]), { valid: true, final_hash: GENESIS_HASH, first_broken_sequence: null, reason: null });
});

test("canonical JSON matches Python", () => {
  const value = { b: [1.0, 2.5, null, true], a: "Köln ☃", c: { z: 0, y: -3.25 } };
  assert.equal(canonicalJson(value), '{"a":"Köln ☃","b":[1,2.5,null,true],"c":{"y":-3.25,"z":0}}');
  for (const bad of [Number.NaN, 1e-7, 1e21, 2 ** 53]) {
    assert.throws(() => canonicalJson({ value: bad }), error => error instanceof ContractError);
  }
});

test("sha256 agrees with node:crypto for every padding boundary", () => {
  for (let length = 0; length < 200; length++) {
    const text = "aé☃x".repeat(Math.ceil(length / 4)).slice(0, length);
    assert.equal(sha256Hex(text), createHash("sha256").update(text).digest("hex"));
  }
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("details over 2 KB are rejected", () => {
  const record = structuredClone(valid.records[0]);
  record.details = { text: "x".repeat(2100) };
  assert.throws(() => validateContract(record), error => error instanceof ContractError && error.code === "details_too_large");
});
