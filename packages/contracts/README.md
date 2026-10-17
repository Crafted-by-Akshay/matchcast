# @matchcast/contracts / matchcast-contracts

The npm and uv workspace packages share the single canonical wire schema at
`matchcast_contracts/schemas/v1.json`. The TypeScript declarations in
`src/generated.ts` are derived from it; the Python validator loads that same JSON.

See [`docs/contracts.md`](../../docs/contracts.md) for field semantics, context
requirements, correction/versioning rules, and usage. Shared examples and invalid
cases are in `fixtures/`; they contain synthetic contract data, not measured results.

From the repository root:

```sh
make install
make contracts-generate  # only after intentionally changing the schema
make contracts-check
make lint typecheck test build
```

`make test` builds the JavaScript validator before testing both languages and their
JSON transport. Schema-valid player IDs require an explicit authoritative roster
to pass reference validation. Claim approval and trusted current-state provenance
cannot be established by schema shape alone.
