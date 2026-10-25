"""Live agents with recorded model answers: verified lines, a bad draft, outages, fallback."""

import json

from conftest import fixed_clock, run
from matchcast_agents import MatchWorkflow, WorkflowConfig
from matchcast_agents.live import ScriptedModelClient, live_agents
from matchcast_agents.resilience import ModelError, ModelTimeout


def answer(system: str, user: str, *, narrator=None, verifier=None, analyst=None):
    facts = json.loads(user)
    if "personas" in facts:
        return (narrator or good_narrator)(facts)
    if "metrics_available" in facts:
        return (analyst or good_analyst)(facts)
    return (verifier or good_verifier)(facts)


def good_analyst(facts):
    wanted = [m for m in facts["metrics_available"] if m.startswith(("shots:", "goals:"))]
    return {"metrics": wanted[:2]}


def good_narrator(facts):
    values = {c["metric"]: c["value"] for c in facts["claims"]}
    first = next(iter(values))
    team = first.split(":")[1]
    club = facts["clubs"][team]
    metric = first.split(":")[0].replace("_", " ")
    text = f"{club} {metric}: {values[first]}."
    return {"lines": [{"persona": p, "text": text} for p in facts["personas"]]}


def good_verifier(facts):
    return {"judgement": "supported", "detail": "matches the claim"}


def build(match, client):
    config = WorkflowConfig()
    return MatchWorkflow(
        stream=match["roster"]["stream"], roster=match["roster"], names=match["names"],
        clubs=match["teams"], agents=live_agents(client, config.personas), config=config,
        clock=fixed_clock(),
    )  # fmt: skip


def actions(flow):
    return [r["action"] for r in flow.store.audit_records(flow.sk)]


def test_model_written_lines_pass_the_checks_and_publish(match, monkeypatch) -> None:
    monkeypatch.setenv("MATCHCAST_LIVE_MAX_PRIORITY", "3")  # every moment goes to the model
    client = ScriptedModelClient(lambda s, u: answer(s, u))
    flow = build(match, client)
    run(flow.ingest(match["events"]))
    lines = flow.store.lines(flow.sk)
    assert lines and all(ln.origin == "model" for ln in lines)
    assert {ln.status for ln in lines} <= {"published", "approved", "verified"}
    assert flow.status == "live" and "fallback_used" not in actions(flow)
    meaning = [c for ln in lines for c in ln.checks if c.name == "meaning"]
    assert meaning and all(c.passed for c in meaning)


def test_a_wrong_number_in_a_model_line_is_rejected_and_repaired(match) -> None:
    drafts = {"n": 0}

    def narrator(facts):
        drafts["n"] += 1
        reply = good_narrator(facts)
        if "note" not in facts:  # the first draft lies, the repair is honest
            for row in reply["lines"]:
                row["text"] = row["text"].replace(".", " and 99.")
        return reply

    flow = build(match, ScriptedModelClient(lambda s, u: answer(s, u, narrator=narrator)))
    run(flow.ingest(match["events"]))
    acts = actions(flow)
    assert "line_rejected" in acts and "line_repair_requested" in acts
    assert not any("99" in ln.text for ln in flow.store.lines(flow.sk) if ln.status == "published")


def test_the_model_meaning_check_can_reject_or_send_to_review(match) -> None:
    def verifier(facts):
        return {"judgement": "unsupported", "detail": "says more than the claim"}

    flow = build(match, ScriptedModelClient(lambda s, u: answer(s, u, verifier=verifier)))
    run(flow.ingest(match["events"]))
    rejected = [ln for ln in flow.store.lines(flow.sk) if ln.status in ("rejected", "abstained")]
    assert rejected and all(
        ln.reason_code == "unsupported_statement" for ln in rejected if ln.reason_code
    )
    unclear = ScriptedModelClient(
        lambda s, u: answer(s, u, verifier=lambda f: {"judgement": "unclear", "detail": "?"})
    )
    flow = build(match, unclear)
    run(flow.ingest(match["events"]))
    assert any(ln.status == "review" for ln in flow.store.lines(flow.sk))


def test_a_model_outage_falls_back_to_rules_and_is_audited(match, monkeypatch) -> None:
    monkeypatch.setenv("MATCHCAST_LIVE_MAX_PRIORITY", "3")  # every moment goes to the model

    def down(system, user):
        return ModelTimeout()

    flow = build(match, ScriptedModelClient(down))
    run(flow.ingest(match["events"]))
    assert flow.status == "rules_fallback"
    assert "fallback_used" in actions(flow)
    lines = flow.store.lines(flow.sk)
    assert lines and all(ln.origin == "template" for ln in lines)


