# matchcast-agents

The match workflow: four agents with one job each, handing typed packets to each other and
leaving a hash-chained audit record at every step. Design: `docs/architecture/04-agents.md`.

## Workflow graph

```mermaid
flowchart LR
  ev([event]) --> P[Producer]
  P -- Skip --> X([end])
  P -- ProducerTask --> AN[Analyst]
  AN -- claims --> N[Narrator]
  N -- lines --> V[Verifier]
  V -- verified --> G{approval mode}
  V -- rejected, first time --> RP[Repair]
  RP -- number or source --> AN
  RP -- wording --> N
  V -- rejected, second time --> AB([abstain])
  G -- auto --> PUB[Publisher]
  G -- producer --> Q[(queue)]
  Q -- approve --> PUB
```

| Agent | Job | Rules implementation (this package) |
| --- | --- | --- |
| Producer | Picks moments, sets priority, skips quiet play | Score table, threshold 60, priority 1 for goals and red cards, one task per 8 s of match time |
| Analyst | Turns a moment into 1 to 3 claims with evidence | Counts from the rolling match state; claims are contract `claim` packets |
| Narrator | One line per persona from claim values and roster names | Templates for `casual`, `analyst`, `broadcast` |
| Verifier | Checks sources, freshness, numbers, names, persona limits | Checks 1 to 5 from `04-agents.md` §5, recounted from the stored events |

## Modes

`MatchWorkflow` takes an `AgentSet`. `rules_agents()` is the deterministic set and the fallback
for every agent (ADR-0014). Live agents on Foundry (AGT-4 onwards) implement the same four async
methods and drop in without changing `workflow.py`. Nothing here calls a model.
`rules_agents(seed_bad_claim=True)` corrupts the first claim once so the Verifier rejection and
the repair path can be shown on cue.

## Try it

```sh
uv run python packages/agents/tests/make_match_short.py   # regenerate the 10-minute fixture
uv run pytest packages/agents/tests
```

Known limits in this version: corrections and retractions are stored but not replayed into
state; only the in-memory store exists (`TableStore` is later work); checks 6 to 8 are AGT-7 and AGT-12.
