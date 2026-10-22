"""Deterministic checks 1 to 5 in isolation."""

import copy

from conftest import run
from matchcast_agents.context import MatchContext
from matchcast_agents.messages import DraftLine
from matchcast_agents.rules import VerifierRules
from matchcast_agents.state import MatchState, apply
from matchcast_agents.verify import extract_names, extract_numbers


def context(match, upto: int = 40) -> MatchContext:
    events = tuple(match["events"][:upto])
    state = MatchState()
    for event in events:
        state = apply(state, event)
    return MatchContext(
        match["roster"]["stream"], match["roster"], match["names"], match["teams"], state, events
    )


def claim(ctx: MatchContext, metric: str, value: int) -> dict:
    snap = ctx.state.snapshot()
    return {
        "kind": "claim",
        "schema_version": "1.1.0",
        "stream": ctx.stream,
        "claim_id": "c1",
        "source": {
            "type": "interval",
            "from_event_time_ms": 0,
            "to_event_time_ms": snap["event_time_ms"],
            "from_stream_sequence": 1,
            "to_stream_sequence": snap["max_evidence_sequence"],
        },
        "metric": metric,
        "value": value,
        "units": "count",
        "derivation_version": "1.0.0",
        "snapshot": snap,
        "max_evidence_sequence": snap["max_evidence_sequence"],
        "approval_status": "pending",
    }


def line(
    text: str, persona: str = "analyst", limit: int = 240, origin: str = "template"
) -> DraftLine:
    return DraftLine(
        line_id="l1", claim_ids=("c1",), persona=persona, text=text, max_chars=limit, origin=origin
    )  # type: ignore[arg-type]


def verdict(ctx, draft, claims):
    return run(VerifierRules().check(ctx, draft, claims))


def test_correct_line_is_verified(match) -> None:
    ctx = context(match)
    shots = ctx.state.count("shots", "home")
    result = verdict(ctx, line(f"Northgate FC shots: {shots}."), [claim(ctx, "shots:home", shots)])
    assert result.verdict == "verified" and all(c.passed for c in result.checks)


def test_claim_value_is_recomputed_from_the_log(match) -> None:
    ctx = context(match)
    wrong = ctx.state.count("shots", "home") + 1
    result = verdict(ctx, line(f"Northgate FC shots: {wrong}."), [claim(ctx, "shots:home", wrong)])
    assert (result.verdict, result.reason_code) == ("rejected", "number_mismatch")


def test_number_missing_from_claims_is_rejected(match) -> None:
    ctx = context(match)
    shots = ctx.state.count("shots", "home")
    result = verdict(
        ctx, line(f"Northgate FC shots: {shots}, a record 77."), [claim(ctx, "shots:home", shots)]
    )
    assert result.reason_code == "number_mismatch"


def test_unknown_player_name_is_rejected(match) -> None:
    ctx = context(match)
    shots = ctx.state.count("shots", "home")
    result = verdict(ctx, line(f"Zed Quill has {shots} shots."), [claim(ctx, "shots:home", shots)])
    assert result.reason_code == "unknown_player"


def test_persona_limits(match) -> None:
    ctx = context(match)
    shots = ctx.state.count("shots", "home")
    claims = [claim(ctx, "shots:home", shots)]
    long = verdict(ctx, line("Northgate FC " + "keep going " * 30, limit=100), claims)
    assert long.reason_code == "length_exceeded"
    two = verdict(ctx, line(f"{shots} and {shots}.", persona="casual", limit=140), claims)
    assert two.reason_code == "length_exceeded"


def test_future_or_missing_source_is_rejected(match) -> None:
    ctx = context(match)
    bad = copy.deepcopy(claim(ctx, "shots:home", 0))
    bad["source"]["to_stream_sequence"] = 9999
    bad["max_evidence_sequence"] = 9999
    bad["snapshot"]["max_evidence_sequence"] = 9999
    result = verdict(ctx, line("Northgate FC shots: 0."), [bad])
    assert result.reason_code == "unknown_source"


def test_old_claim_is_stale(match) -> None:
    old = context(match, upto=10)
    stale = claim(old, "shots:home", old.state.count("shots", "home"))
    later = context(match, upto=60)
    result = verdict(later, line(f"Northgate FC shots: {int(stale['value'])}."), [stale])
    assert result.reason_code == "stale_state"


def test_model_written_line_needs_review_not_verification(match) -> None:
    ctx = context(match)
    shots = ctx.state.count("shots", "home")
    result = verdict(
        ctx,
        line(f"Northgate FC shots: {shots}.", origin="model"),
        [claim(ctx, "shots:home", shots)],
    )
    assert result.verdict == "review"


def test_extractors() -> None:
    assert extract_numbers("Score 2-1 after 3.5 xG, id a4 and 90th") == [2.0, 1.0, 3.5]
    assert extract_names("Arlo Dunne (Northgate FC) booked. Goal: Hugo Kerr.") == [
        "Arlo Dunne",
        "Northgate FC",
        "Hugo Kerr",
    ]


def test_xg_claim_is_recomputed_from_shot_positions(match) -> None:
    from matchcast_agents.xg import team_xg

    ctx = context(match)
    top = ctx.state.max_sequence
    value = team_xg(ctx.events, "home", top, ctx.home)
    assert 0 < value < ctx.state.count("shots", "home")  # xG per shot is well under 1
    good = claim(ctx, "xg:home", value) | {"units": "ratio"}
    ok = verdict(ctx, line(f"Northgate FC xG: {value:.2f}."), [good])
    assert ok.verdict == "verified"
    bad = claim(ctx, "xg:home", value + 0.5) | {"units": "ratio"}
    wrong = verdict(ctx, line(f"Northgate FC xG: {value + 0.5:.2f}."), [bad])
    assert (wrong.verdict, wrong.reason_code) == ("rejected", "number_mismatch")
