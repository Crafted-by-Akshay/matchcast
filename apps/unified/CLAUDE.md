# Experience lane (apps/unified)

Read first: root `CLAUDE.md`, then `docs/architecture/11-frontend.md`, `10-voice-and-translation.md`, `12-api.md` §2-3, `03-runtime-flows.md` (F1, F3-F6), `apps/unified/README.md`.
Skills: `unified-build`, `demo-ready`, `tdd-workflow`, `verification-loop`, `handoff`. Agents: `tester`, `explorer`.

- Never read or edit `sources/` or the built `watch/ broadcast/ analyst/ shared/` folders; edit hooks, shell or `build.py` and rebuild.
- Watch is the only live match source. Keep honest labels: Simulated, Planned, "Rules fallback".
- One Playwright spec per behaviour in `tests/e2e/` (Quality lane owns shared helpers; add, do not rewrite). Phone width must not scroll sideways.
- No new frontend framework in the unified app.
