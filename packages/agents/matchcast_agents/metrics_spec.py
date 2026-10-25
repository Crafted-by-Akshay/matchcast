"""What each claim metric is: its units and derivation version, one place for tools and Verifier."""

from .xg import VERSION as XG_VERSION

DERIVATION_VERSION = "1.0.0"
METRIC_UNITS = {
    "goals": "count",
    "shots": "count",
    "shots_on_target": "count",
    "tackles_won": "count",
    "fouls": "count",
    "cards": "count",
    "red_cards": "count",
    "passes": "count",
    "pressures": "count",
    "possession_won": "count",
    "xg": "ratio",
    "h2h_played": "count",  # pre-match history, see history.py
    "h2h_home_wins": "count",
    "h2h_draws": "count",
    "h2h_away_wins": "count",
    "elo": "count",
}
TOLERANCE = {"count": 0.0, "ratio": 0.01, "m": 0.5, "m/s": 0.5, "s": 0.5, "ms": 500.0}


def derivation_version(metric: str) -> str:
    return XG_VERSION if metric == "xg" else DERIVATION_VERSION
