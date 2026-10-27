# ruff: noqa: E501  (the patch tables hold whole source lines that must match exactly)
# Builds the unified MatchCast app. Nothing in the source folders is edited: each view is read
# from its
# source, patched in memory by the asserted replacements below, and written under unified/.
#   watch/       fan 3D match (3d-source/v2, minus its v10 Director and v11 Analyst boards)
#   broadcast/   broadcaster desk (broadcaster-console, its own build)
#   analyst/     enterprise console (enterprise-console/src + data)
#   shared/      players.json, intl.json and fixtures.json (the season, read by the shell)
#   index.html   the shell, written by hand
# Usage: python3 build.py [--api <url>]  -> files to publish (three.js from jsdelivr);
#        --api points the shell at the live agent api (rewrites config.js)
#        python3 build.py <dir>      -> also writes a copy in <dir>, three.js served locally (tests)
import glob
import json
import os
import re
import shutil
import sys

U = os.path.dirname(os.path.abspath(__file__)) + "/"
MC = U + "sources/"  # the copied build sources, kept inside this app
W, BE, BS, AS, AD = (
    MC + "3d-source/v2/",
    MC + "broadcaster-console/engine/",
    MC + "broadcaster-console/src/",
    MC + "enterprise-console/src/",
    MC + "enterprise-console/data/",
)
EMB = U + "embed/"
CDN = "https://cdn.jsdelivr.net/npm/three@0.160.0/"


def r(p):
    return open(p, encoding="utf-8").read()


# The full-time recap (fanmodes.js) said a 0-4 result was "about right" whenever the xG were within 0.3. Level chances
# only mean a draw is fair; for a win by two or more the margin owes more to finishing than to chances, and a one-goal win is about what the chances suggest.
RECAP_OLD = "xw < 0 ? 'the chances were close to even, so the result is about right' : w === xw"
RECAP_NEW = (
    "xw < 0 ? (w < 0 ? 'the chances were close to even, so the draw is a fair reflection' : Math.abs(a - b) > 1 ? 'the chances were close to even, so the margin owes more to finishing than to chance quality' : 'the chances were close to even, so the win is about what the chances suggest') : w === xw"
)

# EXP-4, ADR-0023: Watch's picker marks a language as live when the api checks it (langs.js), else Planned.
LANG_OLD = "+ n + '</button>').join('')"
LANG_NEW = (
    """+ n + (window.MC_LANGS.includes(k) ? '' : ' <small class=fm-planned>Planned</small>')"""
)
LANG_NEW += """ + '</button>').join('')"""


ASK_OLD = "  if (!typed || !SAMPLE) { chatAdd('ana', ruleAnswer(q)); return; }\n"
ASK_NEW = """  if (!typed) { chatAdd('ana', ruleAnswer(q)); return; }
  if (window.mcAsk) {
    CP.busy = true; const out = chatAdd('ai', 'Checking with the agents…');
    const a = await window.mcAsk(q); CP.busy = false;
    const tick = a.verdict === 'verified' ? ' ✓ Verified' : '';
    out.textContent = a.text + tick + (a.note ? ' (' + a.note + ')' : '');
    return;
  }
  if (!SAMPLE) { chatAdd('ana', ruleAnswer(q)); return; }
"""


def sub(text, old, new, label):
    n = text.count(old)
    assert n == 1, label + ": expected 1 match, found " + str(n)
    return text.replace(old, new)


