# 18 Glossary

| Term | Meaning |
| --- | --- |
| Abstain | The workflow drops a line after a second Verifier rejection, and records `claim_abstained` |
| Agent | A model-backed step with one job and its own tools: Producer, Analyst, Narrator, Verifier (core); Data Scientist, player persona (on demand) |
| Approval mode | Per match: `auto` (verified lines publish) or `producer` (a person approves) |
| Audit record | One hash-chained entry for every agent or person action |
| Claim | One measured fact with its sources, tool calls, formula inputs and value |
| Condensed broadcast | The full 90 minutes are simulated; key passages play live and quiet spells fast-forward |
| Contract | A JSON Schema packet in `packages/contracts` (event, tracking frame, state revision, claim, publication, audit) |
| `derivation_version` | `<agent or metric>@<semver>`, plus `+rules` when the rules fallback produced it |
| Event | One contract packet for something on the pitch (pass, shot, tackle and others) |
| Fallback (rules) | Deterministic implementation used when the model fails; labelled "Rules fallback" |
| KB | Knowledge base: our own markdown in `kb/`, indexed in AI Search |
| Lane | One of five Claude Code build streams: Platform, Agents, Experience, Data, Quality |
| Line | The Narrator's text for one persona, built from claims; it gets a verdict and may be approved |
| Moment | A passage of play the Producer chose to explain, with a priority 1 to 3 |
| Persona | Who a line is for: casual, analyst, broadcast, my-club:<team>, player-focus:<player>, one-metric:<metric> |
| Publication | An approved, verified line with its language variants and audio |
| RAG | Retrieval-augmented generation: answering with chunks retrieved from the KB, cited |
| Seed | The number that fixes every random choice in a match |
| Stream key (`sk`) | `tenant_id|session_id|match_id`, the partition key for all match data |
| Verdict | The Verifier's result for a line: `verified`, `review` or `rejected`, with a reason code |
| xG | Expected goals: the probability a shot is scored, from angle and distance |
