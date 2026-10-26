"""The live (model) Narrator is told the storyline payoff for the goal that cites it (CREW-3.2)."""

import contextlib
import json

from conftest import run
from matchcast_agents.context import MatchContext
from matchcast_agents.live.narrator import LiveNarrator
from matchcast_agents.messages import ProducerTask
from matchcast_agents.resilience import ModelError
from matchcast_agents.state import MatchState


def _goal(match) -> dict:
    return next(e for e in match["events"] if e["payload"]["type"] == "goal")


def _ctx(match, extra) -> MatchContext:
    events = tuple(match["events"])
    state = MatchState(max_sequence=max(e["stream_sequence"] for e in events))
    return MatchContext(
        stream=match["roster"]["stream"],
        roster=match["roster"],
        names=match["names"],
        clubs=match["teams"],
        state=state,
        events=events,
        extra=extra,
    )


def _task(goal) -> ProducerTask:
    return ProducerTask(
        moment_id=f"m-{goal['event_id']}",
        match_id=goal.get("stream", {}).get("match_id", "match"),
        event_ids=(goal["event_id"],),
        up_to_sequence=goal["stream_sequence"],
        priority=1,
        personas=("analyst",),
        reason="goal",
        routed_by="rules",
    )


class Recording:
    def __init__(self) -> None:
        self.facts: list[dict] = []

    async def complete(self, system, user, schema, **_):
        self.facts.append(json.loads(user))
        return {"lines": []}


def test_the_goal_that_pays_a_storyline_off_tells_the_live_narrator(match) -> None:
    goal = _goal(match)
    paying = {"payoff": {"cites": [1, goal["stream_sequence"]]}}
    client = Recording()
    with contextlib.suppress(ModelError):  # the model answers nothing: the facts are what is tested
        run(LiveNarrator(client).write(_ctx(match, paying), _task(goal), claims=[]))
    assert "storyline" in client.facts[0]["storyline_payoff"]


def test_a_goal_that_pays_nothing_says_nothing_of_a_storyline(match) -> None:
    goal = _goal(match)
    client = Recording()
    with contextlib.suppress(ModelError):
        run(LiveNarrator(client).write(_ctx(match, {}), _task(goal), claims=[]))
    assert "storyline_payoff" not in client.facts[0]


def test_a_payoff_for_another_goal_says_nothing_of_a_storyline(match) -> None:
    goal = _goal(match)
    other = {"payoff": {"cites": [1, goal["stream_sequence"] + 1]}}
    client = Recording()
    with contextlib.suppress(ModelError):
        run(LiveNarrator(client).write(_ctx(match, other), _task(goal), claims=[]))
    assert "storyline_payoff" not in client.facts[0]
