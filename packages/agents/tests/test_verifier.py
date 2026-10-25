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


def test_possessives_and_sentence_openers_keep_roster_names_valid(match) -> None:
    ctx = context(match)
    shots = ctx.state.count("shots", "home")
    claims = [claim(ctx, "shots:home", shots)]
    for text in (
        f"Northgate FC's shots: {shots}.",
        f"Northgate FC’s shots: {shots}.",
        f"Strong Northgate FC pressure, shots: {shots}.",
    ):
        assert verdict(ctx, line(text), claims).verdict == "verified", text
    for text in ("Ben Northgate FC lead.", "Zed Arlo Dunne scores.", "Nobody Northgate FC"):
        assert verdict(ctx, line(text), claims).reason_code == "unknown_player", text
    # a made-up player is still caught in a possessive, and after the opener
    for text in (f"Zed Quill's shots: {shots}.", f"Strong Zed Quill shots: {shots}."):
        assert verdict(ctx, line(text), claims).reason_code == "unknown_player", text


def test_persona_limits(match) -> None:
    ctx = context(match)
    shots = ctx.state.count("shots", "home")
    claims = [claim(ctx, "shots:home", shots)]
    long = verdict(ctx, line("Northgate FC " + "keep going " * 30, limit=100), claims)
    assert long.reason_code == "length_exceeded"
    away = ctx.state.count("shots", "away")
    both = [*claims, claim(ctx, "shots:away", away)]
    two = verdict(ctx, line(f"{shots} and {away}.", persona="casual", limit=140), both)
    assert two.reason_code == "length_exceeded"


def test_one_claim_cannot_back_a_number_twice(match) -> None:
    ctx = context(match)
    shots = ctx.state.count("shots", "home")
    claims = [claim(ctx, "shots:home", shots)]
    result = verdict(ctx, line(f"Northgate FC {shots}, then {shots} again.", limit=140), claims)
    assert result.reason_code == "number_mismatch"


def test_a_score_with_one_side_wrong_is_refused_when_the_wrong_side_equals_the_other(match) -> None:
    ctx = context(match)
    home, away = ctx.state.count("goals", "home"), ctx.state.count("goals", "away")
    claims = [claim(ctx, "goals:home", home), claim(ctx, "goals:away", away)]
    assert verdict(ctx, line(f"Score {home}-{away}.", limit=140), claims).verdict == "verified"
    wrong = verdict(ctx, line(f"Score {away}-{away}.", limit=140), claims)
    assert home != away and wrong.reason_code == "number_mismatch"


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


def xg_claim(ctx, team: str, value: float) -> dict:
    return claim(ctx, f"xg:{team}", value) | {"units": "ratio"}


def xg_verdict(ctx, team: str, value: float, **override):
    packet = xg_claim(ctx, team, value) | override
    return verdict(ctx, line(f"Northgate FC xG: {value:.2f}."), [packet])


def test_xg_claim_is_recomputed_from_shot_positions(match) -> None:
    from matchcast_agents.xg import team_xg

    ctx = context(match)
    value = team_xg(ctx.events, "home", ctx.state.max_sequence)
    assert 0 < value < ctx.state.count("shots", "home")  # xG per shot is well under 1
    assert xg_verdict(ctx, "home", value).verdict == "verified"
    wrong = xg_verdict(ctx, "home", value + 0.5)
    assert (wrong.verdict, wrong.reason_code) == ("rejected", "number_mismatch")


def test_a_claim_cannot_choose_its_own_units_or_version(match) -> None:
    from matchcast_agents.xg import team_xg

    ctx = context(match)
    value = team_xg(ctx.events, "home", ctx.state.max_sequence)
    for units in ("ms", "m", "s"):  # a loose tolerance must not rescue a wrong number
        assert xg_verdict(ctx, "home", value + 9, units=units).reason_code == "number_mismatch"
        shots = ctx.state.count("shots", "home") + 7
        spoofed = claim(ctx, "shots:home", shots) | {"units": units}
        assert verdict(ctx, line(f"Northgate FC shots: {shots}."), [spoofed]).verdict == "rejected"
    assert xg_verdict(ctx, "home", value, derivation_version="9.9.9").verdict == "rejected"


