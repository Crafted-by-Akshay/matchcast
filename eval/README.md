# eval/

`compare.py` is the QUA-4 harness: a single agent against the four-agent workflow on the
same frozen moments (every shot and goal in `packages/agents/tests/fixtures/match-short.json`).

- **Judge:** recomputes score, shots and minute from the event log and flags any number the log
  does not support and any capitalised name outside the squad and club lists. It does not use
  the Verifier, so the four-agent arm is not marked by its own checker.
- **Metrics:** coverage, clean rate, wrong-line rate, bad numbers and names per 100 shown
  lines, p50/p95 latency; 3 runs, mean and range.
- **Offline now:** the single arm is `FakeModel`, a seeded stand-in, so results prove the
  harness, not model quality (`results/offline.json`).
- `ask_golden.jsonl` (Agents lane) is a separate gate for Ask the match.

Run: `uv run --all-packages python eval/compare.py --runs 3 --out eval/results/offline.json`

## Frozen set of 30 moments (`frozen.py`, `frozen-moments.json`)

The short fixture has one match, so the harness also runs on 30 moments (10 goals, 20 shots) drawn with a
fixed seed from the 28 season matches, at most 3 per match (19 matches here). Each moment stores its true
score, shots and shots on target. `uv run --all-packages python eval/frozen.py` checks the file against the
season and the event converter; `--write` re-draws it; a test fails when the file and the draw differ, so a change to the season or converter cannot slip by unnoticed (the diff of `frozen-moments.json` is what gets reviewed). The season files are read by code only, as `scripts/replay_match.py` does.
Run both arms on it offline: `python eval/compare.py --frozen --runs 3 --out eval/results/frozen-offline.json`
(about 6 minutes: the workflow plays 19 matches per run). The four-agent arm airs only the moments the
Producer picks (coverage 0.47 of the 30), none of them wrong; the offline single-agent stand-in covers all 30
and slips 13% of lines at a 15% slip rate. Those numbers show the harness, not a model. The judge accepts any number true for the moment (minute, either score, either shot count), so it can miss a reversed score; it is independent of the Verifier but lenient, so "none wrong" means none the judge could catch.

## Per-agent eval (`agents_eval.py`)

One golden-set report per agent (Producer, Analyst, Narrator, Verifier) plus Ask: claim accuracy
against a separate recount, Verifier catch rate on mutated lines and on a seeded bad claim at seven
match times, false rejects, refusal and red-team rates. Offline it grades the rules agents and
writes `results/agents.json` and `docs/eval/agents-eval.md`; `--live` grades the Foundry agents
once quota exists. `tests/test_eval_agents.py` holds the floors and fails if the committed
report is stale. Known gaps are in the report, for example numbers written in the wrong order are not caught.

## Live run (against the deployed gpt-5-mini)

`make live-eval` on the Mac mini (`az login`, `FOUNDRY_PROJECT_ENDPOINT`, optionally
`FOUNDRY_MODEL_DEPLOYMENT`, default `gpt-5-mini`) does three things in order:

1. `smoke-foundry`: one 16-token call; prints the model, token counts and latency. Stop here if it fails.
2. `compare.py --live` (`--runs N`, default 1): three arms on the same frozen shots and goals,
   `four_agent_rules`, `four_agent_live` (Analyst, Narrator and Verifier on the model; a line the
   Verifier rejects falls back to the rules twin, so coverage shows the whole system) and
   `single_agent_live` (one model, no checker). Writes `eval/results/live.json` with per-arm `usage`
   (calls, prompt and completion tokens), `four_agent_live_fallbacks` and `single_agent_errors`, and a
   `warning` (also printed to stderr) when most live lines fell back or failed. Token counts exclude
   the SDK's one retry and timed-out requests, so treat them as a floor.
3. `agents_eval.py --live`: the per-agent golden sets on Foundry; writes `docs/eval/agents-eval-live.md`
   (it plays the match nine times, so it costs the most; run it last).

What to expect: `four_agent_rules` and `four_agent_live` keep `wrong_line_rate` near 0 because the
Verifier gates both; `single_agent_live` is where wrong numbers and names show up; the live
four-agent arm has higher latency (p50 in seconds, not milliseconds). If `four_agent_live_fallbacks`
is close to `four_agent_live_lines`, the model calls are failing and falling back: read the smoke
output first (it now exercises the same strict-schema path the agents use). Copy the real numbers into the elevator pitch only
after reading `live.json`; the offline numbers must not be quoted as model quality.

Turning the api itself live is a separate switch: `MATCHCAST_AGENT_MODE=live` (Bicep currently
fixes it to `rules`; Platform to expose it as a parameter), after `smoke-foundry` passes.