# Wall-time match clock (docs/architecture/11-frontend.md). The engine's loop capped each frame at 0.05 s, so under 20 fps
# the match ran slow (8 fps = 0.4x). One frame may now carry 0.25 s, and a live frame spends at most CATCHUP_STEPS fixed
# steps (0.3 s of play, times the playback speed above 1x); the rest of a long stall is dropped, so a very slow machine plays slower instead of freezing.
# STEP stays 0.02 s with its remainder carry (simAcc), and the headless runner path (__mcHeadless, __mcDt) is not clamped.
# Applied to both engine copies (Watch and the desk), which must stay identical (tests/test_engine_copies.py).
WALLTIME = [
    ("function loop() { frame(Math.min(clk.getDelta(), 0.05), true); }", "function loop() { frame(Math.min(clk.getDelta(), 0.25), true); }", "loop dt cap"),
    ("const STEP = 0.02; let simAcc = 0;", "const STEP = 0.02; let simAcc = 0;\nconst CATCHUP_STEPS = 15; const catchup = () => CATCHUP_STEPS * STEP * Math.max(1, S.speed);   // live frames only (the runner's budget is exact); faster playback gets a proportionally larger cap, so 2x and up never play slower than before", "catch-up cap"),
    ("window.__mcHeadless ? (window.__mcDt || 0) : dt * S.speed;", "window.__mcHeadless ? (window.__mcDt || 0) : Math.min(dt * S.speed, catchup());", "frame budget"),
]


def walltime(text, label):
    for old, new, what in WALLTIME:
        text = sub(text, old, new, label + " wall-time " + what)
    return text


# FIX-11: the detection boxes and raw track ids (?1124) are a debug view. The overlay is the prototype's (sources/ is read only), so its
# default changes here: Boxes is off at every width and the button is labelled as debug (vision_debug_button).
VISION_LABELS = [
    ("const VIS = { on: false, boxes: true,", "const VIS = { on: false, boxes: false,", "vision boxes off by default"),
]


def vision_labels(text, label):
    for old, new, what in VISION_LABELS:
        text = sub(text, old, new, label + " " + what)
    return text


def vision_debug_button(head, label):
    return sub(
        head,
        '<button id="visp-box" aria-pressed="true" title="Show detected boxes">Boxes</button>',
        '<button id="visp-box" aria-pressed="false" title="Debug: detected boxes and raw track ids">Debug boxes</button>',
        label + " debug boxes button",
    )


ORDER_OLD = "function setOrder(p, k, text, by) {\n  if (!k || k === 'none') return;"
ORDER_NEW = (
    "function setOrder(p, k, text, by) {\n"
    "  if (!k || k === 'none' || !mcAllowed(p.pos, k)) return;"
    "   // role bound (embed/roles.js): an order outside the role never reaches p.orders"
)


def importmap():
    return (
        '<script type="importmap">\n{"imports":{"three":"'
        + CDN
        + 'build/three.module.js","three/addons/":"'
        + CDN
        + 'examples/jsm/"}}\n</script>\n'
    )


def clim(d):
    return json.dumps(json.load(open(d + "climate.json")), separators=(",", ":"))


# ---------- Watch: the 3D fan app without its v10 Director and v11 Analyst boards
# (they live in Broadcast and Analyst)
WATCH_MODS = [
    "setup.js",
    "copilot.js",
    "talk.js",
    "verifier.js",
    "autoevent.js",
    "explain.js",
    "history.js",
    "fanmodes.js",
    "predict.js",
    "v9glue.js",
]


