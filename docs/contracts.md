# MatchCast wire contracts v1.1.0

These contracts implement the v1.1 **requirements** from MHACK832-23 and the
readiness contract on MHACK832-1. The **wire schema** is `1.1.0` (initial release `1.0.0`); the two
version numbers describe different things. This is a local contract definition,
not evidence of a running football engine, verified broadcast, or cloud service.

## Canonical source and use

`packages/contracts/matchcast_contracts/schemas/v1.json` is the single canonical
JSON Schema (Draft 7). All wire objects are closed (`additionalProperties: false`).
TypeScript types in `packages/contracts/src/generated.ts` are generated from it;
never edit that file directly. Python loads the same packaged schema with
`importlib.resources` and `jsonschema`; no parallel Python model definition exists.
Ajv validates the schema in TypeScript. Both validators then apply the contextual
rules below, with parity tests against the same JSON corpus. Neither validator
coerces values, inserts defaults, strips fields, or mutates the input.

From the repository root:

```sh
make install
make contracts-generate  # after intentionally editing the JSON Schema
make contracts-check    # fail if checked-in TypeScript differs from regeneration
make lint typecheck test build
```

`make lint` includes generation drift detection. `make typecheck` checks generated
types, validator code, frontend type examples, and the existing Next.js app.
`make test` builds the contracts package, runs Node's test runner, then runs pytest
including real Python → TypeScript → Python and TypeScript → Python → TypeScript
JSON transport checks. Direct pytest runs of the cross-language tests need the
contracts JavaScript build first. `make build` builds contracts and the web app.

After building, frontend code can use the browser-compatible exports:

```ts
import { validateContract, type MatchCastContract } from "@matchcast/contracts";
const packet: MatchCastContract = validateContract(incomingJson, authoritativeRoster);
```

Backend code can use the installed uv workspace package:

```python
from matchcast_contracts import validate

packet = validate(incoming_json, roster=authoritative_roster)
```

Treat input as unknown until validated. Generated TypeScript interfaces alone
cannot check numeric bounds, date validity, or references at runtime. Validation
errors carry `code`, `path` (a JSON pointer), and a descriptive message; core codes
are shared across languages, while schema-library wording is not promised identical.

## Packet families

Every top-level packet has `kind`, `schema_version`, and `stream`.

| Kind | Principal contents |
| --- | --- |
| `roster` | Explicit player/team membership, ball ID, and pitch dimensions for validation context |
| `event` | Event identity, order, revision, clocks, and a discriminated semantic/control payload |
| `tracking_frame` | Same identity/order/clock header plus player and ball positions |
| `state_revision` | `snapshot` reference to a committed state revision and evidence boundary |
| `claim` | Source references/interval, numeric metric and units, derivation version, snapshot, evidence limit, approval status |
| `audit_record` | One agent, person or system decision: `audit_id`, per-stream `sequence`, `time`, `actor_kind`/`actor_id`, `action` (closed list in `docs/architecture/04-agents.md` §4), `subject_id`, `details`, `prev_hash`, `hash` |
| `publication` | Stable publication ID, claim IDs, state reference, persona/language, match time, wall-clock expiry, audio generation ID, text |

### Event payload types

All positions are metres on the ground (z=0) inside the roster pitch. Types marked
1.1 need `schema_version: "1.1.0"`; a `1.0.0` packet carrying them is rejected with
`unsupported_schema_version` at `/payload/type`. `player_id` is the acting player and
`team_id` the actor's team unless stated.

| `type` | Since | Fields |
| --- | --- | --- |
| `goal`, `pass`, `shot`, `period_boundary` | 1.0 | as in the schema |
| `tackle` | 1.1 | `player_id`, `team_id`, `target_player_id` (opposing team), `outcome` (`won`/`lost`), `position` |
| `foul` | 1.1 | `player_id`, `team_id`, `victim_player_id` (opposing team), `advantage` (bool), `position` |
| `card` | 1.1 | `player_id`, `team_id`, `colour` (`yellow`/`second_yellow`/`red`), `reason` (1-256 chars) |
| `carry` | 1.1 | `player_id`, `team_id`, `start_position`, `end_position`, `duration_ms` (integer, at least 1) |
| `possession_change` | 1.1 | `from_team_id`, `to_team_id` (different, both in roster), `cause` (`tackle`/`interception`/`loose_ball`/`out_of_play`/`foul`) |
| `pressure` | 1.1 | `player_id` (presser), `team_id`, `target_player_id` (opposing team), `position`, `distance_m` (at least 0), `closing_speed_mps` (at least 0) |

