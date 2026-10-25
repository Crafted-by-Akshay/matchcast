"""Pre-match history from the martj42 results: real past results, cut at the match date."""

from datetime import date

from matchcast_agents.history import RESULTS, pre_match


def test_dataset_and_licence_are_in_the_repo() -> None:
    assert RESULTS.exists()
    assert (
        RESULTS.with_name("LICENSE-martj42.txt")
        .read_text()
        .startswith("Creative Commons Legal Code")
    )


def test_head_to_head_counts_both_orders_and_names_the_last_meeting() -> None:
    h = pre_match("England", "Scotland", on=date(2026, 10, 25))["h2h"]
    assert h["played"] > 100
    assert h["home_wins"] + h["draws"] + h["away_wins"] == h["played"]
    assert h["last_meeting"] is not None
    assert set(h["last_meeting"]) == {"date", "score", "competition"}


def test_results_after_the_match_date_are_not_used() -> None:
    before = pre_match("Brazil", "Argentina", on=date(1990, 1, 1))["h2h"]["played"]
    after = pre_match("Brazil", "Argentina", on=date(2026, 10, 25))["h2h"]["played"]
    assert 0 < before < after


def test_form_is_five_results_newest_first_from_each_side() -> None:
    form = pre_match("Spain", "Germany", on=date(2026, 10, 25))["recent_form"]
    assert len(form["home"]) == 5 and len(form["away"]) == 5
    assert set(form["home"]) <= {"W", "D", "L"}


def test_elo_is_a_rating_for_known_nations_and_none_for_unknown_ones() -> None:
    e = pre_match("Brazil", "Atlantis FC", on=date(2026, 10, 25))["elo"]
    assert 1500 < e["home"] < 2500
    assert e["away"] is None


def test_unknown_pair_has_no_history() -> None:
    p = pre_match("Atlantis FC", "Lemuria", on=date(2026, 10, 25))
    assert p["h2h"]["played"] == 0 and p["h2h"]["last_meeting"] is None
    assert p["recent_form"] == {"home": [], "away": []}


def test_for_match_is_none_for_fictional_clubs_and_set_for_national_teams() -> None:
    from matchcast_agents.history import for_match

    assert for_match("Harbor City", "Ridgeview", on=date(2026, 10, 25)) is None
    block = for_match("England", "Brazil", on=date(2026, 10, 25))
    assert block is not None and block["h2h"]["played"] > 0
