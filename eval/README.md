# eval/

`compare.py` is the QUA-4 harness: a single agent against the four-agent workflow on the
same frozen moments (every shot and goal in `packages/agents/tests/fixtures/match-short.json`).

- **Judge:** recomputes score, shots and minute from the event log and flags any number the log
  does not support and any capitalised name outside the squad and club lists. It does not use
  the Verifier, so the four-agent arm is not marked by its own checker.
- **Metrics:** coverage, clean rate, wrong-line rate, bad numbers and names per 100 shown
  lines, p50/p95 latency; 3 runs, mean and range.
- **Offline now:** the single arm is `FakeModel`, a seeded stand-in, so results prove the
  harness, not model quality (`results/offline.json`). Live: pass a Foundry `ModelClient` to
  `compare(client_factory=...)` once gpt-6-luna quota arrives. Tokens and cost are added then.
- `ask_golden.jsonl` (Agents lane) is a separate gate for Ask the match.

Run: `uv run --all-packages python eval/compare.py --runs 3 --out eval/results/offline.json`

## Per-agent eval (`agents_eval.py`)

One golden-set report per agent (Producer, Analyst, Narrator, Verifier) plus Ask: claim accuracy
against a separate recount, Verifier catch rate on mutated lines and on a seeded bad claim at seven
match times, false rejects, refusal and red-team rates. Offline it grades the rules agents and
writes `results/agents.json` and `docs/eval/agents-eval.md`; `--live` grades the Foundry agents
once quota exists. `tests/test_eval_agents.py` holds the floors and fails if the committed
report is stale. Known gaps are in the report, for example a wrong teammate is not caught.