Both versions are accepted by the validators, so old packets stay valid. `schema_version`
in the contract above is a set (`SUPPORTED_VERSIONS`), and `SCHEMA_VERSION` is the newest.

`fixtures/manifest.json` indexes shared positive/negative fixtures. `contexts.json`
contains publication and correction reference-validation cases. These are small
synthetic format examples, including Tamil text and caption-only output; they are
not release scenes, measured tactical values, or provider results. Individual
examples represent different points/branches of history, not one replay dataset.

## Identity, order, and revisions

`stream` is the tuple `(tenant_id, session_id, match_id)`. Each identifier is an
opaque, case-sensitive ASCII identifier, 1–128 characters. Identifiers, derivation
versions, and timestamps must match their
entire string. The canonical patterns use `(?![\s\S])` for an absolute end-of-input
assertion shared by Python and JavaScript, avoiding `$`'s trailing-newline behavior.
Malformed line breaks are rejected with `ContractError`, never trimmed or normalized.
Do not reinterpret a stream identifier
as an authenticated principal. Context from another tuple is rejected. Future
partition keys must encode the tuple without delimiter collisions; do not merge
streams merely because their match IDs match. Authentication/isolation enforcement
is a later consumer responsibility.

Event and tracking headers use:

* `event_id`: immutable logical identity within the stream; never assign it to a
  different occurrence. Tracking frames use this field too; there is no competing
  frame identity.
* `stream_sequence`: origin position, starting at 1, shared by semantic events,
  tracking frames, corrections, and retractions in that stream. Assign monotonically
  and do not reuse a position for another original message.
* `revision`: logical event revision, starting at 0. A materialized corrected event
  retains the original `event_id` and origin sequence and has a higher revision.
* `event_time_ms`, `emitted_at`, and `clock`: separate semantic and wall clocks,
  defined below.

Retries of the same logical message/revision preserve ID, sequence, and contents.
Consumers deduplicate before applying side effects. A changed payload is not a
retry. Producers publish a new correction/retraction control message to revise
an existing fact, rather than silently overwriting its original envelope.
Materialized/replay views may expose the updated event shape (see
`corrected-goal.json`). Store original envelopes and revision history for audit.

Sequence is the processing order; `emitted_at` is not an ordering key. Late data
and correction messages may have event times older than the current high-watermark.
Historical uniqueness, missing sequences, replay deduplication, conditional writes,
lease ownership, and transaction/checkpoint/outbox boundaries require future
consumers and durable storage; a single-packet validator does not implement them.
The readiness contract's 2-second buffer / 5-second unresolved-gap policy is not
a schema rejection window: corrections must remain representable afterwards.

All integer counters/times lie within JavaScript's exact integer range
`0..9007199254740991`; stream/source sequences start at 1. All numbers must be
finite. Non-finite Python/JavaScript values are rejected before wire transport.

## Units, geometry, roster context, and match clock

Pitch length/width and positions are in **metres**. The origin `(0,0)` is one pitch
corner, x follows length, y follows width, and z is height above the ground. Axes
stay fixed across periods; teams changing ends does not flip coordinates. Pitch
dimensions are positive finite numbers. This schema does not assert regulatory
pitch dimensions or football realism.

Players and semantic-event positions have z=0. Ball height may be any finite
nonnegative value. x and y must be nonnegative and lie **inclusively** within the
supplied roster's `length_m` / `width_m`. A frame declares its pitch and literal
`position_unit: "m"`, `clock_unit: "ms"`; its dimensions must match that roster.
Event coordinate payloads also declare `position_unit: "m"`. Other units are
rejected, never converted silently.

