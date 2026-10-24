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


# EXP-4: the language picker offers English, Spanish and Hindi.
# The other prototype languages are labelled Planned.
LANG_OLD = "+ n + '</button>').join('')"
LANG_NEW = (
    """+ n + (['en', 'es', 'hi'].includes(k) ? '' : ' <small class=fm-planned>Planned</small>')"""
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
    main = sub(main, "'./players.json'", "'../shared/players.json'", "watch players path")
    main = sub(main, "'./intl.json'", "'../shared/intl.json'", "watch intl path")
    main = sub(main, "[3, 5, 10, 45].forEach", "[3, 5, 10, 15, 45].forEach", "watch half chips")
    main = sub(main, LANG_OLD, LANG_NEW, "watch language labels")
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
        + '<script type="module">\n'
        + main
        + "\n"
        + r(EMB + "hook.js")
        + "\n"
        + r(EMB + "roles.js")
        + "\n"
        + r(EMB + "watch.js")
        + "\n"
        + r(EMB + "vision-crops.js")
        + "\n"
        + r(EMB + "vision-events.js")
        + "\n"
        + r(EMB + "indices.js")
        + "\n"
        + r(EMB + "feed.js")
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
    main = sub(main, "bcNewMatch(q.get('seed'));", "bcEmbedStart(q);", "broadcast start")
    # decided languages are English, Spanish and Hindi; the desk's Tamil drafts are dropped (embed/bclang.js writes and re-checks es and hi)
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
    head = head.replace("</style>", r(BS + "bc.css") + "\n</style>", 1)
    return (
        head
        + sub(
            r(BS + "bc-body.html"),
            '<button data-l="ta" aria-pressed="false">தமிழ்</button>',
            '<button data-l="es" aria-pressed="false">ES</button><button data-l="hi" aria-pressed="false">हिन्दी</button>',
            "broadcast language buttons",
        )
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
        + "\n</script>\n</body>\n</html>\n"
    )


# ---------- Analyst: the enterprise console (same build as enterprise-console/build.py)
# plus the shell hook
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
    return r(AS + "head.html") + '<script>\n"use strict";\n' + js + "</script>\n"


def fixtures():
    L = json.load(open(AD + "league.json"))
    clubs = {c["key"]: c for c in L["clubs"]}
    MSI = {
        "london": 0,
        "madrid": 1,
        "rio": 2,
        "milan": 3,
        "mexico": 4,
    }  # same stadium order as the 3D engine's STADIUMS
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
                "stIndex": MSI[h["stadium"]],
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


def write(path, text):
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
    os.makedirs(out_root + "shared", exist_ok=True)
    shutil.copy(W + "players.json", out_root + "shared/players.json")
    shutil.copy(W + "intl.json", out_root + "shared/intl.json")
    # optional Data platform assets (EXP-13): fabric-dashboard.mp4/.png, model-card.json
    for f in sorted(glob.glob(U + "platform-assets/*")):
        shutil.copy(f, out_root + "shared/" + os.path.basename(f))
    write(
        out_root + "shared/fixtures.json",
        json.dumps(fixtures(), ensure_ascii=False, separators=(",", ":")),
    )
    write(
        out_root + "shared/clubs.json",
        json.dumps(
            {"clubs": json.load(open(AD + "league.json"))["clubs"]},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
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
        shell = ["index.html", "contracts.js", "agents.js", "feed.js", "live.js", "trace-panel.js"]
        shell += ["speech.js", "status.js", "voice.js", "voices.json"]
        for f in shell + ["config.js"]:
            shutil.copy(U + f, dst + f)
        print("local copy", dst)
