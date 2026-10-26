"""Match-to-date shares the Analyst cites and the Verifier recounts (AB#373)."""

from matchcast_agents.match_shares import pass_accuracy, possession_share, recount


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
LOSS_HOME = {
    "type": "possession_change",
    "from_team_id": "home",
    "to_team_id": "away",
    "cause": "loose_ball",
}
TACKLE_WIN = {
    "type": "possession_change",
    "from_team_id": "home",
    "to_team_id": "away",
    "cause": "tackle",
}


def test_pass_accuracy_is_completed_passes_over_completed_plus_lost_on_a_pass() -> None:
    events = [
        ev(1, PASS_HOME),
        ev(2, PASS_HOME),
        ev(3, LOSS_HOME),
        ev(4, PASS_AWAY),
        ev(5, TACKLE_WIN),  # a tackle is not a failed pass, so it does not count against home
    ]
    assert pass_accuracy(events, "home", 10) == 67  # 2 completed, 1 lost
    assert pass_accuracy(events, "away", 10) == 100


def test_possession_share_is_the_team_s_percent_of_the_on_ball_actions_to_date() -> None:
    events = [ev(1, PASS_HOME), ev(2, CARRY_HOME), ev(3, PASS_HOME), ev(4, PASS_AWAY)]
    assert possession_share(events, "home", 10) == 75
    assert possession_share(events, "away", 10) == 25


def test_recount_only_sees_events_up_to_the_claim() -> None:
    events = [ev(1, PASS_HOME), ev(2, PASS_HOME), ev(3, LOSS_HOME)]
    assert pass_accuracy(events, "home", 2) == 100
    assert recount("pass_accuracy:home", events, 3) == 67
    assert recount("possession_share:home", events, 2) == 100


def test_no_passes_means_no_share_rather_than_a_division_error() -> None:
    assert pass_accuracy([], "home", 10) == 0
    assert possession_share([], "home", 10) == 0
