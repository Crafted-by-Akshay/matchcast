---
name: matchcast-contracts
description: Use when reading, validating or changing MatchCast wire contracts (event, claim, line, publication, audit_record, roster), the JSON Schema, fixtures or the audit hash chain.
---

# MatchCast contracts

Canonical doc: `docs/contracts.md` (wire schema 1.1.0). Canonical schema: `packages/contracts/matchcast_contracts/schemas/v1.json` (Draft 7, every object closed with `additionalProperties: false`).

## Rules
- `packages/contracts/src/generated.ts` is generated. Never edit it: change the JSON Schema, then `make contracts-generate`. `make contracts-check` (inside `make lint`) fails on drift.
- Changing a contract needs all-lane agreement first (root `CLAUDE.md`). Additive change = minor semver; old versions stay in `SUPPORTED_VERSIONS`. 1.1 event types (`tackle`, `foul`, `card`, `carry`, `possession_change`, `pressure`) need `schema_version: "1.1.0"`.
- Validate everything from outside as unknown: Python `from matchcast_contracts import validate; validate(packet, roster=roster)`, TypeScript `validateContract(json, roster)`. Player-bearing events and tracking frames need the roster, otherwise `roster_required`.
- Stream key is `(tenant_id, session_id, match_id)`; context from another tuple is rejected. Positions are metres, inside the roster pitch, z=0 for players. Wall-clock fields are UTC RFC 3339 with literal `Z`.
- Order is `stream_sequence`, not `emitted_at`. Retries keep id, sequence and content; corrections and retractions are new messages that target an earlier sequence.

## Fixtures and tests
- `packages/contracts/fixtures/*.json` positive, `fixtures/invalid/*.json` negative, indexed by `fixtures/manifest.json`; `contexts.json` holds reference-validation cases. Both the Python and Node suites read the same files, so add one fixture and register it once.
- `make test` builds the contracts package, runs the Node tests, then pytest including Python to TypeScript to Python round trips.

## Audit chain
`audit_record.hash` = SHA-256 hex of the canonical JSON (sorted keys, no spaces, UTF-8, integral numbers as integers) of the record without `hash`; `prev_hash` is the previous record's hash; the first record is genesis. `verifyChain` returns `{valid, final_hash, first_broken_sequence, reason}`. Shared vectors: `audit-valid.json`, `audit-tampered.json`. `action` is a closed list in `docs/architecture/04-agents.md` §4: add a new action there first.

## Before you finish
`make lint typecheck test build`, and update `docs/contracts.md` plus `docs/architecture/07-data-and-storage.md` in the same PR.