def test_unknown_metrics_from_the_analyst_are_not_trusted(match) -> None:
    flow = build(
        match,
        ScriptedModelClient(
            lambda s, u: answer(s, u, analyst=lambda f: {"metrics": ["vibes:home"]})
        ),
    )
    run(flow.ingest(match["events"]))
    reasons = [r["details"].get("fallback_reason") for r in flow.store.audit_records(flow.sk)]
    assert "model_error" in reasons
    assert all(c["packet"]["metric"] != "vibes:home" for c in flow.store.claims(flow.sk))


def test_malformed_narrator_output_is_a_model_error(match) -> None:
    client = ScriptedModelClient(
        lambda s, u: answer(s, u, narrator=lambda f: {"lines": [{"persona": "poet", "text": "x"}]})
    )
    flow = build(match, client)
    run(flow.ingest(match["events"]))
    assert "fallback_used" in actions(flow) and ModelError.__name__


class FakeCompletions:
    def __init__(self, outcome):
        self.outcome = outcome

    async def create(self, **kwargs):
        if isinstance(self.outcome, Exception):
            raise self.outcome
        self.kwargs = kwargs
        return self.outcome


def fake_openai(outcome):
    from types import SimpleNamespace

    completions = FakeCompletions(outcome)
    return SimpleNamespace(chat=SimpleNamespace(completions=completions)), completions


def message(content: str, finish_reason: str = "stop"):
    from types import SimpleNamespace

    usage = SimpleNamespace(prompt_tokens=11, completion_tokens=7)
    choice = SimpleNamespace(message=SimpleNamespace(content=content), finish_reason=finish_reason)
    return SimpleNamespace(choices=[choice], usage=usage)


def test_foundry_client_sends_a_json_schema_and_counts_tokens() -> None:
    from matchcast_agents.live import FoundryModelClient

    fake, completions = fake_openai(message('{"metrics": ["goals:home"]}'))
    client = FoundryModelClient(deployment="gpt-6-luna", client=fake)
    result = run(client.complete("sys", "user", {"type": "object"}))
    assert result == {"metrics": ["goals:home"]}
    assert completions.kwargs["model"] == "gpt-6-luna"
    assert completions.kwargs["response_format"]["json_schema"]["strict"] is True
    assert (client.usage.calls, client.usage.prompt_tokens, client.usage.completion_tokens) == (
        1,
        11,
        7,
    )


def test_foundry_client_sends_the_reasoning_model_parameters() -> None:
    from matchcast_agents.live import FoundryModelClient
    from matchcast_agents.live.client import REASONING_HEADROOM

    fake, completions = fake_openai(message("{}"))
    client = FoundryModelClient(deployment="gpt-5-mini", client=fake)
    run(client.complete("sys", "user", {"type": "object"}, temperature=0.6, max_tokens=400))
    sent = completions.kwargs
    assert sent["max_completion_tokens"] == 400 + REASONING_HEADROOM >= 1500
    assert "max_tokens" not in sent and "temperature" not in sent  # gpt-5-mini rejects both
    assert sent["reasoning_effort"] == "low"


def test_a_reasoning_run_that_hits_the_budget_is_its_own_error() -> None:
    import pytest
    from matchcast_agents.live import FoundryModelClient

    fake, _ = fake_openai(message("", finish_reason="length"))
    with pytest.raises(ModelError, match="budget"):
        run(FoundryModelClient(deployment="gpt-5-mini", client=fake).complete("s", "u", {}))


def test_foundry_client_maps_failures_to_the_resilience_vocabulary() -> None:
    import pytest
    from matchcast_agents.live import FoundryModelClient
    from matchcast_agents.resilience import ModelRateLimited

    class RateLimitError(Exception):
        response = type("R", (), {"headers": {"retry-after": "3"}})()

    class APITimeoutError(Exception):
        pass

    for failure, expected in (
        (RateLimitError("429"), ModelRateLimited),
        (APITimeoutError("slow"), ModelTimeout),
        (RuntimeError("500"), ModelError),
    ):
        fake, _ = fake_openai(failure)
        with pytest.raises(expected):
            run(FoundryModelClient(client=fake).complete("s", "u", {}))
    fake, _ = fake_openai(message("not json"))
    with pytest.raises(ModelError):
        run(FoundryModelClient(client=fake).complete("s", "u", {}))


def test_quiet_moments_use_the_rules_and_skip_the_model(match, monkeypatch) -> None:
    def model_calls() -> int:
        client = ScriptedModelClient(lambda s, u: answer(s, u))
        run(build(match, client).ingest(match["events"]))
        return len(client.calls)

    default = model_calls()  # priority 1 only: goals and red cards
    monkeypatch.setenv("MATCHCAST_LIVE_MAX_PRIORITY", "3")
    assert default < model_calls()


