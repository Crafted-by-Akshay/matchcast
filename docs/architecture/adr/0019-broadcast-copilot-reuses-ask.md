# ADR-0019: The Broadcast Copilot reuses the Ask workflow, ranks picks in code, and leaves the camera with Watch

- **Status:** Accepted
- **Date:** 2026-10-24
- **Decided by:** Akshay (plan approved in the Broadcast copilot thread, Oct 24)

## Context

The Broadcast view needs highlights, a camera or story focus, and a production plan that a broadcaster can act on during a live match. The judging rules (§4.1) ask for a pipeline that explains why a moment matters and renders it beside the match. A separate chatbot would add a second answer path with its own verifier and cost.

## Options

1. A new Broadcast agent with its own workflow and route.
2. The Ask workflow gets a `surface` field (`ask` or `broadcast`). Broadcast intents (`highlights`, `focus`, `plan`) are answered by code over the match state and events, and every other question takes the Ask path unchanged.
3. The model ranks highlights and focus and writes their reasons.

## Decision

Option 2, with code ranking.

- `POST /v1/matches/{id}/ask` takes `surface` (default `ask`). With `surface: "broadcast"`, a question with a Broadcast cue is answered by `matchcast_agents.broadcast`. The reply adds `broadcast` (`highlights`, `focus` or `plan`), and each pick cites its event.
- Highlights are the events scoring at least 40 on the producer's moment scale, best first. Focus is the best player moment in the last three minutes, else a wide shot. An own goal names no player and is never a focus target. Period ends read "Half time" or "Full time" from the clock period. Minutes come from event clocks and names from the roster, so no model call is needed. Picks cite their events with the citation type `event`, which the Ask path does not use.
- The camera is never moved by the API or by Broadcast. Focus returns a `camera` preset and a player or zone. Watch shows a "Go to it" control, and the camera moves only on click. The click calls `window.MCWatch.focus({ player_id })`, which moves the camera for a player on the pitch and returns false otherwise; the button then says "Camera not moved".
- No new core agent and no LLM call in the live loop. The Verifier's rules still apply to any model text that a later phase adds.

## Consequences

- The Broadcast Copilot is deterministic and repeatable, so its picks can be checked by tests.
- Broadcast cues are narrow (a question must say highlights, camera, focus, production plan, strategy, rundown or what next), so a broadcast question never reaches the router's declines by accident. Plain questions on the same surface take the Ask path.
- The audit action stays `ask_answered`, with a `surface` field, so the closed list in 04 §4 does not change.
- Model-written wording for highlights and plans is a later step. Until then, the reasons are templates over event data.
- The front end is in the same PR: the split pane, the production strip (the agents' trace per aired line, from the shell's `air` message) and the Copilot panel in Broadcast, and the focus suggestion in Watch. See [11-frontend.md](../11-frontend.md).
- The camera move is live for players. Watch's "Go to it" calls `MCWatch.focus` (player mode). Zone focus from the API is not wired to the camera yet; the pill stays disabled for a zone-only pick.