def build_watch():
    main = (
        r(W + "main.js")
        .replace("/*@@WORLD@@*/", r(W + "world.js").replace("/*@@CLIMATE@@*/null", clim(W)))
        .replace("/*@@WORLDVIS@@*/", r(W + "worldvis.js"))
        .replace("/*@@TACTICS@@*/", r(W + "tactics.js"))
        .replace("/*@@SETUP@@*/", "\n".join(r(W + f) for f in WATCH_MODS))
    )
    main = sub(main, ORDER_OLD, ORDER_NEW, "watch role bound")
    main = walltime(main, "watch")
    main = vision_labels(main, "watch")
    main = sub(main, "'./players.json'", "'../shared/players.json'", "watch players path")
    main = sub(main, "'./intl.json'", "'../shared/intl.json'", "watch intl path")
    main = sub(main, "[3, 5, 10, 45].forEach", "[3, 5, 10, 15, 45].forEach", "watch half chips")
    main = sub(main, LANG_OLD, LANG_NEW, "watch language labels")
    main = sub(main, RECAP_OLD, RECAP_NEW, "watch recap on lopsided scores")
    # EXP-5: a typed question goes to the shell (the agents), not to a stand-in model
    main = sub(main, ASK_OLD, ASK_NEW, "watch ask")
    # EXP-4: passes carry start and end positions (metres) so the shell can send the contract's pass event
    main = sub(
        main,
        "dataEvent('pass', { team: p.T.key, player: p.name, to: q.name, kind:",
        "dataEvent('pass', { x0: +p.pos2.x.toFixed(1), y0: +p.pos2.y.toFixed(1),"
        " x1: +q.pos2.x.toFixed(1), y1: +q.pos2.y.toFixed(1),"
        " team: p.T.key, player: p.name, to: q.name, kind:",
        "watch pass positions",
    )
    # EXP-16: in Watch every quick order and typed line goes through embed/watch.js (mcTalk), which applies the role guard; the sim's own in-page order paths are not reached
    main = sub(
        main,
        "if (quick || !SAMPLE) { const k = quick || keywordOrder(text); setOrder(p, k, text); const r = ruleReply(p, k); talkLine(p, 'pl', r); speak(p, r); renderTalk(); return; }",
        "window.mcTalk(p, text, quick); return;",
        "watch talk api",
    )
    head = sub(
        r(W + "head.html"),
        "<title>MatchCast 3D</title>",
        "<title>MatchCast Watch</title>",
        "watch title",
    )
    head = vision_debug_button(head, "watch")
    assert main.count("sxg: 'xG',") == 6, "watch xg label: expected 6 language entries"
    main = main.replace("sxg: 'xG',", "sxg: 'xG (engine)',")   # Watch shows its engine's own per-shot xG; the Verifier uses the shared model, so the two can differ on low-value shots
    head = sub(   # Watch writes and checks these lines in the page, so the card says so (the API-Verified ones appear as Match Pulse cards)
        head,
        "<span>AI COMMENTARY · VERIFIED</span>",
        "<span>COMMENTARY · CHECKED IN PAGE · SIMULATED</span>",
        "watch commentary label",
    )
    head = sub(   # an aria-label needs a role on a span (axe aria-prohibited-attr)
        head,
        '<span class="stam" aria-label="Stamina">',
        '<span class="stam" role="img" aria-label="Stamina">',
        "watch stamina role",
    )
    return (
        head
        + importmap()
        + '<script>\n' + r(U + "langs.js") + '\n</script>\n'   # the language list first: Watch's picker reads MC_LANGS
        + '<script type="module">\n'
        + main
        + "\n"
        + r(EMB + "hook.js")
        + "\n"
        + r(EMB + "roles.js")
        + "\n"
        + r(EMB + "langpick.js")   # before watch.js: its fanSet wrapper and the load-time wiring then see the replaced language list
        + "\n"
        + r(EMB + "watch.js")
        + "\n"
        + r(EMB + "focus.js")
        + "\n"
        + r(EMB + "vision-crops.js")
        + "\n"
        + r(EMB + "vision-events.js")
        + "\n"
        + r(EMB + "indices.js")
        + "\n"
        + r(EMB + "feed.js")
        + "\n"
        + r(EMB + "twofans.js") + "\n" + r(EMB + "feedpick.js") + "\n" + r(EMB + "democtl.js")
        + "\n</script>\n</body>\n</html>\n"
    )


# ---------- Broadcast: the broadcaster desk, same build as broadcaster-console/build.py
# plus the shell hook
BC = ["bc-core.js", "bc-focus.js", "bc-script.js", "bc-players.js"]
ENGINE = [
    "setup.js",
    "copilot.js",
    "talk.js",
    "verifier.js",
    "autoevent.js",
    "explain.js",
    "history.js",
    "fanmodes.js",
    "predict.js",
]


