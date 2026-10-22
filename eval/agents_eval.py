"""QUA/AGT eval: one golden-set report per agent, offline now, live when the quota lands.

    uv run --all-packages python eval/agents_eval.py                 # offline, rules agents
    uv run --all-packages python eval/agents_eval.py --live          # Foundry (needs quota + login)

What is measured, and what grades it:

- Producer: did every goal and red card get a line, and how much of what it picked is a key moment.
  Graded against the event log's event types.
- Analyst: is each claim's value what a separate counter (written here, not `state.counted`)
  gets from the raw events up to the claim's evidence sequence. xG is reported as unchecked.
- Narrator: does every number in a shown line appear in its claims, are all names in the roster,
  is the line inside its persona's length limit, and do the two personas differ.
- Verifier: the real checks are replayed on mutated copies of every line the workflow verified
  (changed number, changed claim value, wrong unit, invented name, forged source, stale claim,
  overlong line). Catch rate is per mutation; false rejects are counted on untouched copies.
  A player from the other team is listed as a known blind spot: the roster check is per match.
  End to end, the seeded bad claim is injected at several match times and the audit chain must
  show it rejected and no shown line may carry a wrong claim.
- Ask: the 40-question golden set (retrieval hit rate, unanswerable abstain rate, live answers
  carry the right count) and the red-team prompts (stopped by the shield or the safety screen).

Offline, the agents are the deterministic rules twins, so this proves the harness and the
rules floor, not model quality. Live runs swap in `live_agents`; the same numbers then grade the
model-backed agents. Nothing here is called in PR checks that needs Azure.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Any

from matchcast_agents import AgentSet, MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents.ask import Assistant, Bm25Index, load_kb
from matchcast_agents.personas import max_chars
from matchcast_agents.rules.verifier import VerifierRules
from matchcast_agents.safety import LocalSafetyScreen
from matchcast_agents.verify.checks import extract_names, extract_numbers

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "packages" / "agents" / "tests" / "fixtures" / "match-short.json"
SHOWN = ("verified", "approved", "published")
KEY_MOMENTS = {"goal", "card", "shot", "period_boundary"}
BAD_CLAIM_TIMES_MS = (0, 60_000, 150_000, 240_000, 330_000, 420_000, 510_000)

AgentsFactory = Callable[..., AgentSet]


def load_match() -> dict[str, Any]:
    return json.loads(FIXTURE.read_text())


def make_flow(match: dict[str, Any], factory: AgentsFactory, **agent_kwargs: Any) -> MatchWorkflow:
    config = WorkflowConfig(approval_mode="auto")
    return MatchWorkflow(
        stream=match["roster"]["stream"],
        roster=match["roster"],
        names=match["names"],
        clubs=match["teams"],
        agents=factory(config.personas, **agent_kwargs),
        config=config,
    )


class RecordingVerifier(VerifierRules):
    """The rules Verifier that remembers what it was asked, so the checks can be replayed."""

    def __init__(self) -> None:
        self.seen: list[tuple[Any, Any, list[dict[str, Any]], str]] = []

    async def check(self, ctx, line, claims):  # type: ignore[no-untyped-def]
        verdict = await super().check(ctx, line, claims)
        self.seen.append((ctx, line, claims, verdict.verdict))
        return verdict


def run(match: dict[str, Any], factory: AgentsFactory, **agent_kwargs: Any) -> MatchWorkflow:
    flow = make_flow(match, factory, **agent_kwargs)
    asyncio.run(flow.ingest(match["events"]))
    return flow


def rate(num: int, den: int) -> float | None:
    return round(num / den, 3) if den else None


# ---- independent counter -------------------------------------------------------------------


def independent_count(
    events: list[dict[str, Any]], metric: str, team: str, upto: int
) -> int | None:
    """Count from raw events with its own rules; None for metrics this eval does not recount."""
    total = 0
    for ev in events:
        if ev["stream_sequence"] > upto:
            continue
        p = ev["payload"]
        if p["type"] in ("correction", "retraction") or p.get("team_id") != team:
            continue
        kind = p["type"]
        if metric == "goals":
            total += kind == "goal"
        elif metric == "shots":
            total += kind == "shot"
        elif metric == "shots_on_target":
            total += kind == "shot" and bool(p["on_target"])
        elif metric == "fouls":
            total += kind == "foul"
        elif metric == "cards":
            total += kind == "card"
        elif metric == "red_cards":
            total += kind == "card" and p["colour"] != "yellow"
        elif metric == "tackles_won":
            total += kind == "tackle" and p["outcome"] == "won"
        else:
            return None
    return total


# ---- per agent -----------------------------------------------------------------------------


def eval_producer(flow: MatchWorkflow, match: dict[str, Any]) -> dict[str, Any]:
    by_id = {e["event_id"]: e["payload"] for e in match["events"]}
    moments = {ln.moment_id.removeprefix("m-") for ln in flow.store.lines(flow.sk)}
    must = [i for i, p in by_id.items() if p["type"] == "goal" or (
        p["type"] == "card" and p["colour"] != "yellow")]  # fmt: skip
    covered = [i for i in must if i in moments]
    key = [i for i in moments if by_id.get(i, {}).get("type") in KEY_MOMENTS]
    return {
        "must_cover_events": len(must),
        "must_cover_recall": rate(len(covered), len(must)),
        "moments_picked": len(moments),
        "key_moment_precision": rate(len(key), len(moments)),
        "events_total": len(by_id),
        "events_skipped_share": rate(len(by_id) - len(moments), len(by_id)),
    }


def eval_analyst(flow: MatchWorkflow, match: dict[str, Any]) -> dict[str, Any]:
    claims = flow.store.claims(flow.sk)
    checked = right = unchecked = 0
    wrong: list[str] = []
    xg_values = []
    for row in claims:
        packet = row["packet"] if "packet" in row else row
        name, team = packet["metric"].split(":", 1)
        truth = independent_count(match["events"], name, team, packet["max_evidence_sequence"])
        if truth is None:
            unchecked += 1
            if name == "xg":
                xg_values.append(packet["value"])
            continue
        checked += 1
        if truth == packet["value"]:
            right += 1
        else:
            wrong.append(f"{packet['claim_id']}: {packet['metric']} {packet['value']} vs {truth}")
    sourced = sum(
        1
        for row in claims
        if (row.get("packet") or row)["source"].get("events")
        or (row.get("packet") or row)["source"].get("type") == "interval"
    )
    return {
        "claims": len(claims),
        "recounted": checked,
        "claim_accuracy": rate(right, checked),
        "not_recounted_here": unchecked,
        "xg_in_range": rate(sum(0 <= v <= 6 for v in xg_values), len(xg_values)),
        "with_source": rate(sourced, len(claims)),
        "wrong": wrong[:5],
    }


def eval_narrator(flow: MatchWorkflow, match: dict[str, Any]) -> dict[str, Any]:
    allowed_names = {n.casefold() for n in [*match["names"].values(), *match["teams"].values()]}
    lines = [ln for ln in flow.store.lines(flow.sk) if ln.status in SHOWN]
    faithful = within = 0
    for ln in lines:
        values = {
            float(((flow.store.get_claim(flow.sk, c) or {}).get("packet") or {}).get("value", -1))
            for c in ln.claim_ids
        }
        nums_ok = all(n in values for n in extract_numbers(ln.text))
        names_ok = all(n.casefold() in allowed_names for n in extract_names(ln.text))
        faithful += nums_ok and names_ok
        within += len(ln.text) <= max_chars(ln.persona)
    per_moment: dict[str, dict[str, str]] = {}
    for ln in lines:
        per_moment.setdefault(ln.moment_id, {})[ln.persona] = ln.text
    pairs = [m for m in per_moment.values() if {"casual", "analyst"} <= set(m)]
    differ = sum(m["casual"] != m["analyst"] for m in pairs)
    return {
        "lines_shown": len(lines),
        "faithful_rate": rate(faithful, len(lines)),
        "within_length_rate": rate(within, len(lines)),
        "persona_pairs": len(pairs),
        "personas_differ_rate": rate(differ, len(pairs)),
    }


def mutations(ctx: Any, line: Any, claims: list[dict[str, Any]]) -> dict[str, tuple[Any, list]]:
    """Each wrong version of a verified (line, claims) pair, and the check that should refuse it."""
    out: dict[str, tuple[Any, list]] = {}
    numbers = re.findall(r"(?<![\w.])\d+(?![\w.])", line.text)
    if numbers:
        n = numbers[0]
        out["number_in_text_changed"] = (
            line.model_copy(update={"text": line.text.replace(n, str(int(n) + 1), 1)}),
            claims,
        )
    if claims:
        bent = [dict(c) for c in claims]
        bent[0]["value"] = bent[0]["value"] + 1
        out["claim_value_off_by_one"] = (line, bent)
        unit = [dict(c) for c in claims]
        unit[0]["units"] = "percent" if unit[0]["units"] != "percent" else "count"
        out["wrong_unit"] = (line, unit)
        forged = [dict(c) for c in claims]
        src = dict(forged[0]["source"])
        if src.get("type") == "events" and src.get("events"):
            src["events"] = [{**src["events"][0], "event_id": "ev-forged"}]
            forged[0]["source"] = src
            out["source_event_forged"] = (line, forged)
        stale = [dict(c) for c in claims]
        snap = dict(stale[0]["snapshot"])
        snap["state_revision"] = snap["state_revision"] - 10
        snap["event_time_ms"] = snap["event_time_ms"] - 60_000
        stale[0]["snapshot"] = snap
        if ctx.state.revision - snap["state_revision"] > 5:
            out["claim_stale"] = (line, stale)
    out["invented_player"] = (
        line.model_copy(update={"text": line.text + " Dario Vance agrees."}),
        claims,
    )
    out["line_too_long"] = (
        line.model_copy(update={"text": line.text + " x" * line.max_chars}),
        claims,
    )
    return out


def other_team_player(ctx: Any, line: Any) -> Any | None:
    """Swap a player for one from the other club: the roster check cannot see this."""
    team_of = {p["player_id"]: p["team_id"] for p in ctx.roster["players"]}
    for pid, name in ctx.names.items():
        if name in line.text:
            others = [n for q, n in ctx.names.items() if team_of.get(q) != team_of.get(pid)]
            if others:
                return line.model_copy(update={"text": line.text.replace(name, others[0], 1)})
    return None


def eval_verifier(match: dict[str, Any], factory: AgentsFactory) -> dict[str, Any]:
    verifier = RecordingVerifier()
    flow = make_flow(match, factory)
    flow.agents.verifier = verifier  # type: ignore[assignment]
    asyncio.run(flow.ingest(match["events"]))
    pairs = [(c, ln, cl, v) for c, ln, cl, v in verifier.seen if cl]
    check = VerifierRules().check

    def verdict(ctx: Any, line: Any, claims: list) -> str:
        return asyncio.run(check(ctx, line, claims)).verdict

    # an unseeded run: every line is honest, so any rejection is a false reject
    false_rejects = sum(v == "rejected" for *_, v in pairs)
    replay_drift = sum(verdict(c, ln, cl) != v for c, ln, cl, v in pairs)
    first_pass = [(c, ln, cl) for c, ln, cl, v in pairs if v != "rejected"]
    caught: Counter[str] = Counter()
    tried: Counter[str] = Counter()
    for ctx, line, claims in first_pass:
        for kind, (bad_line, bad_claims) in mutations(ctx, line, claims).items():
            tried[kind] += 1
            caught[kind] += verdict(ctx, bad_line, bad_claims) == "rejected"
    blind = tried_blind = 0
    for ctx, line, claims in first_pass:
        swapped = other_team_player(ctx, line)
        if swapped is not None:
            tried_blind += 1
            blind += verdict(ctx, swapped, claims) == "rejected"
    per_kind = {k: {"tried": tried[k], "caught": caught[k], "rate": rate(caught[k], tried[k])}
                for k in sorted(tried)}  # fmt: skip
    total_tried, total_caught = sum(tried.values()), sum(caught.values())
    return {
        "pairs_replayed": len(first_pass),
        "honest_lines_checked": len(pairs),
        "false_reject_rate_on_clean": rate(false_rejects, len(pairs)),
        "replay_drift": replay_drift,
        "mutations_tried": total_tried,
        "catch_rate": rate(total_caught, total_tried),
        "by_mutation": per_kind,
        "known_blind_spot_other_team_player": {
            "tried": tried_blind,
            "caught": blind,
            "rate": rate(blind, tried_blind),
        },  # fmt: skip
    }


def eval_seeded(match: dict[str, Any], factory: AgentsFactory) -> dict[str, Any]:
    trials = []
    for at in BAD_CLAIM_TIMES_MS:
        flow = run(match, factory, seed_bad_claim=True, seed_bad_claim_at_ms=at)
        actions = [r["action"] for r in flow.store.audit_records(flow.sk)]
        shown = [ln for ln in flow.store.lines(flow.sk) if ln.status in SHOWN]
        leaked = 0
        for ln in shown:
            for cid in ln.claim_ids:
                packet = (flow.store.get_claim(flow.sk, cid) or {}).get("packet") or {}
                name, team = packet["metric"].split(":", 1)
                truth = independent_count(
                    match["events"], name, team, packet["max_evidence_sequence"]
                )
                leaked += truth is not None and truth != packet["value"]
        trials.append(
            {
                "inject_at_ms": at,
                "rejected": "line_rejected" in actions,
                "repaired_or_abstained": any(
                    a in actions for a in ("line_repair_requested", "line_abstained")
                ),
                "wrong_claims_shown": leaked,
            }
        )
    return {
        "trials": len(trials),
        "caught_rate": rate(sum(t["rejected"] for t in trials), len(trials)),
        "wrong_claims_shown_total": sum(t["wrong_claims_shown"] for t in trials),
        "repair_or_abstain_rate": rate(
            sum(t["repaired_or_abstained"] for t in trials), len(trials)
        ),
        "detail": trials,
    }


def eval_ask(match: dict[str, Any], factory: AgentsFactory) -> dict[str, Any]:
    flow = run(match, factory)
    assistant = Assistant(Bm25Index(load_kb(ROOT / "kb")))
    rows = [json.loads(x) for x in (ROOT / "eval" / "ask_golden.jsonl").read_text().splitlines()]
    kinds: Counter[str] = Counter()
    good: Counter[str] = Counter()
    for row in rows:
        result = asyncio.run(assistant.ask(flow, row["q"], "casual"))
        kind = row["kind"]
        kinds[kind] += 1
        if kind == "unanswerable":
            good[kind] += result.abstained
        elif result.abstained or not result.citations:
            continue
        elif kind == "knowledge":
            good[kind] += any(c["id"].startswith(row["expect_kb"]) for c in result.citations)
        elif kind == "live":
            ok = result.intent == "live"
            for cite in result.citations:
                packet = (flow.store.get_claim(flow.sk, cite["id"]) or {}).get("packet")
                if packet is None:
                    ok = False
                    continue
                metric, team = packet["metric"].split(":")
                ok &= metric == row["expect_metric"] and packet["value"] == flow.store.get_state(
                    flow.sk
                ).count(metric, team)
            good[kind] += ok
        elif kind == "both":
            good[kind] += result.intent == "both" and {c["type"] for c in result.citations} == {
                "claim",
                "kb",
            }
    screen = LocalSafetyScreen()
    red = [json.loads(x) for x in (ROOT / "eval" / "redteam.jsonl").read_text().splitlines()]
    stopped = tried = 0
    for row in red:
        if row["layer"] == "shield":
            tried += 1
            stopped += asyncio.run(screen.shield(row["prompt"])).attack_detected
        elif row["layer"] == "safety":
            tried += 1
            stopped += not asyncio.run(screen.analyze(row["prompt"])).allowed
    return {
        "golden_questions": len(rows),
        "by_kind": {
            k: {"asked": kinds[k], "right": good[k], "rate": rate(good[k], kinds[k])}
            for k in sorted(kinds)
        },  # fmt: skip
        "unanswerable_refusal_rate": rate(good["unanswerable"], kinds["unanswerable"]),
        "redteam_prompts_checked_here": tried,
        "redteam_stopped_rate": rate(stopped, tried),
        "redteam_not_checked_here": sum(r["layer"] == "ask" for r in red),
    }


# ---- run and report ------------------------------------------------------------------------


def evaluate(factory: AgentsFactory, label: str) -> dict[str, Any]:
    match = load_match()
    flow = run(match, factory)
    return {
        "agents": label,
        "match": match["roster"]["stream"]["match_id"],
        "producer": eval_producer(flow, match),
        "analyst": eval_analyst(flow, match),
        "narrator": eval_narrator(flow, match),
        "verifier": eval_verifier(match, factory),
        "seeded_bad_claim": eval_seeded(match, factory),
        "ask": eval_ask(match, factory),
    }


def pct(x: float | None) -> str:
    return "n/a" if x is None else f"{100 * x:.1f}%"


def report(r: dict[str, Any]) -> str:
    p, a, n, v, s, k = (r[x] for x in ("producer", "analyst", "narrator", "verifier",
                                       "seeded_bad_claim", "ask"))  # fmt: skip
    mut = "\n".join(
        f"| {name} | {d['tried']} | {d['caught']} | {pct(d['rate'])} |"
        for name, d in v["by_mutation"].items()
    )
    blind = v["known_blind_spot_other_team_player"]
    kinds = "\n".join(
        f"| {name} | {d['asked']} | {d['right']} | {pct(d['rate'])} |"
        for name, d in k["by_kind"].items()
    )
    return f"""# Agent evaluation

