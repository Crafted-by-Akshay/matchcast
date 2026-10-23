"""The live comparison harness runs end to end over a stand-in model client (no Azure call)."""

import json
import sys
from pathlib import Path

import pytest
from matchcast_agents.live.client import Usage
from matchcast_agents.resilience import ModelError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "eval"))
import compare  # noqa: E402


class StandIn:
    """Answers the single-agent prompt from its facts; every agent call fails, so the four-agent
    live arm falls back to its rules twins (what a throttled deployment would do)."""

    def __init__(self) -> None:
        self.usage = Usage()

    async def complete(self, system, user, schema, **_kw):
        self.usage.calls += 1
        self.usage.prompt_tokens += 10
        if "line" not in schema.get("properties", {}):
            raise ModelError("stand-in refuses agent calls")
        return {"line": compare.FakeModel(0, 0.0)(user)}


def test_compare_live_reports_three_arms_and_token_usage(monkeypatch) -> None:
    monkeypatch.setattr("matchcast_agents.live.client.FoundryModelClient", StandIn)
    out = compare.compare_live(runs=1)
    assert set(out["arms"]) == {"four_agent_rules", "four_agent_live", "single_agent_live"}
    assert out["arms"]["single_agent_live"]["wrong_line_rate"]["mean"] == 0.0
    assert out["usage"]["single_agent_live"]["calls"] > 0 and out["single_model"]
    # the stand-in fails every agent call: all four-agent lines are rules fallbacks, and it says so
    assert out["four_agent_live_fallbacks"] > 0 and "fallbacks" in out["warning"]
    json.dumps(out)


def test_live_flag_needs_the_foundry_endpoint(monkeypatch) -> None:
    monkeypatch.delenv("FOUNDRY_PROJECT_ENDPOINT", raising=False)
    monkeypatch.setattr(sys, "argv", ["compare.py", "--live"])
    with pytest.raises(SystemExit, match="FOUNDRY_PROJECT_ENDPOINT"):
        compare.main()


def test_a_failing_single_agent_call_is_counted_not_fatal(monkeypatch) -> None:
    class Failing(StandIn):
        async def complete(self, system, user, schema, **kw):
            if "line" in schema.get("properties", {}):
                raise ModelError("429")
            return await super().complete(system, user, schema, **kw)

    monkeypatch.setattr("matchcast_agents.live.client.FoundryModelClient", Failing)
    out = compare.compare_live(runs=1)
    assert out["single_agent_errors"] > 0 and "single-agent calls failed" in out["warning"]


def test_the_foundry_client_rebinds_to_each_event_loop(monkeypatch) -> None:
    import asyncio

    from matchcast_agents.live.client import FoundryModelClient

    built = []

    class Fake:
        def __init__(self) -> None:
            built.append(self)
            self.chat = type("C", (), {"completions": self})()

        async def create(self, **_kw):
            msg = type("M", (), {"content": "{}"})()
            return type("R", (), {"usage": None, "choices": [type("X", (), {"message": msg})()]})()

    monkeypatch.setattr(FoundryModelClient, "_build", staticmethod(lambda endpoint: Fake()))
    client = FoundryModelClient("https://x.invalid")
    for _ in range(3):
        asyncio.run(client.complete("s", "u", {"type": "object"}))
    assert len(built) == 3  # one at start, rebuilt for the 2nd and 3rd asyncio.run
