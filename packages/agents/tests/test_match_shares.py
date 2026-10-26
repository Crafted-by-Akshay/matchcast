"""Match-to-date possession share the Analyst cites and the Verifier recounts (AB#373)."""

from matchcast_agents.match_shares import possession_share, recount


def ev(seq: int, payload: dict) -> dict:
    return {
        "stream_sequence": seq,
        "event_id": f"e{seq}",
        "event_time_ms": seq * 1000,
        "payload": payload,
    }


PASS_HOME = {
    "type": "pass",
    "team_id": "home",
    "player_id": "home1",
    "recipient_player_id": "home2",
}
PASS_AWAY = {
    "type": "pass",
    "team_id": "away",
    "player_id": "away1",
    "recipient_player_id": "away2",
}
CARRY_HOME = {"type": "carry", "team_id": "home", "player_id": "home2"}
TACKLE_WIN = {
    "type": "possession_change",
    "from_team_id": "home",
    "to_team_id": "away",
    "cause": "tackle",
}


def test_possession_share_is_the_team_s_percent_of_the_on_ball_actions_to_date() -> None:
    events = [ev(1, PASS_HOME), ev(2, CARRY_HOME), ev(3, PASS_HOME), ev(4, PASS_AWAY)]
    assert possession_share(events, "home", 10) == 75
    assert possession_share(events, "away", 10) == 25


def test_a_tackle_is_not_an_on_ball_action() -> None:
    events = [ev(1, PASS_HOME), ev(2, TACKLE_WIN), ev(3, PASS_AWAY)]
    assert possession_share(events, "home", 10) == 50


def test_recount_only_sees_events_up_to_the_claim() -> None:
    events = [ev(1, PASS_HOME), ev(2, PASS_AWAY), ev(3, PASS_HOME)]
    assert possession_share(events, "home", 2) == 50
    assert recount("possession_share:home", events, 3) == 67


def test_no_on_ball_action_means_no_share_rather_than_a_division_error() -> None:
    assert possession_share([], "home", 10) == 0
