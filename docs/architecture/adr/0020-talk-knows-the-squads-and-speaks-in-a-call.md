# ADR-0020: Talk knows both squads and the knowledge base, and can run as a voice call

- **Status:** Accepted
- **Date:** 2026-10-25
- **Decided by:** Akshay (judge test: the player refused "Who are the forward players?", and he wants a call, not push-to-talk)

## Context

The player's talk had only his own counts and the last events, so a basic question about his team got "I can't tell you that". Watch also took one line at a time: push-to-talk, then a transcript, which reads like a walkie-talkie and not a call.

## Options

1. Give the model every event and every stat. Rejected: the sheet grows with the match and the Verifier cannot check what it does not recount.
2. Give the model the squads and the knowledge base as background, and keep the numbers recounted from the log. Chosen.
3. A Realtime speech-to-speech model. Rejected for now: a second model path that the Verifier cannot check, and a new Foundry deployment inside the budget cap.

## Decision

- **Team knowledge.** Each talk carries `team_sheet`: both squads as `name, position` lines in words, from the club pages in `kb/clubs/`. Shirt numbers and ratings stay out, so the model has no digit that the Verifier cannot tie to the log. It also carries `knowledge`: the three kb passages that best match his name and the manager's words (BM25 over `kb/`, the same index Ask uses). Passages are words; the model copies no digit from them.
- **Names.** A name in the reply must be a name on either squad, a club, or a player in the recent events (the existing Verifier rule, widened to the squads).
- **Numbers.** Unchanged: a count must be his own, or a club total from the log, with the club named (ADR-0016, ADR-0018).
- **Voice call.** A **Call** button beside the mic keeps the microphone open. Each finished phrase is sent as a talk. A verified reply plays in his own voice (the api's clip, else the browser voice). A fan who speaks cuts the reply off. Azure Speech continuous recognition is used when the api has a Speech resource; otherwise the browser's speech recognition, labelled **Simulated**. A short quiet window after each reply keeps his own voice from cutting him off through the speakers.
- **Layout.** The Pulse log hides while the Copilot drawer is open, so it no longer covers the Talk input.

## Consequences

- Talk answers can name anyone on either squad, so a squad change in `kb/clubs/` changes what he can say, with no code change.
- The call's cut-in on speakers is only as good as the echo control of the device. Headphones work best; the page does not promise otherwise.
- The live model's latency is not measured here. The deployed app is the measurement.
