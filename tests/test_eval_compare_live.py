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
    assert out["arms"]["four_agent_live"]["coverage"] == out["arms"]["four_agent_rules"]["coverage"]
    assert out["usage"]["calls"] > 0 and out["single_model"]
    json.dumps(out)


def test_live_flag_needs_the_foundry_endpoint(monkeypatch) -> None:
    monkeypatch.delenv("FOUNDRY_PROJECT_ENDPOINT", raising=False)
    monkeypatch.setattr(sys, "argv", ["compare.py", "--live"])
    with pytest.raises(SystemExit, match="FOUNDRY_PROJECT_ENDPOINT"):
        compare.main()
