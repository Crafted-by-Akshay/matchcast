"""CREW-4.1: the adversarial pass tries to falsify each line against its claims, deterministically.

The fixture's prefix up to sequence 58 holds Northgate FC (home) 1 goal and Harbour United (away)
2 goals; the last event is Dev Hale's goal for Northgate FC, so that is the moment the claims cite.
"""

from dataclasses import replace

from conftest import run
from matchcast_agents.context import MatchContext
from matchcast_agents.messages import DraftLine
from matchcast_agents.rules import VerifierRules
from matchcast_agents.state import MatchState, apply
from matchcast_agents.verify import adversary
from matchcast_agents.verify.checks import run_checks

PREFIX = 58  # the last event is a home goal by Dev Hale


def context(match, upto: int = PREFIX) -> MatchContext:
    events = tuple(match["events"][:upto])
    state = MatchState()
    for event in events:
        state = apply(state, event)
    return MatchContext(
        match["roster"]["stream"], match["roster"], match["names"], match["teams"], state, events
    )


def claim(ctx: MatchContext, metric: str, value: int, claim_id: str = "c1") -> dict:
    snap = ctx.state.snapshot()
    return {
        "kind": "claim",
        "schema_version": "1.1.0",
        "stream": ctx.stream,
        "claim_id": claim_id,
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


def line(text: str, line_id: str = "l1", claim_ids=("c1",)) -> DraftLine:
    return DraftLine(
        line_id=line_id, claim_ids=tuple(claim_ids), persona="analyst", text=text, max_chars=280
    )


def score_claims(ctx: MatchContext) -> list[dict]:
    return [
        claim(ctx, "goals:home", ctx.state.count("goals", "home"), "c1"),
        claim(ctx, "goals:away", ctx.state.count("goals", "away"), "c2"),
    ]


def failed_names(checks) -> list[str]:
    return [c.name for c in checks if not c.passed]


def adversary_names(checks) -> list[str]:
    return [c.name for c in checks if c.name.startswith("adversary:")]


def test_a_clean_line_is_tried_by_every_attempt_and_passes(match) -> None:
    ctx = context(match)
    home, away = ctx.state.count("goals", "home"), ctx.state.count("goals", "away")
    draft = line(f"Score: Northgate FC {home}, Harbour United {away}.", claim_ids=("c1", "c2"))
    result = run(VerifierRules().check(ctx, draft, score_claims(ctx)))
    assert result.verdict == "verified"
    assert adversary_names(result.checks) == [f"adversary:{a.name}" for a in adversary.ATTEMPTS]
    assert all(c.passed for c in result.checks if c.name.startswith("adversary:"))


def test_a_name_from_the_moment_stays_valid_when_used_alone(match) -> None:
    ctx = context(match)
    checks = adversary.adversary_checks(
        ctx, line("Dev Hale scores, and Hale is in the box."), [claim(ctx, "goals:home", 1)]
    )
    assert failed_names(checks) == []


def test_a_swapped_score_is_falsified_by_the_attribution_attempt(match) -> None:
    ctx = context(match)
    home, away = ctx.state.count("goals", "home"), ctx.state.count("goals", "away")
    draft = line(f"Score: Northgate FC {away}, Harbour United {home}.", claim_ids=("c1", "c2"))
    result = run(VerifierRules().check(ctx, draft, score_claims(ctx)))
    # every number is still a claim value, so checks 1 to 5 pass; only the attempt catches it
    assert (result.verdict, result.reason_code) == ("rejected", "number_mismatch")
    assert failed_names(result.checks) == ["adversary:score_attribution"]


def test_a_minute_no_claim_carries_is_falsified(match) -> None:
    ctx = context(match)  # the claims are 4.3 minutes in
    draft = line("Harbour United have scored at minute 2.")
    checks = adversary.adversary_checks(ctx, draft, [claim(ctx, "goals:away", 2)])
    assert failed_names(checks) == ["adversary:named_minute"]


def test_a_minute_the_claims_carry_is_accepted_in_any_wording(match) -> None:
    ctx = context(match)
    for text in ("Harbour United scored in minute 4.", "a goal in the 4th minute", "scored 4'"):
        checks = adversary.adversary_checks(ctx, line(text), [claim(ctx, "goals:away", 2)])
        assert "adversary:named_minute" not in failed_names(checks), text


def test_a_surname_alone_is_falsified_when_the_moment_names_someone_else(match) -> None:
    ctx = context(match)
    # "Cato" is a first name in the roster (Cato Costa, Cato Hale), not the scorer's
    result = run(
        VerifierRules().check(
            ctx, line("Dev Hale scores, and Cato is in the box."), [claim(ctx, "goals:home", 1)]
        )
    )
    assert (result.verdict, result.reason_code) == ("rejected", "unknown_player")
    assert failed_names(result.checks) == ["adversary:surname_alone"]


def test_a_number_no_claim_carries_and_a_value_stated_twice_are_both_tried(match) -> None:
    ctx = context(match)
    checks = adversary.adversary_checks(
        ctx, line("Northgate FC 1, Harbour United 2, 7 shots."), score_claims(ctx)
    )
    assert "adversary:unclaimed_number" in failed_names(checks)
    checks = adversary.adversary_checks(
        ctx, line("Northgate FC scored 1, and Harbour United 1."), score_claims(ctx)
    )
    assert "adversary:repeated_value" in failed_names(checks)
    assert "adversary:score_attribution" in failed_names(checks)


def test_each_attempt_that_cannot_decide_fails_closed(match, monkeypatch) -> None:
    def cannot_decide(ctx, draft, claims):
        raise RuntimeError("no answer")

    attempts = tuple(
        replace(a, attack=cannot_decide) if a.name == "named_minute" else a
        for a in adversary.ATTEMPTS
    )
    monkeypatch.setattr(adversary, "ATTEMPTS", attempts)
    ctx = context(match)
    result = run(
        VerifierRules().check(ctx, line("Dev Hale scores."), [claim(ctx, "goals:home", 1)])
    )
    assert (result.verdict, result.reason_code) == ("rejected", "number_mismatch")
    refused = next(c for c in result.checks if c.name == "adversary:named_minute")
    assert not refused.passed and refused.detail.startswith("could not decide")


def test_ask_answers_and_recaps_are_not_put_to_the_adversary(match) -> None:
    ctx = context(match)
    claims = [claim(ctx, "goals:home", 1)]
    for line_id in ("ask", "line-recap-1"):
        checks = run_checks(ctx, line("Dev Hale scores, and Cato is in the box.", line_id), claims)
        assert adversary_names(checks) == [], line_id


def test_every_verified_line_in_a_workflow_run_records_each_attempt(make_workflow, match) -> None:
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    expected = [f"adversary:{a.name}" for a in adversary.ATTEMPTS]
    verified = [
        r
        for r in flow.store.audit_records(flow.sk)
        if r["action"] in ("line_verified", "line_review")
    ]
    assert verified
    for record in verified:
        assert [
            c["name"] for c in record["details"]["checks"] if c["name"].startswith("adversary:")
        ] == expected
