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
  A teammate swapped in for the event's player is reported separately: the Verifier accepts only
  the players the moment's event names.
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
from matchcast_agents.safety import LocalSafetyScreen
from matchcast_agents.verify.checks import extract_names, extract_numbers, is_generic
from matchcast_agents.workflow import WorkflowError

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "packages" / "agents" / "tests" / "fixtures" / "match-short.json"
# the reason the Verifier must give for each wrong version; a catch for another reason is a miss
EXPECTED = {
    "number_in_text_changed": "number_mismatch",
    "claim_value_off_by_one": "number_mismatch",
    "invented_player": "unknown_player",
    "player_from_other_club": "unknown_player",
    "source_forged": "unknown_source",
    "wrong_unit": "number_mismatch",
    "claim_stale": "stale_state",
    "line_too_long": "length_exceeded",
}
# these are caught by a table lookup or a fixed threshold, so they are reported apart
BY_CONSTRUCTION = ("wrong_unit", "claim_stale", "line_too_long")
SHOWN = ("verified", "approved", "published")
KEY_MOMENTS = {"goal", "card", "shot", "period_boundary"}
BAD_CLAIM_TIMES_MS = (0, 60_000, 150_000, 240_000, 330_000, 420_000, 510_000)

AgentsFactory = Callable[..., AgentSet]


def load_match() -> dict[str, Any]:
    return json.loads(FIXTURE.read_text())


def make_flow(
    match: dict[str, Any],
    factory: AgentsFactory,
    personas: tuple[str, ...] | None = None,
    **agent_kwargs: Any,
) -> MatchWorkflow:
    config = WorkflowConfig(approval_mode="auto", **({"personas": personas} if personas else {}))
    return MatchWorkflow(
        stream=match["roster"]["stream"],
        roster=match["roster"],
        names=match["names"],
        clubs=match["teams"],
        agents=factory(config.personas, **agent_kwargs),
        config=config,
    )


class RecordingVerifier:
    """Wraps the flow's own Verifier and remembers each call, so the checks can be replayed."""

    def __init__(self, inner: Any) -> None:
        self.inner = inner
        self.mode = getattr(inner, "mode", "live")
        self.agent_id = getattr(inner, "agent_id", "verifier")
        self.seen: list[tuple[Any, Any, list[dict[str, Any]], str, str | None]] = []

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)

    async def check(self, ctx, line, claims):  # type: ignore[no-untyped-def]
        verdict = await self.inner.check(ctx, line, claims)
        self.seen.append((ctx, line, claims, verdict.verdict, verdict.reason_code))
        return verdict