Agents graded: **{r["agents"]}** on the frozen match `{r["match"]}`. Generated by
`eval/agents_eval.py`; do not edit by hand. {"Offline numbers grade the deterministic rules agents, so they show the harness works and set the floor a model-backed agent must not fall below. They say nothing about model quality." if r["agents"] == "rules" else "Live numbers grade the Foundry-backed agents."}

## Headline

| Question | Result |
| --- | --- |
| Claims whose value matches an independent recount | {pct(a["claim_accuracy"])} of {a["recounted"]} |
| Wrong claims that reached a screen, seeded bad claim at {s["trials"]} match times | {s["wrong_claims_shown_total"]} |
| Seeded bad claim caught by the Verifier | {pct(s["caught_rate"])} |
| Verifier catch rate over {v["mutations_tried"]} mutated lines | {pct(v["catch_rate"])} |
| Verifier false rejects on untouched lines | {pct(v["false_reject_rate_on_clean"])} |
| Unanswerable questions refused | {pct(k["unanswerable_refusal_rate"])} |
| Prompt attacks stopped (shield and safety layers) | {pct(k["redteam_stopped_rate"])} of {k["redteam_prompts_checked_here"]} |

## Producer
Goals and red cards covered: {pct(p["must_cover_recall"])} of {p["must_cover_events"]}. Key moments among those picked: {pct(p["key_moment_precision"])} of {p["moments_picked"]}. Quiet events skipped: {pct(p["events_skipped_share"])} of {p["events_total"]}.

