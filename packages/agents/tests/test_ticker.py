"""The data-only news ticker (CREW-7.5, AB#471): one line per verified goal or card."""

import copy

from matchcast_agents.context import MatchContext
from matchcast_agents.state import MatchState, apply
from matchcast_agents.ticker import TEMPLATES, ticker_items


def ctx(match, events=None) -> MatchContext:
    return MatchContext(
        match["roster"]["stream"],
        match["roster"],
        match["names"],
        match["teams"],
        MatchState(),
        tuple(match["events"] if events is None else events),
    )


def only(match, kind: str, **where) -> dict:
    return next(
        e
        for e in match["events"]
        if e["payload"]["type"] == kind and all(e["payload"].get(k) == v for k, v in where.items())
    )


def item_for(items, event_id: str):
    return next(i for i in items if i.source_event_id == event_id)


def test_a_goal_names_the_scorer_and_the_running_score(match) -> None:
    goal = only(match, "goal", own_goal=False)
    assert match["teams"][goal["payload"]["team_id"]] == "Harbour United"
    item = item_for(ticker_items(ctx(match)), goal["event_id"])
    assert item.kind == "goal"
    assert item.text == (
        f"Goal: {match['names'][goal['payload']['player_id']]} for Harbour United. "
        "Northgate FC 0-1 Harbour United"
    )
    assert item.minute == 1


def test_a_red_card_names_the_player_and_never_the_engine_reason(match) -> None:
    card = only(match, "card", colour="red")
    item = item_for(ticker_items(ctx(match)), card["event_id"])
    assert item.kind == "red"
    assert item.text == (
        f"Red card: {match['names'][card['payload']['player_id']]} "
        f"({match['teams'][card['payload']['team_id']]})."
    )
    assert card["payload"]["reason"] not in item.text


def test_an_own_goal_names_no_player(match) -> None:
    own = copy.deepcopy(only(match, "goal", own_goal=False))
    own.update(event_id="og1", stream_sequence=9999, event_time_ms=3_000_000)
    own["payload"]["own_goal"] = True
    item = item_for(ticker_items(ctx(match, [*match["events"], own])), "og1")
    assert item.kind == "own_goal"
    assert item.text.startswith("Own goal, credited to Harbour United. ")
    assert match["names"][own["payload"]["player_id"]] not in item.text


def test_only_goals_and_cards_make_items_and_each_cites_a_real_event(match) -> None:
    items = ticker_items(ctx(match))
    kinds = {e["event_id"]: e["payload"]["type"] for e in match["events"]}
    assert items
    for item in items:
        assert item.kind in TEMPLATES
        assert kinds[item.source_event_id] in ("goal", "card")


def test_the_last_score_matches_the_state_rule(match) -> None:
    goals = [i for i in ticker_items(ctx(match)) if i.kind in ("goal", "own_goal")]
    state = MatchState()
    for event in match["events"]:
        state = apply(state, event)
    home, away = match["teams"]["home"], match["teams"]["away"]
    assert goals[-1].text.endswith(
        f"{home} {state.score.get('home', 0)}-{state.score.get('away', 0)} {away}"
    )


def test_a_cut_leaves_out_what_comes_after_it(match) -> None:
    upto = 10
    expected = [
        e["event_id"]
        for e in match["events"]
        if e["payload"]["type"] in ("goal", "card") and e["stream_sequence"] <= upto
    ]
    items = ticker_items(ctx(match), upto_sequence=upto)
    assert [i.source_event_id for i in items] == expected
    assert expected  # the cut keeps the first goal, so the check is not vacuous


def test_a_retracted_goal_leaves_the_ticker_and_the_score(match) -> None:
    goal = only(match, "goal", own_goal=False)
    retraction = {
        "event_id": "r1",
        "stream_sequence": 9998,
        "event_time_ms": 3_000_000,
        "clock": {"period": 2, "period_elapsed_ms": 0},
        "payload": {"type": "retraction", "target_event_id": goal["event_id"]},
    }
    items = ticker_items(ctx(match, [*match["events"], retraction]))
    assert goal["event_id"] not in [i.source_event_id for i in items]
    # with e10 retracted, the fixture's e35 and e58 read 0-1 and 1-1, not 0-2 and 1-2
    assert item_for(items, "e35").text.endswith("Northgate FC 0-1 Harbour United")
    assert item_for(items, "e58").text.endswith("Northgate FC 1-1 Harbour United")


def test_a_correction_to_a_card_holds_it_off_the_ticker(match) -> None:
    card = only(match, "card", colour="red")
    correction = {
        "event_id": "c1",
        "stream_sequence": 9998,
        "event_time_ms": 3_000_000,
        "clock": {"period": 2, "period_elapsed_ms": 0},
        "payload": {"type": "correction", "target_event_id": card["event_id"]},
    }
    items = ticker_items(ctx(match, [*match["events"], correction]))
    assert card["event_id"] not in [i.source_event_id for i in items]