def build_broadcast():
    main = (
        r(BE + "main.js")
        .replace("/*@@WORLD@@*/", r(BE + "world.js").replace("/*@@CLIMATE@@*/null", clim(BE)))
        .replace("/*@@WORLDVIS@@*/", r(BE + "worldvis.js"))
        .replace("/*@@TACTICS@@*/", r(BE + "tactics.js"))
        .replace(
            "/*@@SETUP@@*/",
            "\n".join(r(BE + f) for f in ENGINE + ["v9glue.js"])
            + "\n"
            + "\n".join(r(BS + f) for f in BC),
        )
    )
    main = sub(main, ORDER_OLD, ORDER_NEW, "broadcast role bound")
    main = walltime(main, "broadcast")
    main = vision_labels(main, "broadcast")
    # a refused order is said out loud, not acknowledged: the same line Watch uses
    main = sub(
        main,
        "if (quick || !SAMPLE) { const k = quick || keywordOrder(text); setOrder(p, k, text);",
        "if (quick || !SAMPLE) { const k = quick || keywordOrder(text); if (!mcAllowed(p.pos, k)) { talkLine(p, 'pl', MC_REFUSAL); speak(p, MC_REFUSAL); renderTalk(); return; } setOrder(p, k, text);",
        "broadcast role refusal",
    )
    main = sub(main, "'./players.json'", "'../shared/players.json'", "broadcast players path")
    main = sub(main, "'./intl.json'", "'../shared/intl.json'", "broadcast intl path")
    main = sub(main, "[3, 5, 10, 45].forEach", "[3, 5, 10, 15, 45].forEach", "broadcast half chips")
    main = sub(main, LANG_OLD, LANG_NEW, "broadcast language labels")
    main = sub(main, RECAP_OLD, RECAP_NEW, "broadcast recap on lopsided scores")
    main = sub(main, "bcNewMatch(q.get('seed'));", "bcEmbedStart(q);", "broadcast start")
    # the desk writes rules templates in Spanish and Hindi only (ADR-0023 keeps the other feed languages English on the desk); Tamil drafts are dropped (embed/bclang.js writes and re-checks es and hi)
    # the fixture's clubs are read before the desk's TEAMS literal is used, so the first render names them (embed/boot-clubs.js)
    main = sub(main, "const TEAMS = [", r(EMB + "boot-clubs.js") + "\nconst TEAMS = [", "broadcast boot clubs before TEAMS")
    main = sub(main, "const SKIN = [", "if (MC_BOOT_CLUBS) mcBootNames(MC_BOOT_CLUBS);\nconst SKIN = [", "broadcast boot names before the lineups")
    for a, c, label in [
        ("bcEsc(BC.lang === 'ta' ? last.ta : last.en)", "bcEsc(bcTx(last))", "broadcast strip text"),
        ("const L = lang === 'ta' ? 'ta-IN' : 'en-GB', u =", "const L = ({ es: 'es-ES', hi: 'hi-IN' })[lang] || 'en-GB', u =", "broadcast speech language"),
        ("(BC.lang === 'ta' ? 'தமிழ் · drafted' : 'English · Tamil drafted')", "bcLangTag()", "broadcast teleprompter tag"),
        ("Tamil lines are drafted and need a native-speaker check before air.", "Spanish and Hindi lines are written by rules from the English line and the Verifier re-checks names and numbers; Tamil is out until a native speaker reviews it.", "broadcast teleprompter note"),
        ("bcSpeak(BC.lang === 'ta' ? l.ta : l.en, BC.lang)", "bcSpeak(bcTx(l), BC.lang)", "broadcast speak"),
        ("const ta = BC.lang === 'ta', L = BC.script", "const ta = false, L = BC.script", "broadcast paint flag"),
        ("(ta ? L.ta : L.en)", "bcTx(L)", "broadcast now line"),
        ("N.map((x) => (ta ? x.ta : x.en))", "N.map((x) => bcTx(x))", "broadcast next lines"),
        ("bcEsc(ta ? x.ta : x.en) + '<span class=\"src\">' + bcEsc(x.src) + '</span>", "bcEsc(bcTx(x)) + '<span class=\"src\">' + bcEsc(x.src + bcTrNote(x)) + '</span>", "broadcast line list"),
        ("e(l.en) + '<br><small>' + e(l.ta) + '</small>'", "e(l.en) + '<br><small>' + e(l.es || '(English shown: not translated)') + '</small><br><small>' + e(l.hi || '(English shown: not translated)') + '</small>'", "broadcast export lines"),
    ]:
        main = sub(main, a, c, label)
    # EXP-2: consumer mode. The desk does not simulate in the unified app;
    # consumerStep (embed/broadcast.js) follows Watch.
    main = sub(
        main,
        "function stepSim(dt) {\n",
        "function stepSim(dt) {\n  if (window.MC_CONSUMER) { consumerStep(dt); return; }\n",
        "broadcast consumer mode",
    )
    head = sub(
        r(BE + "head.html"),
        "<title>MatchCast 3D</title>",
        "<title>MatchCast Broadcaster desk</title>",
        "broadcast title",
    )
    head = head.replace(
        "</style>",
        r(BS + "bc.css")
        + "\n/* The shell already supplies the match header and shared controls. Keep the desk's own task tabs. */\n"
        + ".bc-top{display:none}\n</style>",
        1,
    )
    head = vision_debug_button(head, "broadcast")
    return (
        head
        + sub(
            r(BS + "bc-body.html"),
            '<button data-l="ta" aria-pressed="false">தமிழ்</button>',
            '<button data-l="es" aria-pressed="false">ES</button><button data-l="hi" aria-pressed="false">हिन्दी</button>',
            "broadcast language buttons",
        )
        + '<script>\n' + r(U + "langs.js") + '\n</script>\n'   # ADR-0023: the language list the desk reads
        + '<script>\n' + r(EMB + "desk-panels.js") + '\n</script>\n'   # the desk panels: a classic script, so they show before the 3D module's imports load
        + importmap()
        + '<script type="module">\n'
        + main
        + "\n"
        + r(EMB + "hook.js")
        + "\n"
        + r(EMB + "roles.js")
        + "\n"
        + r(EMB + "broadcast.js")
        + "\n"
        + r(EMB + "bclang.js")
        + "\n"
        + r(EMB + "replay.js")
        + "\n"
        + r(EMB + "feed.js")
        + "\n"
        + r(EMB + "onair.js")
        + "\n"
        + "\n</script>\n</body>\n</html>\n"
    )