Roster validation is explicit: `validate(..., roster=...)` / `validateContract(...,
roster)` requires it for tracking and player-bearing events, including correction
replacements. A bare player ID schema only establishes string shape. The contextual
validator checks roster validity and stream equality, then player/team/ball
membership, duplicate tracked IDs, and coordinate upper bounds. Omitting required
context returns `roster_required`, not a false successful reference check.

The roster lists two teams and unique trackable players, with a distinct ball ID.
The caller supplies the authoritative roster for the relevant match time; roster
history and substitutions are not resolved here. `complete: true` frames contain
every player in that context exactly once; sparse frames use `complete: false`
and must not imply that an omitted player ceased to exist. The small fixture
roster is not a claim of a full 22-player simulation. Pass actors/recipients belong
to `team_id`; a goal's `team_id` is the credited team and `own_goal` explicitly
controls whether the scorer belongs to the other team.

`event_time_ms` is total **active match milliseconds** from the first kickoff,
including added time and excluding breaks. `clock.period` is 1/2 (regulation),
3/4 (extra time); shootout semantics are outside v1. `period_elapsed_ms` resets
at each period start. For period 1 it equals total active time; later periods'
elapsed time cannot exceed that total. Their start offsets depend on actual
completed period lengths, including added time, not fixed 45-minute arithmetic;
timeline-context enforcement belongs to the future match engine/state processor.

`emitted_at`, `published_at`, and `expires_at` are wall-clock UTC RFC 3339 timestamps:
years 1000–9999, literal `Z`, zero to three fractional digits, valid calendar/time,
and no leap seconds. They are never match-clock values. No client/server clock
synchronization or live latency claim is made here.

## Corrections, retractions, and state references

An event payload is a typed `goal`, `pass`, `shot`, `period_boundary`, `correction`,
or `retraction`. This initial semantic vocabulary is deliberately closed. Adding
other football events requires a versioned schema and fixtures, not a generic
unvalidated payload bag.

Corrections/retractions have their own new event ID and sequence and header
revision 0. Their payload identifies `target_event_id`, `target_stream_sequence`,
`target_revision`, and `new_revision = target_revision + 1`. The target must be an
earlier sequence in the same stream and cannot be the control message itself.
Corrections contain a complete replacement semantic payload; retractions retain
a tombstone and reason, not a negative scoring event or deletion of audit history.
In v1 they target semantic events, not other controls or tracking frames.

`validate_revision_change(message, target, roster=...)` /
`validateRevisionChange(message, target, roster)` checks that the supplied current
target has the stated ID, origin sequence, revision, and stream. Storage must
choose the authoritative target and apply updates atomically. These functions
do not replay a reducer, prove that a target was persisted, or perform idempotent
publication. A duplicate control is deduplicated before revision application;
a stale target version must not be applied again.

`StateRevisionReference` contains `state_revision`, `max_evidence_sequence`, and
`event_time_ms`; its stream is inherited from its enclosing packet. The reference
identifies one committed snapshot. `state_revision` is a state counter, not an
event revision or sequence. The evidence sequence is the committed input
high-watermark; snapshot event time is the active-time horizon. `state_revision`
packets carry this object as `snapshot`. Initial empty state may use zero counters.

## Claims and publication

A claim records a finite numeric `value`, named `metric`, explicit `units`, and
`derivation_version` (semantic version of its deterministic computation/review
procedure). Units are `count`, `m`, `ms`, `s`, `m/s`, or dimensionless `ratio`.
Counts must be exact integers in `0..9007199254740991`, including the upper bound;
larger values are rejected before transport can accept a rounded number. The shared
fixtures include zero, the maximum, maximum + 1, and maximum + 2. Ratio does not mean probability and may
exceed one. Metric-specific meaning and recomputation remain future work.

Sources are either nonempty event references (ID, origin sequence, revision) or
an inclusive active-time and sequence interval with ordered lower/upper bounds.
IDs in an event-source list must be unique. A claim's `max_evidence_sequence`
cannot exceed its committed `snapshot.max_evidence_sequence`; every event or
interval upper sequence must be within the claim limit. Interval end time must
not exceed the snapshot horizon. Source events, revisions, and intervals inherit
the enclosing stream. Actual source existence, interval coverage, deterministic
recomputation, semantic review, and approval provenance require trusted consumer
context; a self-declared packet cannot establish factual truth.

