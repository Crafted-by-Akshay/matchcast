# ADR-0016: Player orders are bounded by role in code

- **Status:** Accepted
- **Date:** 2026-10-24
- **Decided by:** Akshay (delegated the design to the build thread on Oct 24)

## Context

A fan can talk to any player in Watch and give an instruction ("press higher", "shoot from range"). Orders change how the simulated player positions and decides. Before this ADR the browser's keyword parser applied any order to any player, so a keeper could be sent upfield. A rule that lives only in a prompt is not a bound: the model can be talked into anything. Judges look for agents that stay inside their role. The API has no player positions in its roster; the simulator knows them, so the Watch client sends the position with each talk.

## Options

1. Prompt-only limits: tell the player agent what it may do. Rejected: nothing checks the answer.
2. Browser-only limits: the Watch hook refuses disallowed orders. Rejected: the browser is not the authority, and the API's reply would still move the sim.
3. Server guard plus a mirror in the Watch hook: one role table in `packages/agents/matchcast_agents/roles/orders.py`; the player agent names the order it heard; the API accepts or refuses it for the position the client sent, and the hook applies only accepted orders. Quick buttons never reach the API; the hook greys out the ones the role does not allow.

## Decision

Option 3. The table has five groups (keeper, centre-back, full-back, midfield, forward). A keeper gets `deep` (hold the line), `simple` (distribution), `rest`, and `clear`; he is never sent upfield. An order outside the group is refused with the player's own line (for example "Not from my line, boss"), which is spoken and shown as a checked reply. `clear` is always allowed. A position the sim does not send gets the most restrictive set. The rules fallback reads the typed words with the same keyword list, and a question or a negation ("don't shoot") is never an order. The Verifier still checks every number and name in the reply, and an order moves the sim only when its reply is verified.

## Consequences

- A keeper cannot be sent into the play by a prompt or a keyword. A modified browser can claim any position: that changes only its own simulated match, never the event record, and closing it needs the roster to carry positions (a contract change, follow-up).
- Quick buttons are checked in the browser only (rules mode, no API call). A modified browser can press a disallowed one; the same limit as above applies.
- The table and the keyword list are written twice (Python, and `apps/unified/embed/watch.js` for the greyed-out buttons and the fallback). A parity check is a follow-up.
- The simulator itself does not yet clamp orders by position. A change inside `apps/unified/sources` (read only for the Experience lane) would make that bound hold even if the hook were bypassed. Follow-up for that lane.
- Orders are still "Game mode": they never edit the event record behind a claim.

## Affects

- docs/architecture/03-runtime-flows.md (talk flow and Game mode)
- docs/architecture/04-agents.md (player persona row)
- docs/architecture/12-api.md (`POST /v1/matches/{match_id}/talk`)