# ---------- Analyst: the enterprise console (same build as enterprise-console/build.py)
# plus the shell hook
# FIX-06 / FIX-07 / FIX-08: the console's copy. The console runs rules here (its model path needs a host capability this site does not have),
# its Watch links go to the Watch app beside it, and its saved items are kept in this browser, not shared.
# Each pair asserts how many times it occurs, so a source change fails the build instead of shipping stale copy.
ANALYST_COPY = [
    ("https://claude.ai/artifact/SSjrndFyoFUViaVZ6TzyFX", "../watch/index.html", 2),
    ("Demo: Claude via artifact sampling when granted, rules otherwise · Production: Azure AI Foundry Agent Service",
     "Rules answers in this console · Production: the live agent api runs Producer, Analyst, Narrator and Verifier on Azure AI Foundry", 1),
    ("Agents may call Claude when the viewer grants it (production: Azure AI Foundry).",
     "Agents answer from rules in this console. The live agent api runs the Foundry models.", 1),
    ("Shared with your organisation", "Saved on this device", 3),
    ("Shared with your team", "Saved on this device", 1),
    ("Clips are shared with your organisation.", "Clips are saved on this device.", 1),
    ("Saved queries are shared with your organisation and logged in the audit trail.",
     "Saved queries are kept on this device.", 1),
    ("Foundry-ready agents", "console agents", 2),
]