## Analyst
{a["claims"]} claims; {a["recounted"]} recounted from raw events by a counter written for this eval (not the Verifier's). Accuracy {pct(a["claim_accuracy"])}. {a["not_recounted_here"]} claims (xG) are not recounted here; the Verifier recomputes them. Claims with a source: {pct(a["with_source"])}.

## Narrator
{n["lines_shown"]} shown lines. Every number in a claim and every name in the roster: {pct(n["faithful_rate"])}. Inside the persona length limit: {pct(n["within_length_rate"])}. Casual and analyst wording differ on {pct(n["personas_differ_rate"])} of {n["persona_pairs"]} moments.

## Verifier
The real checks, replayed on {v["pairs_replayed"]} lines the workflow verified, each changed in one way.

| Mutation | Tried | Caught | Rate |
| --- | --- | --- | --- |
{mut}

**Known blind spot.** Swapping in a player from the other club is caught {blind["caught"]} of {blind["tried"]} times: the roster check is per match, not per team. This is listed, not hidden. The meaning check (does the sentence say what the claims say) is the live Verifier's model step and is skipped in rules mode.

Seeded bad claim, end to end: the corrupted claim is injected at {s["trials"]} match times; it was rejected in {pct(s["caught_rate"])} of trials, repaired or abstained in {pct(s["repair_or_abstain_rate"])}, and {s["wrong_claims_shown_total"]} wrong claims were shown.

## Ask the match
{k["golden_questions"]}-question golden set.

| Kind | Asked | Right | Rate |
| --- | --- | --- | --- |
{kinds}

Red-team: {k["redteam_prompts_checked_here"]} prompts checked at the shield and safety layers; {k["redteam_not_checked_here"]} more belong to the Ask router and are covered by the golden-set gate.

## Run it
`uv run --all-packages python eval/agents_eval.py` (offline). `--live` runs the same set on the Foundry agents once quota exists and writes `docs/eval/agents-eval-live.md`.
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--out-dir", type=Path, default=ROOT)
    args = ap.parse_args()
    if args.live:
        from matchcast_agents.live import live_agents
        from matchcast_agents.live.client import FoundryModelClient

        client = FoundryModelClient()

        def factory(personas, **kw):  # type: ignore[no-untyped-def]
            return live_agents(client, personas, **kw)

        label, stem = "live", "agents-eval-live"
    else:
        factory, label, stem = rules_agents, "rules", "agents-eval"
    result = evaluate(factory, label)
    results = args.out_dir / "eval" / "results" / f"{stem.replace('agents-eval', 'agents')}.json"
    results.parent.mkdir(parents=True, exist_ok=True)
    results.write_text(json.dumps(result, indent=2) + "\n")
    doc = args.out_dir / "docs" / "eval" / f"{stem}.md"
    doc.parent.mkdir(parents=True, exist_ok=True)
    doc.write_text(report(result))
    print(report(result))


if __name__ == "__main__":
    main()
