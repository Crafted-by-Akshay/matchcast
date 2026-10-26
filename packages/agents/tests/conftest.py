import asyncio
import itertools
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents.rules import ProducerRules

FIXTURE = Path(__file__).parent / "fixtures" / "match-short.json"


@pytest.fixture(scope="session")
def match() -> dict:
    return json.loads(FIXTURE.read_text())


def fixed_clock():
    """A deterministic clock: each call is 10 ms later than the last."""
    state = {"now": datetime(2026, 10, 22, 12, 0, 0, tzinfo=UTC)}

    def tick() -> datetime:
        state["now"] += timedelta(milliseconds=10)
        return state["now"]

    return tick


def colour_producer(personas):
    """A rules Producer whose colour cadence is always due, so the booth's colour line is written
    (the default rules cadence is off: colour lines cost a model call in live mode)."""
    return ProducerRules(personas, colour_every_s=1.0, clock=itertools.count(0, 10).__next__)


@pytest.fixture
def make_workflow(match):
    def build(
        *,
        approval_mode: str = "auto",
        seed_bad_claim: bool = False,
        personas=None,
        stall_clock=None,
    ) -> MatchWorkflow:
        config = WorkflowConfig(
            approval_mode=approval_mode, **({"personas": personas} if personas else {})
        )
        return MatchWorkflow(
            stream=match["roster"]["stream"],
            roster=match["roster"],
            names=match["names"],
            clubs=match["teams"],
            agents=rules_agents(
                config.personas, seed_bad_claim=seed_bad_claim, seed_bad_claim_at_ms=0
            ),
            config=config,
            clock=fixed_clock(),
            # a fixed clock: no test replans on real wall time (tests that want a stall pass one)
            stall_clock=stall_clock or (lambda: 0.0),
        )

    return build


def run(coro):
    return asyncio.run(coro)