def analyst_copy(text):
    for old, new, n in ANALYST_COPY:
        found = text.count(old)
        assert found == n, "analyst copy: expected " + str(n) + " of " + repr(old[:60]) + ", found " + str(found)
        text = text.replace(old, new)
    # the console's own label for its model path: Claude only exists in the artifact host, so the copy says Model
    text = re.sub(r"\bClaude\b", "Model", text)
    text = re.sub(r"\bnot granted\b(?! in this view| here)", "not available here", text)
    text = re.sub(r"not granted (in this view|here)", "not available in this console", text)
    text = re.sub(r"when (it is granted|the viewer grants it|granted)", "when available", text)
    text = re.sub(r"\bis granted\b", "is available", text)
    return text


def build_analyst():
    pages = sorted(glob.glob(AS + "pages/*.js")) + sorted(glob.glob(U + "analyst-pages/*.js"))
    js = (
        r(AS + "core.js")
        + "\n"
        + "\n".join("// ---- " + os.path.basename(p) + "\n" + r(p) for p in pages)
        + "\nboot();\n"
        + r(EMB + "analyst.js")
        + "\n"
    )
    return analyst_copy(r(AS + "head.html") + '<script>\n"use strict";\n' + js + "</script>\n")


# same stadium order as the 3D engine's STADIUMS
MSI_STADIUM = {"london": 0, "madrid": 1, "rio": 2, "milan": 3, "mexico": 4}


def fixtures():
    L = json.load(open(AD + "league.json"))
    clubs = {c["key"]: c for c in L["clubs"]}
    out = []
    for k in range(len(L["fixtures"])):
        mid = "M%03d" % (k + 1)
        m = json.load(open(AD + mid + ".json"))
        h, a = clubs[m["home"]], clubs[m["away"]]
        out.append(
            {
                "id": mid,
                "matchday": m["matchday"],
                "date": m["date"],
                "home": {
                    "key": h["key"],
                    "club": h["club"],
                    "color": h["color"],
                    "stadium": h["stadium"],
                },
                "away": {"key": a["key"], "club": a["club"], "color": a["color"]},
                "score": m["score"],
                "stIndex": MSI_STADIUM[h["stadium"]],
                "setup": {
                    "stadium": m["setup"]["stadium"],
                    "city": m["setup"]["city"],
                    "month": m["setup"]["month"],
                    "kickoff": m["setup"]["kickoff"],
                    "seed": m["setup"]["seed"],
                    "half": m["setup"]["half"],
                },
                "formations": m["sum"]["formations"],
                "styles": m["sum"]["styles"],
                "result": m["sum"]["result"],
            }
        )
    return out


# Real national teams with synthetic squads (ADR-0020). The squads and the head-to-head block come from
# national/ (copies made by scripts/build_national_squads.py from the CC0 results). The web image builds
# from apps/unified alone, so the files must live here. Every player is fictional; the clubs and the
# fixture say so with the "synthetic squad" label.
NATIONAL_SQUADS = U + "national/squads.json"
NATIONAL_HISTORY = U + "national/history.json"
NATIONAL = [
    # key, nation (the results-file name), kit colour, stadium (one of the 3D engine's stadiums)
    ("ARG", "Argentina", "#75AADB", "mexico"),
    ("BRA", "Brazil", "#F2C400", "mexico"),
]
NATIONAL_SEED = 2026
# The default match must show something. The venue fixture's tactics were a 5-4-1 low block for Argentina, which gave 0 to 2 shots
# a half-time in most seeds; an open 4-3-3 balanced v 4-3-3 balanced on the same seed gives 13 shots and one goal at 34' (one seed, not a calibration claim)
# (measured on the runner's 0.02 s step). Tactics are a fixture setting, not engine calibration. tests/e2e/lively-default.spec.ts guards it.
NATIONAL_FORMATIONS = ("4-3-3", "4-3-3")
NATIONAL_STYLES = ("balanced", "balanced")


