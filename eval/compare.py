"""QUA-4: one agent against four agents on the same frozen moments.

Both arms write a line for each shot or goal in a match. An independent judge scores every
line against ground truth recomputed from the event log (not from the Verifier), so the
four-agent arm is not graded by its own checker.

    uv run --all-packages python eval/compare.py            # offline: rules arm vs fake model
    uv run --all-packages python eval/compare.py --runs 3 --out eval/results/offline.json
    uv run --all-packages python eval/compare.py --live        # Foundry, once the quota exists

The single-agent arm takes any `ModelClient` (prompt -> text). Offline it is `FakeModel`, a
seeded stand-in with a configurable slip rate. Live runs pass a Foundry client once the
gpt-6-luna quota exists; nothing here calls Azure.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import re
import statistics
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "packages" / "agents" / "tests" / "fixtures" / "match-short.json"
MOMENT_TYPES = ("shot", "goal")
OK_STATUSES = ("verified", "approved", "published")

ModelClient = Callable[[str], str]


def load_match(path: Path = FIXTURE) -> dict[str, Any]:
    return json.loads(path.read_text())


def moments(match: dict[str, Any]) -> list[dict[str, Any]]:
    """Frozen moment list: the event ids that carry a shot or goal, with true state at each."""
    teams = list(match["teams"])
    score = dict.fromkeys(teams, 0)
    shots = dict.fromkeys(teams, 0)
    on_target = dict.fromkeys(teams, 0)
    out = []
    for ev in match["events"]:
        p = ev["payload"]
        if p["type"] not in MOMENT_TYPES:
            continue
        team = p["team_id"]
        if p["type"] == "goal":
            score[team] += 1
        else:
            shots[team] += 1
            on_target[team] += bool(p.get("on_target"))
        out.append(
            {
                "event_id": ev["event_id"],
                "type": p["type"],
                "player_id": p["player_id"],
                "team_id": team,
                "minute": ev["event_time_ms"] // 60000,
                "score": dict(score),
                "shots": dict(shots),
                "on_target": dict(on_target),
            }
        )
    return out


def true_numbers(m: dict[str, Any]) -> set[str]:
    nums = {m["minute"], *m["score"].values(), *m["shots"].values(), *m["on_target"].values()}
    nums.add(m["score"][m["team_id"]])
    return {str(n) for n in nums}


NUM = re.compile(r"\b\d+(?:\.\d+)?\b")
NAME = re.compile(r"\b[A-Z][a-z]+(?: [A-Z][a-z]+)+\b")


def judge(text: str, m: dict[str, Any], match: dict[str, Any]) -> dict[str, int]:
    """Count numbers not supported by the log and capitalised names that are not in the squad."""
    allowed_names = set(match["names"].values()) | set(match["teams"].values())
    bad_numbers = [n for n in NUM.findall(text) if n not in true_numbers(m)]
    names = set()
    for found in NAME.findall(text):
        names.add(found)
    bad_names = [n for n in names if not any(n in a or a in n for a in allowed_names)]
    return {"bad_numbers": len(bad_numbers), "bad_names": len(bad_names)}


class FakeModel:
    """A seeded stand-in for a single model. Slips at `slip` rate: wrong count or wrong name."""

    def __init__(self, seed: int = 0, slip: float = 0.15):
        self.rng = random.Random(seed)
        self.slip = slip

    def __call__(self, prompt: str) -> str:
        facts = json.loads(prompt.split("FACTS:", 1)[1])
        score, who, club = facts["score"], facts["player"], facts["club"]
        a, b = list(score.values())
        if facts["type"] == "goal":
            if self.rng.random() < self.slip:
                a += self.rng.choice((1, 2))
            return f"Goal! {who} ({club}) scores. It is {a}-{b}."
        shots = facts["shots"][facts["team_id"]]
        if self.rng.random() < self.slip:
            who = "Dario Vance"
        elif self.rng.random() < self.slip:
            shots += self.rng.choice((1, 2))
        return f"{who} ({club}) shoots. That is shot number {shots} for them."


def single_prompt(m: dict[str, Any], match: dict[str, Any]) -> str:
    facts = {
        "type": m["type"],
        "team_id": m["team_id"],
        "player": match["names"][m["player_id"]],
        "club": match["teams"][m["team_id"]],
        "score": {match["teams"][t]: n for t, n in m["score"].items()},
        "shots": m["shots"],
    }
    return "Write one commentary line for this moment. FACTS:" + json.dumps(facts)


def run_single(match: dict[str, Any], client: ModelClient) -> list[dict[str, Any]]:
    rows = []
    for m in moments(match):
        t0 = time.perf_counter()
        text = client(single_prompt(m, match))
        ms = (time.perf_counter() - t0) * 1000
        rows.append(
            {"moment": m["event_id"], "text": text, "latency_ms": ms, **judge(text, m, match)}
        )
    return rows


def run_four(
    match: dict[str, Any],
    agents_factory: Callable[..., Any] = rules_agents,
    stats: dict[str, int] | None = None,
) -> list[dict[str, Any]]:
    config = WorkflowConfig(approval_mode="auto")
    flow = MatchWorkflow(
        stream=match["roster"]["stream"],
        roster=match["roster"],
        names=match["names"],
        clubs=match["teams"],
        agents=agents_factory(config.personas),
        config=config,
    )
    by_id = {m["event_id"]: m for m in moments(match)}
    t0 = time.perf_counter()
    asyncio.run(flow.ingest(match["events"]))
    total_ms = (time.perf_counter() - t0) * 1000
    lines = flow.store.lines(flow.sk)
    if stats is not None:
        audit = flow.store.audit_records(flow.sk)
        stats["fallbacks"] = stats.get("fallbacks", 0) + sum(
            r["action"] == "fallback_used" for r in audit
        )
        stats["lines"] = stats.get("lines", 0) + len(lines)
    per_line = total_ms / max(len(lines), 1)
    rows = []
    for line in lines:
        m = by_id.get(line.moment_id.removeprefix("m-"))
        if m is None or line.persona != "casual":
            continue
        shown = line.status in OK_STATUSES
        rows.append(
            {
                "moment": m["event_id"],
                "text": line.text,
                "shown": shown,
                "latency_ms": per_line,
                **(judge(line.text, m, match) if shown else {"bad_numbers": 0, "bad_names": 0}),
            }
        )
    return rows


def summarise(rows: list[dict[str, Any]], n_moments: int) -> dict[str, float]:
    shown = [r for r in rows if r.get("shown", True)]
    clean = [r for r in shown if r["bad_numbers"] == 0 and r["bad_names"] == 0]
    lat = sorted(r["latency_ms"] for r in rows) or [0.0]
    return {
        "moments": n_moments,
        "lines_shown": len(shown),
        "coverage": round(len(shown) / max(n_moments, 1), 3),
        "clean_rate": round(len(clean) / max(n_moments, 1), 3),
        "wrong_line_rate": round(1 - len(clean) / max(len(shown), 1), 3),
        "bad_numbers_per_100_lines": round(
            100 * sum(r["bad_numbers"] for r in shown) / max(len(shown), 1), 1
        ),
        "bad_names_per_100_lines": round(
            100 * sum(r["bad_names"] for r in shown) / max(len(shown), 1), 1
        ),
        "latency_p50_ms": round(statistics.median(lat), 2),
        "latency_p95_ms": round(lat[min(len(lat) - 1, int(0.95 * len(lat)))], 2),
    }


def compare(
    runs: int = 3, slip: float = 0.15, client_factory: Callable[[int], ModelClient] | None = None
) -> dict[str, Any]:
    match = load_match()
    n = len(moments(match))
    factory = client_factory or (lambda seed: FakeModel(seed, slip))
    four = [summarise(run_four(match), n) for _ in range(runs)]
    single = [summarise(run_single(match, factory(i)), n) for i in range(runs)]

    def agg(rs: list[dict[str, float]]) -> dict[str, dict[str, float]]:
        return {
            k: {
                "mean": round(statistics.mean(r[k] for r in rs), 3),
                "min": min(r[k] for r in rs),
                "max": max(r[k] for r in rs),
            }
            for k in rs[0]
        }

    return {
        "arms": {"four_agent_rules": agg(four), "single_agent": agg(single)},
        "runs": runs,
        "single_model": "FakeModel (offline stand-in)" if client_factory is None else "live",
        "note": "Offline numbers show the harness works, not model quality. "
        "Live run needs gpt-6-luna quota.",
    }


class LiveSingle:
    """The single-agent arm on the Foundry deployment: one prompt in, one line out.

    All calls share one event loop (an async HTTP client cannot move between loops)."""

    def __init__(self, client: Any) -> None:
        self.client = client
        self._runner = asyncio.Runner()
        self.errors = 0

    def __call__(self, prompt: str) -> str:
        """The line, or an empty string when the call fails (counted in ``errors``)."""
        schema = {
            "type": "object",
            "properties": {"line": {"type": "string"}},
            "required": ["line"],
            "additionalProperties": False,
        }
        system = "You write one short football commentary line. Use only the facts you are given."
        try:
            answer = self._runner.run(self.client.complete(system, prompt, schema, max_tokens=300))
        except Exception:  # noqa: BLE001 - a throttled or filtered call must not end the run
            self.errors += 1
            return ""
        return str(answer.get("line", ""))

    def close(self) -> None:
        self._runner.close()


def compare_live(runs: int = 1) -> dict[str, Any]:
    """Rules four-agent, live four-agent and a live single agent on the same frozen moments.

    Needs FOUNDRY_PROJECT_ENDPOINT (and FOUNDRY_MODEL_DEPLOYMENT, default gpt-6-luna) and an
    `az login`. Each run plays the match once per live arm, so check the cost caps first."""
    from matchcast_agents.live import live_agents
    from matchcast_agents.live.client import FoundryModelClient

    match = load_match()
    n = len(moments(match))
    rules = [summarise(run_four(match), n) for _ in range(runs)]
    live_four, single = [], []
    four_usage = {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0}
    single_usage = dict(four_usage)
    stats: dict[str, int] = {}
    errors = 0

    def add(into: dict[str, int], client: Any) -> None:
        for k in into:
            into[k] += getattr(client.usage, k)

    for _ in range(runs):
        client = FoundryModelClient()  # re-binds itself to each event loop it runs on
        live_four.append(
            summarise(
                run_four(match, lambda personas, **kw: live_agents(client, personas, **kw), stats),
                n,
            )
        )
        add(four_usage, client)
        client = FoundryModelClient()
        one = LiveSingle(client)
        try:
            single.append(summarise(run_single(match, one), n))
        finally:
            errors += one.errors
            one.close()
        add(single_usage, client)

    def agg(rs: list[dict[str, float]]) -> dict[str, dict[str, float]]:
        return {
            k: {
                "mean": round(statistics.mean(r[k] for r in rs), 3),
                "min": min(r[k] for r in rs),
                "max": max(r[k] for r in rs),
            }
            for k in rs[0]
        }

    return {
        "arms": {
            "four_agent_rules": agg(rules),
            "four_agent_live": agg(live_four),
            "single_agent_live": agg(single),
        },
        "runs": runs,
        "single_model": os.environ.get("FOUNDRY_MODEL_DEPLOYMENT", "gpt-6-luna"),
        "usage": {"four_agent_live": four_usage, "single_agent_live": single_usage},
        "four_agent_live_fallbacks": stats.get("fallbacks", 0),
        "four_agent_live_lines": stats.get("lines", 0),
        "single_agent_errors": errors,
        "warning": warning(stats, errors, n * runs),
        "note": "Live four-agent lines that fail the Verifier fall back to the rules twin, so "
        "coverage and clean rate show the whole system; wrong_line_rate is the judge's count. "
        "Read four_agent_live_fallbacks first: a high count means the model calls failed.",
    }


def warning(stats: dict[str, int], errors: int, single_calls: int) -> str | None:
    """Say so when the live arms mostly fell back or failed: their numbers are then the rules'."""
    lines, fallbacks = stats.get("lines", 0), stats.get("fallbacks", 0)
    problems = []
    if fallbacks * 2 >= max(lines, 1):
        problems.append(f"{fallbacks} fallbacks for {lines} live four-agent lines")
    if errors * 2 >= max(single_calls, 1):
        problems.append(f"{errors} of {single_calls} single-agent calls failed")
    return "; ".join(problems) or None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=None)
    ap.add_argument("--slip", type=float, default=0.15)
    ap.add_argument("--live", action="store_true", help="run on Foundry (needs quota and az login)")
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()
    if args.live:
        if not os.environ.get("FOUNDRY_PROJECT_ENDPOINT"):
            raise SystemExit("--live needs FOUNDRY_PROJECT_ENDPOINT (and az login)")
        result = compare_live(args.runs or 1)
        args.out = args.out or ROOT / "eval" / "results" / "live.json"
        if result["warning"]:
            print(f"WARNING: {result['warning']} - these are not model numbers", file=sys.stderr)
    else:
        result = compare(args.runs or 3, args.slip)
    text = json.dumps(result, indent=2)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