def test_a_quiet_play_gets_one_verified_analyst_colour_line(match) -> None:
    seen: list[dict] = []

    def record(system, user):
        facts = json.loads(user)
        if facts.get("moment") == "colour" and "personas" in facts:
            seen.append(facts)
        return answer(system, user)

    flow = build(match, ScriptedModelClient(record))  # default gate: quiet plays stay on rules
    run(flow.ingest(match["events"]))
    assert len(seen) == 1  # the 45 s cap holds in a match that ingests in well under 45 s
    assert seen[0]["personas"] == ["analyst"] and seen[0]["play"] in ("shot", "tackle", "foul")
    assert seen[0]["claims"][0]["metric"].split(":")[0] in ("shots", "tackles_won", "fouls")
    colour = [ln for ln in flow.store.lines(flow.sk) if ln.line_id.endswith("-analyst-0")]
    lines = [ln for ln in colour if ln.origin == "model" and ln.persona == "analyst"]
    assert lines and all(ln.status == "published" for ln in lines if ln.persona == "analyst")


def test_the_verifier_is_told_the_moment_and_the_narrator_no_limits(match, monkeypatch) -> None:
    monkeypatch.setenv("MATCHCAST_LIVE_MAX_PRIORITY", "3")
    asked: dict[str, dict] = {}

    def record(system, user):
        facts = json.loads(user)
        kind = "narrator" if "personas" in facts else "verifier" if "line" in facts else "other"
        asked.setdefault(kind, facts)
        return answer(system, user)

    run(build(match, ScriptedModelClient(record)).ingest(match["events"]))
    assert "limits" not in asked["narrator"]  # the model echoed "140" and "280" into its lines
    assert asked["verifier"]["moment"]["play"]  # what happened, so a named player is supported


def test_colour_falls_back_to_a_rules_line_when_the_model_fails(match) -> None:
    class Down:
        async def complete(self, system, user, schema, **_):
            raise ModelError("down")

    flow = build(match, Down())
    run(flow.ingest(match["events"]))
    assert flow.store.lines(flow.sk) and all(
        ln.origin == "template" for ln in flow.store.lines(flow.sk)
    )


def test_a_moments_lines_are_checked_together_and_redrafted_once(match, monkeypatch) -> None:
    import asyncio

    monkeypatch.setenv("MATCHCAST_LIVE_MAX_PRIORITY", "3")

    class Probe:
        def __init__(self) -> None:
            self.live = self.peak = self.narrator = 0

        async def complete(self, system, user, schema, **_):
            out = answer(system, user)
            if "lines" in out:
                self.narrator += 1
                if self.narrator % 2:  # each first draft carries numbers no claim backs
                    out = {"lines": [{**r, "text": r["text"] + " 99 77"} for r in out["lines"]]}
                return out
            self.live += 1
            self.peak = max(self.peak, self.live)
            await asyncio.sleep(0)
            self.live -= 1
            return out

    probe = Probe()
    flow = build(match, probe)
    run(flow.ingest(match["events"]))
    assert probe.peak > 1  # the Verifier calls of one moment overlap
    assert flow.stats["repaired"] > flow.stats["moments"]  # more than one line repaired per moment
    assert probe.narrator <= 2 * flow.stats["moments"]  # a first draft and one shared redraft


def test_quiet_moments_are_audited_as_rules_not_live(match) -> None:
    flow = build(match, ScriptedModelClient(lambda s, u: answer(s, u)))
    run(flow.ingest(match["events"]))
    records = flow.store.audit_records(flow.sk)
    template = {ln.line_id for ln in flow.store.lines(flow.sk) if ln.origin == "template"}
    drafted = [r for r in records if r["action"] == "line_drafted" and r["subject_id"] in template]
    wrong = [
        r["subject_id"] + ":" + r["details"]["mode"]
        for r in drafted
        if r["details"]["mode"] != "rules"
    ]
    assert template and drafted and not wrong, wrong


def test_a_fallback_in_one_line_check_is_audited_against_that_line(match, monkeypatch) -> None:
    import asyncio

    monkeypatch.setenv("MATCHCAST_LIVE_MAX_PRIORITY", "3")

    class Flaky:
        async def complete(self, system, user, schema, **_):
            out = answer(system, user)
            if "lines" in out:
                return {
                    "lines": [{**r, "text": r["text"] + f" ({r['persona']})"} for r in out["lines"]]
                }
            await asyncio.sleep(0)
            if "(analyst)" in json.loads(user)["line"]:
                raise ModelError("verifier down for this line")
            return out

    flow = build(match, Flaky())
    run(flow.ingest(match["events"]))
    records = flow.store.audit_records(flow.sk)
    lines = {ln.line_id: ln for ln in flow.store.lines(flow.sk)}
    fell = [r for r in records if r["action"] == "fallback_used" and r["actor_id"] == "verifier"]
    assert fell and all(lines[r["subject_id"]].persona == "analyst" for r in fell)
    verified = [r for r in records if r["action"] in ("line_verified", "line_rejected")]
    for r in verified:
        expected = "rules" if lines[r["subject_id"]].persona == "analyst" else "live"
        assert r["details"]["mode"] == expected