def national_clubs():
    squads = json.load(open(NATIONAL_SQUADS, encoding="utf-8"))
    out = []
    for key, nation, color, stadium in NATIONAL:
        s = squads[nation]
        out.append(
            {
                "key": key,
                "club": nation,
                "color": color,
                "stadium": stadium,
                "label": s["label"],
                "squad": [
                    {
                        "name": p["name"],
                        "num": p["shirt"],
                        "pos": p["position"],
                        "rating": p["rating"],
                        "synthetic": True,
                    }
                    for p in s["players"]
                ],
            }
        )
    return out


def national_fixtures(season):
    """One Argentina v Brazil fixture. No recorded match exists: the score is [0, 0] only because the
    shell needs an array, so it is not a result, and the fixture is flagged. The venue name and city
    come from a season fixture at the same stadium index, so the labels match the 3D stadium. The tactics do not:
    they are NATIONAL_FORMATIONS / NATIONAL_STYLES."""
    home, away = national_clubs()
    venue = next(fx for fx in season if fx["stIndex"] == MSI_STADIUM[home["stadium"]])
    setup = dict(venue["setup"], seed=NATIONAL_SEED)
    history = json.load(open(NATIONAL_HISTORY, encoding="utf-8"))
    return [
        {
            "id": "N001",
            "matchday": "National",
            "date": "",
            "national": True,
            "label": home["label"],
            "home": {k: home[k] for k in ("key", "club", "color", "stadium")},
            "away": {k: away[k] for k in ("key", "club", "color", "stadium")},
            "score": [0, 0],
            "stIndex": MSI_STADIUM[home["stadium"]],
            "setup": setup,
            "history": history,
            "formations": list(NATIONAL_FORMATIONS),
            "styles": list(NATIONAL_STYLES),
            "result": None,
        }
    ]


# Federation and competition names are trademarks. The copied engine sources are read-only, so their user-facing wording is neutralised
# here, on the way out; the guard below fails the build if any such name is left (the same list is checked by tests/e2e/neutral-names.spec.ts).
NEUTRAL = [
    ("A FIFA cooling break", "A cooling break"),
    ("FIFA cooling breaks", "Cooling breaks"),
    ("FIFA protocol", "Lightning protocol"),
    ("FIFA heat protocol", "Heat protocol"),
    ("above FIFA\\'s 32", "above the 32"),
    ("(8 miles, FIFA)", "(8 miles)"),
    ("FIFA-style dynamic cam", "Broadcast-style dynamic cam"),
    ("so La Liga kicks off", "so league matches kick off"),
    ("World Cup level", "top international level"),
    ("at a World Cup", "at a major tournament"),
    ("IFAB Law", "Law"),
    # before kick-off the fixture's clubs are not applied yet, so the pre-match caption and kick-off line must not name a season club
    ("Players are out. Harbor City kick off.", "Players are out. Kick-off to come."),
    ("TEAMS[0].club + ' get us under way.'", "'Both sides get us under way.'"),
]
BANNED = r"\b(FIFA|UEFA|IFAB|CONMEBOL|CONCACAF|World Cup|La Liga|Premier League|Champions League|Bundesliga|Serie A)\b"


def neutral(text, label):
    for old, new in NEUTRAL:
        text = text.replace(old, new)
    left = sorted(set(re.findall(BANNED, text, re.I)))
    assert not left, label + ": federation or competition names left in the build: " + ", ".join(left)
    return text


