"""Booth moments: kick-off opens the booth, a quiet spell gets a filler, booth viewers only."""

from conftest import run
from matchcast_agents.context import MatchContext
from matchcast_agents.live import LiveProducer, ScriptedModelClient
from matchcast_agents.messages import ProducerTask, Skip
from matchcast_agents.personas import BOOTH
from matchcast_agents.rules import ProducerRules
from matchcast_agents.state import MatchState


def ctx(match, *, booth: bool = True) -> MatchContext:
    return MatchContext(
        match["roster"]["stream"],
        match["roster"],
        match["names"],
        match["teams"],
        MatchState(),
        (),
        extra={"booth": True} if booth else {},
    )


def event(match, kind: str):
    return next(e for e in match["events"] if e["payload"]["type"] == kind)


def test_kick_off_opens_the_booth_with_buildup(match) -> None:
    task = run(ProducerRules().decide(ctx(match), match["events"][0]))
    assert isinstance(task, ProducerTask) and task.reason == "buildup"
    assert task.priority == 3 and task.personas == BOOTH


def test_no_booth_moments_without_the_booth(match) -> None:
    first = run(ProducerRules().decide(ctx(match, booth=False), match["events"][0]))
    assert not (isinstance(first, ProducerTask) and first.reason == "buildup")


def test_a_quiet_spell_gets_one_filler_after_twenty_seconds(match) -> None:
    now = [0.0]
    producer = ProducerRules(clock=lambda: now[0])
    opening = run(producer.decide(ctx(match), match["events"][0]))
    assert isinstance(opening, ProducerTask) and opening.reason == "buildup"
    quiet = dict(event(match, "pass"), event_time_ms=120_000)
    now[0] = 10.0  # ten seconds of silence is not yet a quiet spell
    assert isinstance(run(producer.decide(ctx(match), dict(quiet, event_id="q1"))), Skip)
    now[0] = 25.0
    filler = run(producer.decide(ctx(match), dict(quiet, event_id="q2", event_time_ms=130_000)))
    assert isinstance(filler, ProducerTask) and filler.reason == "filler"
    assert filler.personas == BOOTH
    # a filler restarts the silence: the next quiet play waits another twenty seconds
    again = dict(quiet, event_id="q3", event_time_ms=140_000)
    assert isinstance(run(producer.decide(ctx(match), again)), Skip)


def test_booth_moments_skip_the_model(match) -> None:
    client = ScriptedModelClient([])
    task = run(LiveProducer(client, ProducerRules()).decide(ctx(match), match["events"][0]))
    assert isinstance(task, ProducerTask) and task.reason == "buildup"
    assert client.calls == []
