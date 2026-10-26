"""Ask over the national-team results: routed, grounded and recounted from the results file."""

import csv
from datetime import date
from pathlib import Path
from types import SimpleNamespace

from matchcast_agents.ask import Bm25Index, load_kb
from matchcast_agents.ask import history_qa as qa
from matchcast_agents.ask.assistant import route
from matchcast_agents.history import RESULTS, pre_match

KB = Path(__file__).resolve().parents[3] / "kb"


def csv_rows() -> list[dict[str, str]]:
    with RESULTS.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def played_by(team: str, year: int) -> list[dict[str, str]]:
    """An independent read of the file: the matches a team played in a year, before today."""
    return [
        r
        for r in csv_rows()
        if team in (r["home_team"], r["away_team"])
        and r["date"].startswith(f"{year}-")
        and date.fromisoformat(r["date"]) < date.today()
    ]


def test_history_questions_are_routed_to_the_results_file() -> None:
    assert qa.parse("Argentina results in 2022") == qa.Query("record", "Argentina", None, 2022)
    assert qa.parse("Brazil's record v Germany") == qa.Query("record", "Brazil", "Germany", None)
    assert qa.parse("best team in 2026") == qa.Query("top", year=2026)
    assert qa.parse("Argentina results by year") == qa.Query("by_year", "Argentina")
    assert qa.parse("USA record v Mexico all-time").team == "United States"


def _side_result(r: dict[str, str], team: str) -> str:
    mine, theirs = (int(r["home_score"]), int(r["away_score"]))
    if r["away_team"] == team:
        mine, theirs = theirs, mine
    return "won" if mine > theirs else "lost" if mine < theirs else "drawn"


def test_multi_word_nations_are_history_and_not_out_of_scope() -> None:
    index = Bm25Index(load_kb(KB))
    ctx = SimpleNamespace(allowed_names=frozenset())
    for question in (
        "Costa Rica results in 2022",
        "Ivory Coast results in 2022",
        "South Korea record v Japan all-time",
    ):
        assert route(ctx, question, index).intent == "history", question


def test_a_scorer_or_outcome_question_with_a_year_is_still_a_match_question() -> None:
    assert qa.parse("Who scored for Argentina in 2026?") is None
    assert qa.parse("Argentina v Brazil score in 2026") is None
    assert qa.parse("Argentina v Brazil record in 2026") is not None
    assert qa.parse("How many goals did Argentina score in 2022?") == qa.Query(
        "record", "Argentina", None, 2022
    )


def test_match_questions() -> None:
    for question in (
        "How many shots does Argentina have so far?",
        "Who scored for Northgate FC?",
        "Argentina v Brazil score",
        "How many goals has Argentina scored so far in 2026?",
        "Which player has the most shots in 2026?",
        "Argentina shots in 2022",
    ):
        assert qa.parse(question) is None, question


def test_the_router_sends_history_ahead_of_the_name_check() -> None:
    index = Bm25Index(load_kb(KB))
    ctx = SimpleNamespace(allowed_names=frozenset())  # a history question reads no match
    assert route(ctx, "Argentina results in 2022", index).intent == "history"
    assert route(ctx, "Brazil's record v Germany", index).intent == "history"
    assert (
        route(ctx, "Did Lionel Messi score for Argentina in 2022?", index).intent == "out_of_scope"
    )


def test_a_year_of_results_counts_what_the_file_holds() -> None:
    text, abstained, citations, dropped = qa.answer("Argentina results in 2022")
    games = played_by("Argentina", 2022)
    won = sum(1 for r in games if _side_result(r, "Argentina") == "won")
    assert not abstained and dropped == 0
    assert f"Argentina played {len(games)} in 2022: {won} won" in text
    assert {c["type"] for c in citations} == {"history", "result"}


def test_head_to_head_agrees_with_the_history_block_the_analyst_reads() -> None:
    text, abstained, _, _ = qa.answer("Brazil's record v Germany")
    h2h = pre_match("Brazil", "Germany", on=date.today())["h2h"]
    assert not abstained
    assert f"have met {h2h['played']} times all-time" in text
    assert f"Brazil have won {h2h['home_wins']}" in text


def test_best_teams_in_a_year_are_teams_that_played_that_year_and_ranked_by_elo() -> None:
    text, abstained, citations, _ = qa.answer("best team in 2026")
    assert not abstained
    assert text.count("Elo") >= 5 and "First:" in text and "Fifth:" in text
    for place in ("First", "Second", "Third", "Fourth", "Fifth"):
        team = text.split(f"{place}: ", 1)[1].split(",", 1)[0]
        assert len(played_by(team, 2026)) >= qa.MIN_MATCHES_IN_YEAR, team


def test_a_year_with_no_results_abstains_instead_of_guessing() -> None:
    text, abstained, citations, _ = qa.answer("Argentina in 1873")
    assert abstained and citations == [] and text == qa.ABSTAIN


def test_every_sentence_must_cite_and_recount_its_numbers() -> None:
    games = played_by("Argentina", 2022)
    good = qa._answer_sentences(qa.Query("record", "Argentina", None, 2022))[0]
    assert qa.verified(good)
    assert not qa.verified(good.replace(f"played {len(games)}", "played 99"))  # a wrong count
    assert not qa.verified("Argentina played 16 in 2022.")  # no citation
    assert not qa.verified("Argentina played 16 in 2022. [result:999999999]")  # no such row
    assert not qa.verified("Argentina played 16 in 2022. [history:elo|2022|Atlantis]")  # no team


def test_a_result_sentence_recounts_its_date_and_scores_from_its_row() -> None:
    rows = list(enumerate(csv_rows(), start=1))
    number = next(i for i, r in rows if r["home_team"] == "Argentina" and r["date"] == "2022-12-18")
    line = f"18 Dec 2022: Argentina 3-3 France, International competition. [result:{number}]"
    assert qa.verified(line)
    assert not qa.verified(line.replace("3-3", "3-2"))


def test_federation_names_do_not_reach_the_answers() -> None:
    for question in ("Argentina results in 2022", "best team in 2026", "Argentina in 1930"):
        text, _, _, _ = qa.answer(question)
        assert "FIFA" not in text and "UEFA" not in text, question