def write(path, text):
    if path.endswith(".html"):
        text = neutral(text, path.replace(U, ""))
    if path.endswith(".html") and not text.lstrip().lower().startswith("<!doctype"):
        text = (
            "<!doctype html>\n" + text
        )  # the source heads have none; without it the page renders in quirks mode
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w", encoding="utf-8").write(text)
    print(path.replace(U, ""), len(text))


def copy_data(dst):
    os.makedirs(dst, exist_ok=True)
    for f in glob.glob(AD + "*.json"):
        shutil.copy(f, dst + os.path.basename(f))


def build(out_root):
    write(out_root + "watch/index.html", build_watch())
    write(out_root + "broadcast/index.html", build_broadcast())
    write(out_root + "analyst/index.html", build_analyst())
    copy_data(out_root + "analyst/data/")
    # what-if clips (whatif/clips, written by services/simulation/run.cjs and whatif/build_index.py)
    os.makedirs(out_root + "analyst/data/whatif", exist_ok=True)
    for f in glob.glob(U + "whatif/clips/*.json"):
        shutil.copy(f, out_root + "analyst/data/whatif/" + os.path.basename(f))
    os.makedirs(out_root + "shared", exist_ok=True)
    shutil.copy(W + "players.json", out_root + "shared/players.json")
    shutil.copy(W + "intl.json", out_root + "shared/intl.json")
    # optional Data platform assets (EXP-13): fabric-dashboard.mp4/.png, model-card.json
    for f in sorted(glob.glob(U + "platform-assets/*")):
        shutil.copy(f, out_root + "shared/" + os.path.basename(f))
    season = fixtures()
    write(
        out_root + "shared/fixtures.json",
        json.dumps(season + national_fixtures(season), ensure_ascii=False, separators=(",", ":")),
    )
    clubs = json.load(open(AD + "league.json"))["clubs"] + national_clubs()
    keys = [c["key"] for c in clubs]
    assert len(keys) == len(set(keys)), "a national key clashes with a season club"
    write(
        out_root + "shared/clubs.json",
        json.dumps({"clubs": clubs}, ensure_ascii=False, separators=(",", ":")),
    )


CONFIG = (
    "// MATCHCAST_API is the live agent api base URL. Empty keeps the in-page rules agents\n"
    '// ("Offline (simulated)"). build.py --api <url> rewrites this file.\n'
    "window.MATCHCAST_API = %s;\n"
)

if __name__ == "__main__":
    args = sys.argv[1:]
    api = ""
    if "--api" in args:
        k = args.index("--api")
        api = args[k + 1].rstrip("/")
        del args[k : k + 2]
        assert api.startswith(("http://", "https://")), "--api needs an http(s) URL"
    open(U + "config.js", "w").write(CONFIG % json.dumps(api))
    build(U)
    if args:
        # local test copy: three.js from node_modules, no Google Fonts
        dst = args[0].rstrip("/") + "/"
        build(dst)
        for f in ["watch/index.html", "broadcast/index.html", "analyst/index.html"]:
            t = open(dst + f, encoding="utf-8").read().replace(CDN, "/node_modules/three/")
            t = "\n".join(ln for ln in t.split("\n") if "fonts.googleapis" not in ln)
            open(dst + f, "w", encoding="utf-8").write(t)
        # the shell and its scripts, hand-written
        shell = ["index.html", "langs.js", "contracts.js", "agents.js", "feed.js", "highlights.js", "live.js", "trace-panel.js", "crew.js", "crew-analyst-shots.js", "crew-analyst-momentum.js", "crew-analyst-ppda.js", "crew-analyst-progressive.js", "crew-analyst-shape.js", "crew-analyst-radar.js", "maps.js", "crew-analyst.js", "crew-score.js", "crew-tree.js"]
        shell += ["speech.js", "status.js", "voice.js", "voices.json"]
        for f in shell + ["config.js"]:
            shutil.copy(U + f, dst + f)
        print("local copy", dst)