def test_xg_for_the_wrong_team_and_a_late_shot_are_rejected(match) -> None:
    from matchcast_agents.xg import team_xg

    ctx = context(match)
    top = ctx.state.max_sequence
    away = team_xg(ctx.events, "away", top)
    home = team_xg(ctx.events, "home", top)
    assert away != home
    assert xg_verdict(ctx, "home", away).reason_code == "number_mismatch"
    first_shot = next(e for e in ctx.events if e["payload"]["type"] == "shot")
    early = team_xg(ctx.events, first_shot["payload"]["team_id"], first_shot["stream_sequence"] - 1)
    late = team_xg(ctx.events, first_shot["payload"]["team_id"], top)
    assert early < late
    stale = xg_claim(ctx, first_shot["payload"]["team_id"], late) | {
        "max_evidence_sequence": first_shot["stream_sequence"] - 1
    }
    assert verdict(ctx, line(f"xG: {late:.2f}."), [stale]).verdict == "rejected"


def test_xg_tolerance_is_one_hundredth_with_float_noise_allowed(match) -> None:
    from matchcast_agents.xg import team_xg

    ctx = context(match)
    value = team_xg(ctx.events, "home", ctx.state.max_sequence)
    assert xg_verdict(ctx, "home", round(value + 0.01, 2)).verdict == "verified"
    assert xg_verdict(ctx, "home", round(value + 0.02, 2)).verdict == "rejected"


def test_xg_is_direction_free_so_second_half_shots_count_fully() -> None:
    from matchcast_agents.xg import team_xg

    def shot(seq: int, period: int, x: float) -> dict:
        position = {"x": x, "y": 34.0, "z": 0}
        payload = {"type": "shot", "team_id": "home", "position": position, "on_target": True}
        return {"stream_sequence": seq, "clock": {"period": period}, "payload": payload}

    first = team_xg([shot(1, 1, 90.0)], "home", 1)
    second = team_xg([shot(1, 2, 15.0)], "home", 1)  # the same chance at the other end
    assert first == second and first > 0.05


def test_a_player_must_be_one_the_moments_event_names(match) -> None:
    index = next(i for i, e in enumerate(match["events"]) if e["payload"]["type"] == "shot")
    ctx = context(match, upto=index + 1)
    payload = match["events"][index]["payload"]
    team, shooter = payload["team_id"], payload["player_id"]
    shots = ctx.state.count("shots", team)
    claims = [claim(ctx, f"shots:{team}", shots)]
    club = match["teams"][team]

    def text(player_id: str) -> str:
        return f"{club}: {match['names'][player_id]} shoots, shots {shots}."

    ok = verdict(ctx, line(text(shooter)), claims)
    assert ok.verdict == "verified"
    rival = next(p["player_id"] for p in ctx.roster["players"] if p["team_id"] != team)
    wrong = verdict(ctx, line(text(rival)), claims)
    assert (wrong.verdict, wrong.reason_code) == ("rejected", "unknown_player")
    assert "not on the team" in next(c.detail for c in wrong.checks if not c.passed)
    mate = next(
        p["player_id"]
        for p in ctx.roster["players"]
        if p["team_id"] == team and p["player_id"] != shooter
    )
    teammate = verdict(ctx, line(text(mate)), claims)  # right team, wrong player
    assert (teammate.verdict, teammate.reason_code) == ("rejected", "unknown_player")


def test_team_rule_leaves_summaries_period_ends_and_whole_names_alone(match) -> None:
    index = next(i for i, e in enumerate(match["events"]) if e["payload"]["type"] == "pass")
    ctx = context(match, upto=index + 1)
    team = match["events"][index]["payload"]["team_id"]
    rival = next(p["player_id"] for p in ctx.roster["players"] if p["team_id"] != team)
    shots = ctx.state.count("shots", team)
    claims = [claim(ctx, f"shots:{team}", shots)]
    text = f"{match['teams'][team]} shots {shots}; {match['names'][rival]} keeps them out."
    assert verdict(ctx, line(text), claims).verdict == "verified"  # a pass event: a summary moment

    longer = dict(match["names"], home1="Ben Coleman", away1="Ben Cole")
    shot = next(
        i
        for i, e in enumerate(match["events"])
        if e["payload"]["type"] == "shot" and e["payload"]["player_id"] == "home1"
    )
    base = context(match, upto=shot + 1)
    ctx2 = MatchContext(base.stream, base.roster, longer, base.clubs, base.state, base.events)
    n = ctx2.state.count("shots", "home")
    text = f"Northgate FC: Ben Coleman shoots, shots {n}."
    ok = verdict(ctx2, line(text), [claim(ctx2, "shots:home", n)])
    assert ok.verdict == "verified"  # "Ben Cole" (away) is not found inside "Ben Coleman"


