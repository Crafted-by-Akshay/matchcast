---
name: unified-build
description: Use when changing the unified Watch / Analyst / Broadcast app in apps/unified: build.py, the shell, embed hooks, live.js, agents.js, or its Playwright specs.
---

# Unified app

Docs: `apps/unified/README.md`, `docs/architecture/11-frontend.md`. Owner: Experience lane.

## Layout
- `index.html` (hand-written shell: top-bar switcher, match bar, Agents tab, message bus), `contracts.js` (`MCC`, canonical JSON + SHA-256 audit chain), `agents.js` (`AG`, in-page rules pipeline), `live.js` (`LV`, posts events to the api and follows its SSE), `config.js` (api URL).
- `embed/*.js` are hooks appended to each view. `sources/` is a read-only copy of the three prototypes; never edit or read it. `build.py` copies each view from `sources/` and applies asserted patches, so a patch fails loudly when its anchor text moves.
- Built folders `watch/`, `broadcast/`, `analyst/`, `shared/` are generated and not committed. Do not read them: edit the source, run the build.

## Build and run
- `python3 apps/unified/build.py` (add `--api https://<api>` to bake the api URL; without it nothing is called). `python3 apps/unified/build.py <dir>` writes a test copy with three.js served locally.
- `node tests/e2e/serve.mjs` serves it for Playwright; `make e2e` runs the specs, `E2E_ARGS="tests/e2e/pulse.spec.ts" make e2e` narrows.

## Rules
- Watch is the only live match source. Broadcast runs in consumer mode (`MC_CONSUMER`); the Analyst shows a live pill. Keep it that way.
- No new framework in the unified app (ES2022 modules, ESLint). The connection pill states are exactly: Live agents, Rules fallback, Warming up the match engine (with the seconds counted, "· 12 s of up to 45"), Offline (simulated); the pill reads Starting… only until the page has loaded.
- Honest labels: language picker marks all but English, Spanish and Hindi as Planned; Entra roles and anything not connected say Simulated or Planned.
- Mode, persona and language names must match the api personas (`casual`, `analyst`, `club:<key>`, `player:<name>`, `metric:<name>`).
- Every screen behaviour has a Playwright spec under `tests/e2e/` (spec list in `16-testing-and-quality.md`). A UI change without a spec is not done. Check a phone-width layout has no horizontal scroll.