`approval_status` is `pending`, `approved`, `rejected`, or `retracted`. A publication
has nonempty unique `claim_ids`, a stable `publication_id`, `state` reference,
persona ID, `language` (`en`/`ta`), semantic `event_time_ms`, text, `published_at`,
`expires_at`, and required `audio_generation_id`. That field is null for explicit
caption-only output; a non-null ID identifies one audio generation. It does not
prove audio exists, was synthesized successfully, or was heard. Retrying a
publication preserves its logical publication ID; regenerating audio needs a new
generation ID. Keep publication records for audit/replay and acknowledgements.

Publication event time cannot exceed its state horizon; wall-clock expiry must
follow publication time. The examples use a five-second lifetime, matching the
readiness target; queueing, delivery-time expiry checks, cancellation, and replay
cursor persistence are consumer obligations. Text is untrusted data, not HTML.

`validate_publication_context(publication, claims, current_state)` /
`validatePublicationContext(publication, claims, currentState)` additionally requires
all referenced claims to exist, be approved, share the stream, and reference the
supplied current snapshot. The publication state must match that snapshot exactly.
Duplicate supplied claim IDs and stale revisions fail. The caller must select
trusted current state/approval records. This is reference validation, not a
publication service or authorization check. Semantic fast-path and model-draft
review remain mandatory before actual publication/synthesis under v1.1.

## Audit records and the hash chain

Audit records are append-only. `hash` is the SHA-256 (lowercase hex) of the canonical
JSON of the record without `hash`: keys sorted, no spaces, UTF-8, integral numbers
written as integers. `prev_hash` is the previous record's `hash`; the first record
(`sequence` 1) uses 64 zeros. `details` is a JSON object of at most 2,048 canonical
bytes (`details_too_large`); numbers that Python and JavaScript could print differently
(non-finite, exponent form, integers beyond 2^53-1) are rejected.

`append_audit(previous, ...)` / `appendAudit(previous, input)` return the next record
and store nothing; callers must serialise appends per stream. `verify_chain(records)` /
`verifyChain(records)` return `{valid, final_hash, first_broken_sequence, reason}`, where
`reason` is one of `invalid_schema`, `stream_mismatch`, `sequence_gap`,
`prev_hash_mismatch` or `hash_mismatch`. Shared vectors: `fixtures/audit-valid.json` and
`fixtures/audit-tampered.json`; both languages must produce the same final hash.
Python: `matchcast_contracts.audit`; TypeScript: `src/audit.ts` (synchronous SHA-256, so it
also runs in the browser).

## Versioning and compatibility

Wire `schema_version` values `"1.0.0"` and `"1.1.0"` are currently supported. Unknown or future
versions return `unsupported_schema_version` before payload interpretation; an
unknown kind/type or extra property fails schema validation. Do not guess or
silently downgrade. IDs, units, time semantics, sequence/revision meanings, and
nullable audio behavior are part of the compatibility contract.

Freeze existing version definitions once adopted. A wire-shape/semantic change
requires a new version, schema, generated types, fixtures, and compatibility
review. Breaking meaning/removal/type changes require a major version; optional
additions or new variants still need an explicit new version and registry entry.
Because readers are strict, even an optional added field is not forward-compatible
with the current reader. No automatic multi-version migration is implemented.
During a rollout/rollback, consumers must explicitly support the versions still
emitted by deployed producers; preserve old fixtures and test both readers before
switching producers. Never edit a v1 schema in place to claim compatibility.

S02 introduces the first wire version, so there is no prior wire-format migration
to test. Current compatibility checks cover shared positive/negative fixtures,
lossless semantic JSON round-trips, compile-time discriminants, and deterministic
generation drift. Exact JSON whitespace/key order/number spelling is not an
identity or signing format. These contracts define future interfaces; they do not
certify the DATA, FACT, CORR, SEC, DEPLOY, or other integrated release gates.
