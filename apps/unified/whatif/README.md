# What if clips (Analyst, match centre "What if")

Pre-rendered re-runs of a season fixture. The same seed plays the match twice: once untouched, once with one change at a minute.
The engine is deterministic, so the two arms agree until the change and differ after it. Every number is a simulated estimate
over the seeds, never a fact about the recorded match.

Changes (run.cjs, the engine hooks are `setFormation` and `movePlayer` on `window.__mc`, identical in both engine copies):

- `--move pi:minute:dx:dy` moves one player (index 0-21, 0-10 home) by dx metres forward and dy sideways from his slot.
- `--whatif ti:minute:form` switches one team (0 home, 1 away) to a formation at that minute.

Making a clip set (about 10 minutes per preset on 4 cores, 12 seeds):

    node services/simulation/run.cjs --season M001 --seeds 1000-1011 --move 4:60:-10:0 --track 1000 --workers 4 --out DIR/deeper
    python3 apps/unified/whatif/build_index.py M001 deeper=DIR/deeper/whatif.json ...

`clips/index.json` is committed; `build.py` copies it to `analyst/data/whatif/`.

Known: a season fixture re-run does not reproduce the recorded season run (M001 recorded 0-0, 0 v 3 shots; the re-run is its own
match from the same setup). The page says the untouched run is the simulator's own re-run of the same seed.
