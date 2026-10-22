"""Data Scientist (AGT-14): a verified answer, a mismatch, and refused SQL."""

from pathlib import Path

import pytest
from matchcast_agents.data_scientist import ABSTAIN, UNVERIFIED, ask
from matchcast_mcp.season import Season, SeasonError


@pytest.fixture(scope="module")
def season() -> Season:
    return Season(Path(__file__).parents[3] / "data/season/v1")


def test_highest_average_xg_matches_the_season_data(season) -> None:
    answer = ask("which team has the highest average xG?", season)
    assert answer.verdict == "verified" and answer.chart_spec["mark"] == "bar"
    direct = season.query(
        "SELECT team_id, avg(xg) FROM team_match_stats GROUP BY team_id ORDER BY 2 DESC, 1 LIMIT 1"
    )["rows"][0]
    assert answer.rows[0][0] == direct[0] and answer.rows[0][1] == pytest.approx(
        direct[1], abs=5e-4
    )
    assert answer.chart_spec["data"]["values"][0] == {
        "team_id": answer.rows[0][0],
        "avg_xg": answer.rows[0][1],
    }
    assert direct[0] in answer.answer


def test_a_changed_number_replaces_the_answer(season) -> None:
    class Flaky:
        calls = 0

        def query(self, sql):
            result = season.query(sql)
            Flaky.calls += 1
            if Flaky.calls == 2:
                result["rows"][0][1] += 0.5
            return result

        def describe_views(self):
            return season.describe_views()

    answer = ask("which team has the highest average xG?", Flaky())
    assert answer.verdict == "rejected" and answer.answer == UNVERIFIED
    assert answer.chart_spec is None and answer.rows == [] and "0.5" in answer.mismatch


def test_questions_without_a_query_are_not_guessed(season) -> None:
    assert ask("what is the meaning of life", season).answer == ABSTAIN


@pytest.mark.parametrize(
    "sql",
    [
        "DROP TABLE matches",
        "SELECT 1; SELECT 2",
        "SELECT * FROM matches; DROP TABLE matches",
        "SELECT * FROM read_parquet('/etc/passwd')",
        "SELECT * FROM information_schema.tables",
        "SELECT current_setting('home_directory')",
        "COPY matches TO '/tmp/x.csv'",
    ],
)
def test_query_season_refuses_anything_but_one_select_on_the_views(season, sql) -> None:
    with pytest.raises(SeasonError):
        season.query(sql)


def test_rows_are_capped_and_views_are_described(season) -> None:
    assert len(season.query("SELECT * FROM player_match_stats")["rows"]) == 616
    assert {c["name"] for c in season.describe_views()["team_match_stats"]} >= {"xg", "shots"}