class RecordingAnalyst:
    """Wraps the flow's Analyst and keeps every claim it returned, before any repair."""

    def __init__(self, inner: Any) -> None:
        self.inner = inner
        self.mode = getattr(inner, "mode", "live")
        self.agent_id = getattr(inner, "agent_id", "analyst")
        self.returned: list[dict[str, Any]] = []

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)

    async def analyse(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        claims = await self.inner.analyse(*args, **kwargs)
        self.returned.extend(getattr(c, "packet", c) for c in claims)
        return claims


def run(
    match: dict[str, Any], factory: AgentsFactory, *, record: bool = False, **agent_kwargs: Any
) -> tuple[MatchWorkflow, RecordingVerifier | None]:
    flow = make_flow(match, factory, **agent_kwargs)
    tap = RecordingAnalyst(flow.agents.analyst)
    flow.agents.analyst = tap  # type: ignore[assignment]
    flow.analyst_tap = tap  # type: ignore[attr-defined]
    recorder = None
    if record:
        recorder = RecordingVerifier(flow.agents.verifier)
        flow.agents.verifier = recorder  # type: ignore[assignment]
    asyncio.run(flow.ingest(match["events"]))
    return flow, recorder


def fallbacks(flow: MatchWorkflow) -> int:
    """Calls where a model-backed agent failed and the rules twin answered instead."""
    return sum(r["action"] == "fallback_used" for r in flow.store.audit_records(flow.sk))


def rate(num: int, den: int) -> float | None:
    return round(num / den, 3) if den else None


# ---- independent counter -------------------------------------------------------------------


def _independent_share(events: list[dict[str, Any]], metric: str, team: str, upto: int) -> int:
    """A match-to-date share from raw events, written apart from match_shares.py: the team's percent
    of on-ball actions (possession), or of its passes that completed (pass accuracy)."""
    done = [
        ev["payload"]
        for ev in events
        if ev["stream_sequence"] <= upto
        and ev["payload"]["type"] not in ("correction", "retraction")
    ]
    if metric == "possession_share":
        on_ball = Counter(p["team_id"] for p in done if p["type"] in ("pass", "carry"))
        total = sum(on_ball.values())
        return round(100 * on_ball[team] / total) if total else 0
    completed = sum(p["type"] == "pass" and p["team_id"] == team for p in done)
    lost = sum(
        p["type"] == "possession_change"
        and p["from_team_id"] == team
        and p["cause"] == "loose_ball"
        for p in done
    )
    return round(100 * completed / (completed + lost)) if completed + lost else 0


def independent_count(
    events: list[dict[str, Any]], metric: str, team: str, upto: int
) -> int | None:
    """Count from raw events with its own rules; None for metrics this eval does not recount."""
    if metric in ("possession_share", "pass_accuracy"):
        return _independent_share(events, metric, team, upto)
    total = 0
    for ev in events:
        if ev["stream_sequence"] > upto:
            continue
        p = ev["payload"]
        if p["type"] in ("correction", "retraction"):
            continue
        if p.get("to_team_id" if p["type"] == "possession_change" else "team_id") != team:
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
        elif metric == "passes":
            total += kind == "pass"
        elif metric == "pressures":
            total += kind == "pressure"
        elif metric == "possession_won":
            total += kind == "possession_change"
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
        "quiet_events": sum(p["type"] not in KEY_MOMENTS for p in by_id.values()),
        "quiet_events_skipped_share": rate(
            sum(p["type"] not in KEY_MOMENTS and i not in moments for i, p in by_id.items()),
            sum(p["type"] not in KEY_MOMENTS for p in by_id.values()),
        ),
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
    return {
        "claims": len(claims),
        "recounted": checked,
        "claim_accuracy": rate(right, checked),
        "not_recounted_here": unchecked,
        "xg_in_range": rate(sum(0 <= v <= 6 for v in xg_values), len(xg_values)),
        "wrong": wrong[:5],
    }


def eval_narrator(flow: MatchWorkflow, match: dict[str, Any]) -> dict[str, Any]:
    """First drafts only, whatever happened to them: this is the Narrator before the Verifier."""
    allowed_names = {n.casefold() for n in [*match["names"].values(), *match["teams"].values()]}
    drafts = [ln for ln in flow.store.lines(flow.sk) if not ln.repair_of]
    faithful = within = 0
    for ln in drafts:
        spare = Counter(
            float(((flow.store.get_claim(flow.sk, c) or {}).get("packet") or {}).get("value", -1))
            for c in ln.claim_ids
        )
        nums_ok = True
        for n in extract_numbers(ln.text):
            nums_ok &= spare[n] > 0
            spare[n] -= 1
        names_ok = all(n.casefold() in allowed_names for n in extract_names(ln.text))
        faithful += nums_ok and names_ok
        within += len(ln.text) <= max_chars(ln.persona)
    shown = [ln for ln in drafts if ln.status in SHOWN]
    per_moment: dict[str, dict[str, str]] = {}
    for ln in shown:
        per_moment.setdefault(ln.moment_id, {})[ln.persona] = ln.text
    pairs = [m for m in per_moment.values() if {"casual", "analyst"} <= set(m)]
    differ = sum(m["casual"] != m["analyst"] for m in pairs)
    return {
        "first_drafts": len(drafts),
        "first_draft_faithful_rate": rate(faithful, len(drafts)),
        "first_draft_within_length_rate": rate(within, len(drafts)),
        "persona_pairs": len(pairs),
        "personas_differ_rate": rate(differ, len(pairs)),
    }


def eval_booth(match: dict[str, Any], factory: AgentsFactory) -> dict[str, Any]:
    """The colour voice on first drafts: a reaction that names no player or club and carries no
    number could be said of any match (generic), and a line said twice is not varied phrasing."""
    flow = make_flow(match, factory, personas=("casual", "booth:pbp", "booth:colour"))
    asyncio.run(flow.ingest(match["events"]))
    ctx = flow._ctx()
    drafts = [
        ln for ln in flow.store.lines(flow.sk) if ln.persona == "booth:colour" and not ln.repair_of
    ]
    generic = sum(is_generic(ctx, ln.text) for ln in drafts)
    return {
        "colour_drafts": len(drafts),
        "generic_colour_rate": rate(generic, len(drafts)),
        "distinct_colour_rate": rate(len({ln.text for ln in drafts}), len(drafts)),
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
            out["source_forged"] = (line, forged)
        elif src.get("type") == "interval":
            src["to_stream_sequence"] = 1_000_000  # an interval that ends after the stored events
            forged[0]["source"] = src
            out["source_forged"] = (line, forged)
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
    swapped = swap_player(ctx, line, same_team=False)
    if swapped is not None:
        out["player_from_other_club"] = (swapped, claims)
    out["line_too_long"] = (
        line.model_copy(update={"text": line.text + " x" * line.max_chars}),
        claims,
    )
    return out


def swap_player(ctx: Any, line: Any, same_team: bool) -> Any | None:
    """Put a different player in the line: from the other club, or a teammate of the named one."""
    team_of = {p["player_id"]: p["team_id"] for p in ctx.roster["players"]}
    for pid, name in ctx.names.items():
        if name in line.text:
            others = [
                n
                for q, n in ctx.names.items()
                if q != pid and (team_of.get(q) == team_of.get(pid)) == same_team
            ]
            if others:
                return line.model_copy(update={"text": line.text.replace(name, others[0], 1)})
    return None


def eval_verifier(recorder: RecordingVerifier) -> dict[str, Any]:
    pairs = [x for x in recorder.seen if x[2]]
    inner = recorder.inner

    def reply(ctx: Any, line: Any, claims: list) -> Any:
        return asyncio.run(inner.check(ctx, line, claims))

    # an unseeded run: every line is honest, so any rejection is a false reject
    false_rejects = sum(v == "rejected" for _, _, _, v, _ in pairs)
    why = Counter(code or "none" for _, _, _, v, code in pairs if v == "rejected")
    first_pass = [(c, ln, cl) for c, ln, cl, v, _ in pairs if v != "rejected"]
    caught: Counter[str] = Counter()
    tried: Counter[str] = Counter()
    for ctx, line, claims in first_pass:
        for kind, (bad_line, bad_claims) in mutations(ctx, line, claims).items():
            tried[kind] += 1
            got = reply(ctx, bad_line, bad_claims)
            caught[kind] += got.verdict == "rejected" and got.reason_code == EXPECTED[kind]
    blind = tried_blind = 0
    for ctx, line, claims in first_pass:
        swapped = swap_player(ctx, line, same_team=True)
        if swapped is not None:
            tried_blind += 1
            blind += reply(ctx, swapped, claims).verdict == "rejected"
    per_kind = {
        k: {
            "tried": tried[k],
            "caught": caught[k],
            "rate": rate(caught[k], tried[k]),
            "by_construction": k in BY_CONSTRUCTION,
        }
        for k in sorted(tried)
    }
    content = [k for k in tried if k not in BY_CONSTRUCTION]
    return {
        "pairs_replayed": len(first_pass),
        "honest_lines_checked": len(pairs),
        "false_reject_rate_on_clean": rate(false_rejects, len(pairs)),
        "false_reject_reasons": dict(sorted(why.items())),
        "content_mutations_tried": sum(tried[k] for k in content),
        "catch_rate": rate(sum(caught[k] for k in content), sum(tried[k] for k in content)),
        "by_mutation": per_kind,
        "known_gap_wrong_teammate": {
            "tried": tried_blind,
            "caught": blind,
            "rate": rate(blind, tried_blind),
        },
    }


def eval_seeded(match: dict[str, Any], factory: AgentsFactory) -> dict[str, Any]:
    trials = []
    degraded = 0
    for at in BAD_CLAIM_TIMES_MS:
        flow, _ = run(match, factory, seed_bad_claim=True, seed_bad_claim_at_ms=at)
        degraded += fallbacks(flow)
        records = flow.store.audit_records(flow.sk)
        rejected = [r for r in records if r["action"] == "line_rejected"]
        by_reason = [r for r in rejected if r["details"].get("reason_code") == "number_mismatch"]
        actions = {r["action"] for r in records}

        def wrong(packet: dict[str, Any]) -> bool:
            name, team = packet["metric"].split(":", 1)
            truth = independent_count(match["events"], name, team, packet["max_evidence_sequence"])
            return truth is not None and truth != packet["value"]

        # the injection really happened: the Analyst handed over a claim the recount disagrees with
        injected = any(wrong(c) for c in flow.analyst_tap.returned)  # type: ignore[attr-defined]
        leaked = 0
        for ln in flow.store.lines(flow.sk):
            if ln.status in SHOWN:
                for cid in ln.claim_ids:
                    leaked += wrong((flow.store.get_claim(flow.sk, cid) or {}).get("packet") or {})
        trials.append(
            {
                "inject_at_ms": at,
                "injected": injected,
                "caught": injected and bool(by_reason),
                "repaired_or_abstained": bool(
                    actions & {"line_repair_requested", "line_abstained"}
                ),
                "wrong_claims_shown": leaked,
            }
        )
    injected = [t for t in trials if t["injected"]]
    return {
        "trials": len(trials),
        "injected": len(injected),
        "caught_rate": rate(sum(t["caught"] for t in injected), len(injected)),
        "wrong_claims_shown_total": sum(t["wrong_claims_shown"] for t in trials),
        "repair_or_abstain_rate": rate(
            sum(t["repaired_or_abstained"] for t in injected), len(injected)
        ),
        "fallbacks": degraded,
        "detail": trials,
    }


def eval_ask(flow: MatchWorkflow) -> dict[str, Any]:
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
    missed: list[str] = []
    for row in red:
        tried += 1
        if row["layer"] == "shield":
            hit = asyncio.run(screen.shield(row["prompt"])).attack_detected
        elif row["layer"] == "safety":
            hit = not asyncio.run(screen.analyze(row["prompt"])).allowed
        else:  # the whole Ask path: shield, router, abstain
            try:
                hit = asyncio.run(flow.ask(row["prompt"])).abstained
            except WorkflowError:
                hit = True
        stopped += hit
        if not hit:
            missed.append(row["id"])
    return {
        "golden_questions": len(rows),
        "by_kind": {
            k: {"asked": kinds[k], "right": good[k], "rate": rate(good[k], kinds[k])}
            for k in sorted(kinds)
        },  # fmt: skip
        "unanswerable_refusal_rate": rate(good["unanswerable"], kinds["unanswerable"]),
        "redteam_prompts": tried,
        "redteam_stopped_rate": rate(stopped, tried),
        "redteam_missed": missed,
    }


# ---- run and report ------------------------------------------------------------------------


def evaluate(factory: AgentsFactory, label: str) -> dict[str, Any]:
    match = load_match()
    flow, recorder = run(match, factory, record=True)
    assert recorder is not None
    seeded = eval_seeded(match, factory)
    return {
        "agents": label,
        "match": match["roster"]["stream"]["match_id"],
        "fallbacks": fallbacks(flow) + seeded["fallbacks"],
        "producer": eval_producer(flow, match),
        "analyst": eval_analyst(flow, match),
        "narrator": eval_narrator(flow, match),
        "booth": eval_booth(match, factory),
        "verifier": eval_verifier(recorder),
        "seeded_bad_claim": seeded,
        "ask": eval_ask(flow),
    }


def pct(x: float | None) -> str:
    return "n/a" if x is None else f"{100 * x:.1f}%"


def report(r: dict[str, Any]) -> str:
    p, a, n, v, s, k = (r[x] for x in ("producer", "analyst", "narrator", "verifier",
                                       "seeded_bad_claim", "ask"))  # fmt: skip
    b = r["booth"]
    reasons = v["false_reject_reasons"]
    why = " (" + ", ".join(f"{k} {n}" for k, n in reasons.items()) + ")" if reasons else ""

    def mut_rows(structural: bool) -> str:
        return "\n".join(
            f"| {name} | {d['tried']} | {d['caught']} | {pct(d['rate'])} |"
            for name, d in v["by_mutation"].items()
            if d["by_construction"] == structural
        )

    blind = v["known_gap_wrong_teammate"]
    kinds = "\n".join(
        f"| {name} | {d['asked']} | {d['right']} | {pct(d['rate'])} |"
        for name, d in k["by_kind"].items()
    )
    if r["agents"] == "rules":
        who = (
            "Offline numbers grade the deterministic rules agents, so they show the harness works "
            "and set the floor a model-backed agent must not fall below. They say nothing about "
            "model quality."
        )
    else:
        who = (
            f"Live numbers grade the Foundry-backed Analyst, Narrator and Verifier (the Producer "
            f"is rules by design and Ask has no model). Model calls that failed and fell back to "
            f"the rules twin: **{r['fallbacks']}**"
            + ("; these numbers are partly rules-mode." if r["fallbacks"] else ".")
        )
    missed = ", ".join(k["redteam_missed"]) or "none"
    return f"""# Agent evaluation

Agents graded: **{r["agents"]}** on the frozen match `{r["match"]}`. Generated by `eval/agents_eval.py`; do not edit by hand. {who}

## Headline

| Question | Result |
| --- | --- |
| Claims whose value matches an independent recount | {pct(a["claim_accuracy"])} of {a["recounted"]} |
| Seeded bad claim: injected, then rejected for the right reason | {pct(s["caught_rate"])} of {s["injected"]} injections ({s["trials"]} match times) |
| Wrong claims that reached a screen in those runs | {s["wrong_claims_shown_total"]} |
| Verifier catch rate over {v["content_mutations_tried"]} content mutations (right reason code required) | {pct(v["catch_rate"])} |
| Verifier false rejects on {v["honest_lines_checked"]} honest lines | {pct(v["false_reject_rate_on_clean"])}{why} |
| Narrator first drafts that stay inside their claims and the roster | {pct(n["first_draft_faithful_rate"])} of {n["first_drafts"]} |
| Unanswerable questions refused | {pct(k["unanswerable_refusal_rate"])} |
| Prompt attacks stopped (shield, safety and the whole Ask path) | {pct(k["redteam_stopped_rate"])} of {k["redteam_prompts"]} |

## Producer
Goals and red cards covered: {pct(p["must_cover_recall"])} of {p["must_cover_events"]}. Key moments among those picked: {pct(p["key_moment_precision"])} of {p["moments_picked"]}. Quiet events skipped: {pct(p["quiet_events_skipped_share"])} of {p["quiet_events"]}.

## Analyst
{a["claims"]} claims; {a["recounted"]} recounted from raw events by a counter written for this eval (not the Verifier's). Accuracy {pct(a["claim_accuracy"])}. {a["not_recounted_here"]} claims (xG) are not recounted here; the Verifier recomputes them.

## Narrator
{n["first_drafts"]} first drafts, whatever the Verifier later did with them. Each number must be backed by its own claim, each name must be in the roster: {pct(n["first_draft_faithful_rate"])}. Inside the persona length limit: {pct(n["first_draft_within_length_rate"])}. Casual and analyst wording differ on {pct(n["personas_differ_rate"])} of {n["persona_pairs"]} shown moments. Offline this grades templates, so 100% is expected; the number matters for a model-written line.

## Booth colour
{b["colour_drafts"]} first drafts of the colour voice. Generic (no player, no club, no number, so it could be said of any match): {pct(b["generic_colour_rate"])}; the Verifier refuses these. Different wording from every other colour line: {pct(b["distinct_colour_rate"])}. Offline the colour lines are stock sentences, so repeats are expected; the number matters for a model-written line.

## Verifier
The real checks, replayed on {v["pairs_replayed"]} lines the workflow verified, each changed in one way. A mutation counts as caught only when the Verifier gives the intended reason.

| Content mutation | Tried | Caught | Rate |
| --- | --- | --- | --- |
{mut_rows(False)}

These are caught by a table lookup or a fixed threshold, so they sit outside the headline:

| Structural mutation | Tried | Caught | Rate |
| --- | --- | --- | --- |
{mut_rows(True)}

**Wrong teammate.** Swapping the named player for a teammate who is not in the event is caught {blind["caught"]} of {blind["tried"]} times (the Verifier accepts only the players the moment's event names). **Known gaps.** Numbers written in the wrong order (a score of 0-1 for 1-0) are not caught, because each claim backs a number but not its place in the sentence. The meaning check is the live Verifier's model step and is skipped in rules mode.

Seeded bad claim, end to end: injected at {s["trials"]} match times ({s["injected"]} took effect); the Verifier rejected the line for a number mismatch in {pct(s["caught_rate"])}, repair or abstain followed in {pct(s["repair_or_abstain_rate"])}, and {s["wrong_claims_shown_total"]} wrong claims were shown.

## Ask the match
{k["golden_questions"]}-question golden set.

| Kind | Asked | Right | Rate |
| --- | --- | --- | --- |
{kinds}

Red-team: all {k["redteam_prompts"]} prompts in `eval/redteam.jsonl` are run, the shield and safety ones at their layer and the rest through the full Ask path (stopped means blocked or abstained). Not stopped: {missed}.

## Run it
`uv run --all-packages python eval/agents_eval.py` (offline). `--live` runs the same set on the Foundry agents once quota exists and writes `docs/eval/agents-eval-live.md`. A live run plays the match nine times (one main run that also feeds Ask and the Verifier replay, then seven seeded), so check the cost against the caps first.
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