HISTORY = {
    "h2h": {"played": 12, "home_wins": 5, "draws": 3, "away_wins": 4, "last_meeting": "2024-06-01"},
    "elo": {"home": 1843.4, "away": 1790.6},
    "recent_form": {"home": "WWDLW", "away": "LDWWL"},
}


def with_history(match):
    import dataclasses

    return dataclasses.replace(context(match), extra={"history": HISTORY})


def test_pre_match_history_claims_are_recounted_from_the_history(match) -> None:
    ctx = with_history(match)
    ok = [claim(ctx, "h2h_played:home", 12), claim(ctx, "elo:home", 1843)]
    ok[1]["claim_id"] = "c2"
    draft = DraftLine(
        line_id="l1", claim_ids=("c1", "c2"), persona="analyst", max_chars=240,
        text="They have met 12 times, and Northgate FC are rated 1843.",
    )  # fmt: skip
    assert verdict(ctx, draft, ok).verdict == "verified"
    wrong = [claim(ctx, "elo:home", 1900)]
    bad = verdict(ctx, line("Northgate FC are rated 1900."), wrong)
    assert bad.reason_code == "number_mismatch"
    away = verdict(ctx, line("Harbour United are rated 1791."), [claim(ctx, "elo:away", 1791)])
    assert away.verdict == "verified"


def test_history_metrics_need_history_and_stay_off_the_analysts_menu(match) -> None:
    from matchcast_agents.tools import InProcessTools, ToolError

    ctx = with_history(match)
    values = InProcessTools(ctx, 40).get_metrics(
        ["h2h_draws:home", "elo:away", "h2h_away_wins:away"]
    )
    got = {k: v["value"] for k, v in values[1]["values"].items()}
    assert got == {"h2h_draws:home": 3, "elo:away": 1791, "h2h_away_wins:away": 4}
    plain = context(match)  # a synthetic match has no history
    try:
        InProcessTools(plain, 40).get_metrics(["elo:home"])
    except ToolError as error:
        assert "no pre-match history" in str(error)
    else:
        raise AssertionError("a match without history must not make up a rating")
    bare = verdict(plain, line("Northgate FC are rated 1843."), [claim(plain, "elo:home", 1843)])
    assert bare.reason_code == "number_mismatch"


def test_history_subject_must_be_a_side_of_the_match_and_elo_rounds_half_up(match) -> None:
    import dataclasses

    ctx = dataclasses.replace(
        with_history(match), extra={"history": {**HISTORY, "elo": {"home": 1842.5, "away": 1800}}}
    )
    assert verdict(ctx, line("Rated 1843."), [claim(ctx, "elo:home", 1843)]).verdict == "verified"
    stray = verdict(ctx, line("They have met 12 times."), [claim(ctx, "h2h_played:nobody", 12)])
    assert stray.reason_code == "number_mismatch"


def test_a_generic_booth_colour_line_is_refused_and_a_specific_one_passes(match) -> None:
    ctx = context(match)
    shots = ctx.state.count("shots", "home")
    c = claim(ctx, "shots:home", shots)
    generic = line("The balance of the game is getting clearer.", "booth:colour", 180)
    bad = verdict(ctx, generic, [c])
    assert bad.verdict == "rejected" and bad.reason_code == "unsupported_statement"
    for text in ("Northgate FC are pressing higher now.", f"{shots} shots says they are brave."):
        assert verdict(ctx, line(text, "booth:colour", 180), [c]).verdict != "rejected", text
    # only the colour voice has to be specific
    assert verdict(ctx, line("The ball is in play.", "booth:pbp", 180), [c]).verdict != "rejected"
