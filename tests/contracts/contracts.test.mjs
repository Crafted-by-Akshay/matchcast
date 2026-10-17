import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ContractError, validateContract, validatePublicationContext, validateRevisionChange,
} from "../../packages/contracts/dist/src/index.js";

const fixtures = new URL("../../packages/contracts/fixtures/", import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, fixtures), "utf8"));
const manifest = read("manifest.json");
const roster = read(manifest.roster);

for (const file of manifest.valid) {
  test(`valid wire fixture: ${file}`, () => {
    const input = read(file);
    const original = structuredClone(input);
    const typed = validateContract(input, roster);
    assert.deepEqual(JSON.parse(JSON.stringify(typed)), original);
    assert.deepEqual(input, original, "validation must not mutate input");
  });
}
for (const entry of manifest.invalid) {
  test(`invalid wire fixture: ${entry.file}`, () => {
    const input = read(entry.file);
    const original = structuredClone(input);
    assert.throws(() => validateContract(input, entry.with_roster ? roster : undefined),
      error => error instanceof ContractError && error.code === entry.code && error.message.includes(entry.code) &&
        (!entry.path || error.path === entry.path));
    assert.deepEqual(input, original, "invalid input must not be normalized");
  });
}
const contexts = read("contexts.json");
function validateContext(entry) {
  return entry.operation === "publication"
    ? validatePublicationContext(entry.packet, entry.claims, entry.state)
    : validateRevisionChange(entry.packet, entry.target, roster);
}
for (const entry of contexts.valid) {
  test(`valid references: ${entry.name}`, () => assert.deepEqual(validateContext(entry), entry.packet));
}
for (const entry of contexts.invalid) {
  test(`invalid references: ${entry.name}`, () => {
    assert.throws(() => validateContext(entry), error => error instanceof ContractError && error.code === entry.code);
  });
}
test("non-finite numbers cannot enter the wire representation", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const claim = read("claim-events.json");
    claim.value = value;
    assert.throws(() => validateContract(claim), error => error.code === "invalid_schema");
  }
});

test("maximum count remains an exact safe integer through JSON transport", () => {
  const packet = validateContract(read("claim-count-max.json"));
  assert.equal(packet.value, Number.MAX_SAFE_INTEGER);
  assert.equal(Number.isSafeInteger(packet.value), true);
  assert.equal(JSON.parse(JSON.stringify(packet)).value, 9007199254740991);
});
