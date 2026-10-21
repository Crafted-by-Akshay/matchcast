// ===================================================================================================
// 55_ds2.js: Data science, part 2. Notebooks, Model lab, Player similarity, Tracking lab and the
// Data Scientist agent. Private names use the d2_ prefix. Every number is computed in this browser
// from D (match events, team totals, tracking frames and player aggregates).
// ===================================================================================================
(function () {
  const s = document.createElement('style');
  s.textContent = `
.d2-src{font:500 11px/1.5 var(--f-mono);color:var(--muted);margin-top:8px}
.d2-prod{border:1px dashed var(--line-2);border-radius:var(--r);padding:8px 12px;font-size:12.5px;color:var(--ink-2);background:var(--surface-2);margin:0 0 14px}
.d2-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.d2-row .sp{flex:1}
.d2-nb{display:flex;flex-direction:column;gap:12px;min-width:0}
.d2-cell{border:1px solid var(--line);border-radius:var(--r);background:var(--surface);min-width:0;overflow:hidden}
.d2-cell-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 10px;border-bottom:1px solid var(--line);background:var(--surface-2);font:500 11px var(--f-mono);color:var(--muted)}
.d2-cell-h .sp{flex:1}
.d2-in{color:var(--accent);min-width:54px}
.d2-md{padding:12px 14px;font-size:14px;line-height:1.55;color:var(--ink-2);min-width:0}
.d2-md h3{font:700 22px/1.1 var(--f-disp);letter-spacing:.02em;margin:0 0 6px;color:var(--ink)}
.d2-md h4{font:600 15px var(--f-body);margin:10px 0 4px;color:var(--ink)}
.d2-md p{margin:0 0 8px}
.d2-md ul{margin:0 0 8px;padding-left:18px}
.d2-md code{font:12px var(--f-mono);background:var(--surface-3);border-radius:4px;padding:1px 4px}
.d2-code{margin:0;padding:10px 12px;font:12.5px/1.55 var(--f-mono);color:var(--ink);background:var(--surface-2);overflow-x:auto;white-space:pre;tab-size:2}
.d2-out{padding:10px 12px;border-top:1px dashed var(--line-2);min-width:0;overflow-x:auto}
.d2-out-h{font:500 11px var(--f-mono);color:var(--muted);margin-bottom:8px}
.d2-tbox{width:100%;min-height:120px;font:13px/1.5 var(--f-mono);resize:vertical;padding:8px 9px}
.d2-chat{display:flex;flex-direction:column;gap:12px;min-height:280px;max-height:500px;overflow-y:auto;padding:2px}
.d2-q{align-self:flex-end;background:var(--accent-soft);border-radius:10px 10px 2px 10px;padding:8px 11px;max-width:85%;font-size:13.5px;overflow-wrap:anywhere}
.d2-a{align-self:flex-start;background:var(--surface-2);border:1px solid var(--line);border-radius:10px 10px 10px 2px;padding:10px 12px;max-width:96%;font-size:13.5px;line-height:1.55;min-width:0;overflow-wrap:anywhere;white-space:pre-wrap}
.d2-a .d2-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center}
.d2-ask{display:flex;gap:8px;margin-top:12px}
.d2-ask input{flex:1;min-width:0}
.d2-sugg{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.d2-sugg button{background:var(--surface-2);border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:12px;color:var(--ink-2)}
.d2-sugg button:hover{background:var(--surface-3)}
.d2-tool{padding:9px 0;border-bottom:1px solid var(--line);font-size:12.5px}
.d2-tool:last-child{border-bottom:0}
.d2-tool code{font:11.5px var(--f-mono);color:var(--accent)}
.d2-tool p{margin:3px 0 0;color:var(--muted)}
.d2-scrub{width:100%;accent-color:var(--accent);margin:6px 0 2px}
.d2-sel{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--ink-2)}
.d2-pitchbox{max-width:760px;margin:0 auto}
.d2-note-l{font:600 10.5px var(--f-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
@media (max-width:640px){.d2-a{max-width:100%}.d2-q{max-width:94%}.d2-ask{flex-wrap:wrap}.d2-ask .btn{width:100%}}
`;
  document.head.appendChild(s);
})();

// ---------------------------------------------------------------- page state (survives re-renders)
const d2_S = {
  nb: { book: 'xg', club: 'HAR', edits: {}, loaded: false, editing: null },
  mdl: { frac: 0.7, last: null },
  sim: { p: null, x: 'passes', y: 'passPct' },
  trk: { mid: null, fi: 0, spr: { k: 'dist', dir: 'desc' }, cur: null },
  agt: { log: [], busy: false },
};
const D2_CL = ['#2F6FDE', '#16A34A', '#D97706', '#9333EA'];
const D2_PG = { eng: '#D97706', act: '#16A34A', base: '#8A8F98' };

// the fifth agent. core's AGENTS table has four; registering it here lets askAgent name it in the audit trail
const d2_AGENT = { name: 'Data Scientist', icon: 'DS', role: 'Answers season questions from the match, team and player data, with tool calls', color: '#0E7490' };
AGENTS['Data Scientist'] = d2_AGENT;

// ---------------------------------------------------------------- helpers
const d2_sig = (z) => 1 / (1 + Math.exp(-z));
function d2_rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function d2_safe(label, fn) {
  try { return fn(); } catch (e) { console.error(e); return '<div class="empty">' + esc(label) + ' could not be computed in this view. ' + esc(e.message) + '</div>'; }
}
const d2_card = (title, sub, fn, acts, cls) => card(title, sub ? esc(sub) : '', d2_safe(title, fn), acts, cls);
const d2_src = (t) => '<div class="d2-src">' + esc(t) + '</div>';
const d2_prod = (t) => '<div class="d2-prod">' + esc(t) + '</div>';
const d2_mins = (m) => {
  if (m._d2min) return m._d2min;
  const ft = (m.events || []).find((e) => e.type === 'full_time');
  return (m._d2min = ft ? Math.round(ft.minute) : 90);
};
const d2_ms = (t0) => Math.max(1, Math.round(performance.now() - t0));
function d2_gchip(run) {
  if (!run) return '';
  if (run.ground && !run.ground.rule) return groundChip(run.ground);
  return chip('Rules · computed from data', 'info');
}

// ---------------------------------------------------------------- shots: one row per shot, goal label from the goal events
// goal = a non-own-goal goal event for the same team and player within 0.6 minutes. Goals with no shot record are counted, not modelled.
function d2_shotsOf(m) {
  if (m._d2sh) return m._d2sh;
  const ev = m.events || [];
  const goals = ev.filter((e) => e.type === 'goal' && !e.ownGoal);
  const used = new Set();
  const out = ev.filter((e) => e.type === 'shot' && e.ax != null && e.ay != null).map((e) => {
    const dx = 105 - e.ax;
    // visible angle between the two posts (goal mouth 7.32 m wide, centred on y = 34 at x = 105)
    const ang = Math.abs(Math.atan2(37.66 - e.ay, dx) - Math.atan2(30.34 - e.ay, dx));
    return { mid: m.id, date: m.date, team: e.team, player: e.player, minute: e.minute, kind: e.kind || 'open play', phase: e.phase || 'unknown', x: e.ax, y: e.ay, dist: Math.hypot(dx, 34 - e.ay), ang, xg: e.xg || 0, goal: false };
  });
  for (const sh of out) {
    const gi = goals.findIndex((g, j) => !used.has(j) && g.team === sh.team && g.player === sh.player && Math.abs(g.minute - sh.minute) <= 0.6);
    if (gi >= 0) { used.add(gi); sh.goal = true; }
  }
  m._d2orph = goals.length - used.size;
  return (m._d2sh = out);
}
const d2_allShots = () => D.matches.flatMap(d2_shotsOf);

// ================================================================ NOTEBOOKS
// Python cells are shown as the equivalent code. Their output is computed here, in JS, from the same data.
function d2_nbXgTeams() {
  const S = d2_allShots();
  const rows = D.clubs.map((c) => {
    const sh = S.filter((s) => s.team === c.key);
    const ms = D.matches.filter((m) => m.home === c.key || m.away === c.key);
    return { key: c.key, n: ms.length, sh: sh.length, xg: sum(sh, (s) => s.xg), g: sh.filter((s) => s.goal).length, sc: sum(ms, (m) => m.score[m.home === c.key ? 0 : 1]) };
  }).filter((r) => r.sh > 0).sort((a, b) => b.xg - a.xg);
  const orph = sum(D.matches, (m) => (d2_shotsOf(m), m._d2orph));
  return tbl([
    { k: 'key', l: 'Club', f: (r) => clubTag(r.key) },
    { k: 'sh', l: 'Shots', r: true },
    { k: 'xg', l: 'Shot-event xG', r: true, f: (r) => fmt(r.xg, 2) },
    { k: 'g', l: 'Goals (matched)', r: true },
    { k: 'gx', l: 'Matched goals − xG', r: true, f: (r) => (r.g - r.xg >= 0 ? '+' : '') + fmt(r.g - r.xg, 2) },
    { k: 'sc', l: 'Goals in score', r: true },
    { k: 'xpm', l: 'xG per shot', r: true, f: (r) => fmt(r.sh ? r.xg / r.sh : 0, 3) },
  ], rows, { id: 'd2-nb-t1' }) + d2_src('Goals with no shot record in the feed: ' + orph + ', so they count in "Goals in score" only. Shot-event xG is below the engine’s team xG (season table) for every club: the engine counts some xG with no shot event in the feed.');
}
function d2_nbXgBands() {
  const S = d2_allShots();
  const bands = [[0, 0.05, '0.00 to 0.05'], [0.05, 0.1, '0.05 to 0.10'], [0.1, 0.2, '0.10 to 0.20'], [0.2, 0.4, '0.20 to 0.40'], [0.4, 1.01, '0.40 and up']];
  const rows = bands.map(([lo, hi, l]) => {
    const xs = S.filter((s) => s.xg >= lo && s.xg < hi);
    return { l, n: xs.length, mx: avg(xs, (s) => s.xg), rate: xs.length ? xs.filter((s) => s.goal).length / xs.length : 0 };
  });
  return tbl([
    { k: 'l', l: 'xG band' },
    { k: 'n', l: 'Shots', r: true },
    { k: 'mx', l: 'Mean xG', r: true, f: (r) => fmt(r.mx, 3) },
    { k: 'rate', l: 'Goal rate', r: true, f: (r) => fmt(r.rate * 100, 1) + '%' },
    { k: 'gap', l: 'Rate − mean xG', r: true, f: (r) => (((r.rate - r.mx) * 100 >= 0) ? '+' : '') + fmt((r.rate - r.mx) * 100, 1) + ' pts' },
  ], rows.map((r) => Object.assign(r, { gap: r.rate - r.mx })), { id: 'd2-nb-t2' }) + d2_src('Source: ' + S.length + ' shots, ax/ay positions, engine xG per shot. A band above zero is under-rated by the engine.');
}
// completed passes, season, one club. Node = average origin of the player's passes (attacking right).
function d2_passAgg(club) {
  const edges = new Map(), nodes = {};
  const node = (n) => nodes[n] || (nodes[n] = { name: n, made: 0, recv: 0, sx: 0, sy: 0, partners: new Set() });
  for (const m of D.matches) for (const e of m.events || []) {
    if (e.type !== 'pass' || e.team !== club || !e.player || !e.to) continue;
    const k = e.player + ' > ' + e.to; edges.set(k, (edges.get(k) || 0) + 1);
    const a = node(e.player); a.made++; a.sx += e.ax ?? 0; a.sy += e.ay ?? 0; a.partners.add(e.to);
    const b = node(e.to); b.recv++; b.partners.add(e.player);
  }
  const pairs = [...edges].map(([k, n]) => { const [a, b] = k.split(' > '); return { a, b, n }; }).sort((x, y) => y.n - x.n);
  return { pairs, nodes: Object.values(nodes).map((n) => Object.assign(n, { partners: n.partners.size, ax: n.made ? n.sx / n.made : 0, ay: n.made ? n.sy / n.made : 0 })).sort((x, y) => y.made - x.made) };
}
function d2_nbPassNet() {
  const club = d2_S.nb.club, A = d2_passAgg(club), col = ccol(club);
  if (!A.pairs.length) return '<div class="empty">No passes for this club in the feed.</div>';
  const pl = A.nodes.filter((n) => n.made >= 5); const by = new Map(pl.map((n) => [n.name, n]));
  const und = new Map(); for (const p of A.pairs) { const k = [p.a, p.b].sort().join(' | '); und.set(k, (und.get(k) || 0) + p.n); }
  const mx = Math.max(1, ...und.values()), mm = Math.max(1, ...pl.map((n) => n.made));
  let inner = '';
  for (const [k, n] of und) {
    const [a, b] = k.split(' | '); const P = by.get(a), Q = by.get(b); if (!P || !Q) continue;
    inner += '<line x1="' + P.ax.toFixed(1) + '" y1="' + P.ay.toFixed(1) + '" x2="' + Q.ax.toFixed(1) + '" y2="' + Q.ay.toFixed(1) + '" style="stroke:' + col + ';stroke-opacity:.55;stroke-width:' + (0.4 + (3.6 * n) / mx).toFixed(2) + ';stroke-linecap:round"><title>' + esc(a + ' and ' + b + ': ' + n + ' passes') + '</title></line>';
  }
  for (const p of pl) {
    inner += '<circle cx="' + p.ax.toFixed(1) + '" cy="' + p.ay.toFixed(1) + '" r="' + (2 + (2.5 * p.made) / mm).toFixed(2) + '" style="fill:' + col + ';stroke:#fff;stroke-width:.5px"><title>' + esc(p.name + ': ' + p.made + ' passes made') + '</title></circle>';
    inner += '<text x="' + p.ax.toFixed(1) + '" y="' + (p.ay - 3.4).toFixed(1) + '" text-anchor="middle" style="font:600 2.6px var(--f-body);fill:#fff;paint-order:stroke;stroke:#000;stroke-opacity:.6;stroke-width:.5px">' + esc(p.name.split(' ').slice(-1)[0]) + '</text>';
  }
  const top = A.pairs.slice(0, 8);
  return pitch(inner, { title: clubName(club) + ' pass network' }) +
    tbl([{ k: 'a', l: 'From' }, { k: 'b', l: 'To' }, { k: 'n', l: 'Passes', r: true }], top, { id: 'd2-nb-pairs' }) +
    d2_src('Output: ' + A.pairs.reduce((s, p) => s + p.n, 0) + ' completed passes for ' + clubName(club) + ' in the season feed. Nodes with 5+ passes are drawn.');
}
function d2_nbCentral() {
  const club = d2_S.nb.club, A = d2_passAgg(club);
  if (!A.nodes.length) return '<div class="empty">No passes for this club in the feed.</div>';
  const rows = A.nodes.map((n) => Object.assign({}, n, { share: pct(n.made, sum(A.nodes, (x) => x.made)) }));
  return tbl([
    { k: 'name', l: 'Player' },
    { k: 'made', l: 'Passes made', r: true },
    { k: 'recv', l: 'Received', r: true },
    { k: 'partners', l: 'Distinct partners', r: true },
    { k: 'share', l: 'Share of passes', r: true, f: (r) => r.share + '%' },
    { k: 'ax', l: 'Avg x (m)', r: true, f: (r) => fmt(r.ax, 1) },
    { k: 'ay', l: 'Avg y (m)', r: true, f: (r) => fmt(r.ay, 1) },
  ], rows, { id: 'd2-nb-cen' }) + d2_src('Source: pass events, season. Average position uses each pass origin (ax, ay).');
}
function d2_nbPressTable() {
  const rows = D.clubs.map((c) => {
    const ms = D.matches.filter((m) => m.home === c.key || m.away === c.key);
    if (!ms.length) return null;
    const pp = ms.map((m) => m.ts[c.key].ppda).filter((v) => v != null);
    return { key: c.key, n: ms.length, ppda: pp.length ? avg(pp) : null, hw: avg(ms, (m) => m.ts[c.key].highWins), tk: avg(ms, (m) => m.ts[c.key].tackles), fo: avg(ms, (m) => m.ts[c.key].fouls) };
  }).filter(Boolean).sort((a, b) => (a.ppda ?? 99) - (b.ppda ?? 99));
  return tbl([
    { k: 'key', l: 'Club', f: (r) => clubTag(r.key) },
    { k: 'n', l: 'Matches', r: true },
    { k: 'ppda', l: 'PPDA', r: true, f: (r) => (r.ppda == null ? '–' : fmt(r.ppda, 1)), t: 'Passes allowed per defensive action. Lower means more intense pressing.' },
    { k: 'hw', l: 'Ball wins, final third / match', r: true, f: (r) => fmt(r.hw, 1) },
    { k: 'tk', l: 'Tackles / match', r: true, f: (r) => fmt(r.tk, 1) },
    { k: 'fo', l: 'Fouls / match', r: true, f: (r) => fmt(r.fo, 1) },
  ], rows, { id: 'd2-nb-pr' }) + d2_src('Source: m.ts[club].ppda, highWins, tackles and fouls, averaged per match. PPDA is derived in core from the event stream.');
}
function d2_nbPressBands() {
  const bands = [[0, 30, "0–30'"], [30, 60, "30–60'"], [60, 300, "60'+"]];
  const rows = D.clubs.map((c) => {
    const n = D.matches.filter((m) => m.home === c.key || m.away === c.key).length;
    if (!n) return null;
    const wins = D.matches.flatMap((m) => (m.events || []).filter((e) => e.type === 'turnover' && e.team === c.key && (e.ax ?? 0) > 70));
    const r = { key: c.key, all: wins.length / n };
    bands.forEach(([lo, hi], i) => { r['b' + i] = wins.filter((e) => e.minute >= lo && e.minute < hi).length / n; });
    return r;
  }).filter(Boolean).sort((a, b) => b.all - a.all);
  return tbl([
    { k: 'key', l: 'Club', f: (r) => clubTag(r.key) },
    ...bands.map(([, , l], i) => ({ k: 'b' + i, l: l + ' / match', r: true, f: (r) => fmt(r['b' + i], 1) })),
    { k: 'all', l: 'All / match', r: true, f: (r) => fmt(r.all, 1) },
  ], rows, { id: 'd2-nb-pb' }) + d2_src('Source: turnover events with ax above 70 (the team won the ball in the opponent’s final third), per match played.');
}

const d2_NB = [
  { id: 'xg', title: 'xG calibration', cells: [
    { id: 'xg-md1', t: 'md', text: '# xG calibration\nDo the engine’s shot xG values match the goals scored? This notebook checks it team by team, then by xG band. Both tables run on the shot events in the season feed.' },
    { id: 'xg-c1', t: 'code', run: d2_nbXgTeams, py: `import pandas as pd

# one row per shot, from the event lake (xg from the engine, goal from the goal events)
shots = pd.read_parquet("events/shots.parquet")
teams = shots.groupby("team").agg(shots=("xg", "size"), xg=("xg", "sum"), goals=("goal", "sum"))
teams["goals_minus_xg"] = teams["goals"] - teams["xg"]
teams.sort_values("xg", ascending=False).round(2)` },
    { id: 'xg-c2', t: 'code', run: d2_nbXgBands, py: `bands = pd.cut(shots["xg"], [0, .05, .10, .20, .40, 1.0], right=False)
(shots.groupby(bands, observed=True)
      .agg(shots=("xg", "size"), mean_xg=("xg", "mean"), goal_rate=("goal", "mean"))
      .round(3))` },
    { id: 'xg-md2', t: 'md', text: '## Reading it\n- A band whose goal rate sits above its mean xG is under-rated by the engine.\n- **Goals with no shot record** in the feed cannot be matched to a shot. They stay in the score and drop out of the matched goal rate.' },
  ] },
  { id: 'pass', title: 'Pass network metrics', cells: [
    { id: 'pn-md1', t: 'md', text: '# Pass network metrics\nCompleted passes between players for the club picked in the filter above. A node sits at the average origin of that player’s passes. Line width is the number of passes between the two players.' },
    { id: 'pn-c1', t: 'code', run: d2_nbPassNet, py: `club = "HAR"   # from the club filter
passes = events[(events.type == "pass") & (events.team == club)]
edges = (passes.groupby(["player", "to"]).size()
         .rename("passes").reset_index()
         .sort_values("passes", ascending=False))
pos = passes.groupby("player").agg(made=("player", "size"), x=("ax", "mean"), y=("ay", "mean"))
edges.head(8)` },
    { id: 'pn-c2', t: 'code', run: d2_nbCentral, py: `made = passes.groupby("player").size().rename("made")
recv = events[(events.type == "pass") & (events.team == club)].groupby("to").size().rename("recv")
partners = passes.groupby("player")["to"].nunique().rename("partners")
central = pd.concat([made, recv, partners], axis=1).fillna(0)
central["share"] = (100 * central["made"] / central["made"].sum()).round(1)
central.sort_values("made", ascending=False)` },
    { id: 'pn-md2', t: 'md', text: '## Limits\n- The network uses completed passes only. Failed passes show up as turnovers, not as edges.\n- Averages use the season, so a formation change will blur the shape.' },
  ] },
  { id: 'press', title: 'Pressing profile by club', cells: [
    { id: 'pp-md1', t: 'md', text: '# Pressing profile by club\nPPDA (passes allowed per defensive action) is the usual measure of pressing intensity. Lower means the team pressed harder. The second table shows where each club wins the ball high up.' },
    { id: 'pp-c1', t: 'code', run: d2_nbPressTable, py: `tm = pd.read_parquet("team_match.parquet")   # m.ts per club per match
press = (tm.groupby("team")
           .agg(matches=("match_id", "nunique"), ppda=("ppda", "mean"),
                high_wins=("highWins", "mean"), tackles=("tackles", "mean"), fouls=("fouls", "mean"))
           .sort_values("ppda"))
press.round(2)` },
    { id: 'pp-c2', t: 'code', run: d2_nbPressBands, py: `wins = events[(events.type == "turnover") & (events.ax > 70)]
wins["band"] = pd.cut(wins["minute"], [0, 30, 60, 300], right=False,
                      labels=["0-30", "30-60", "60+"])
per_match = wins.groupby(["team", "band"], observed=True).size() / tm.groupby("team").size()
per_match.unstack().round(1)` },
    { id: 'pp-md2', t: 'md', text: '## Next\n- Add a press-success metric: passes allowed in the 5 seconds after a regain. The feed does not carry that timing yet.' },
  ] },
];

function d2_md(t) {
  const inl = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
  let out = '', list = false;
  const close = () => { if (list) { out += '</ul>'; list = false; } };
  for (const raw of String(t || '').split('\n')) {
    const l = raw.trim();
    if (!l) { close(); continue; }
    if (l.startsWith('# ')) { close(); out += '<h3>' + inl(l.slice(2)) + '</h3>'; }
    else if (l.startsWith('## ')) { close(); out += '<h4>' + inl(l.slice(3)) + '</h4>'; }
    else if (l.startsWith('- ')) { if (!list) { out += '<ul>'; list = true; } out += '<li>' + inl(l.slice(2)) + '</li>'; }
    else { close(); out += '<p>' + inl(l) + '</p>'; }
  }
  close(); return out;
}
function d2_nbBook() { return d2_NB.find((b) => b.id === d2_S.nb.book) || d2_NB[0]; }
function d2_nbCellHtml(c, n) {
  let html;
  const t0 = performance.now();
  try { html = c.run(); } catch (e) { console.error(e); html = '<div class="empty">This cell could not run. ' + esc(e.message) + '</div>'; }
  return '<div class="d2-cell"><div class="d2-cell-h"><span class="d2-in">In [' + n + ']</span><span>Python · pandas (shown here, computed in JS)</span><span class="sp"></span><button class="btn sm" data-act="run" data-c="' + c.id + '">Run</button></div>' +
    '<pre class="d2-code">' + esc(c.py) + '</pre>' +
    '<div class="d2-out" id="d2-o-' + c.id + '"><div class="d2-out-h">Out [' + n + '] · computed in this browser in ' + d2_ms(t0) + ' ms</div>' + html + '</div></div>';
}
function d2_nbMdHtml(c) {
  const ed = d2_S.nb.edits[c.id]; const text = ed ? ed.text : c.text; const editing = d2_S.nb.editing === c.id;
  return '<div class="d2-cell"><div class="d2-cell-h"><span class="d2-in">Markdown</span><span class="sp"></span>' + (ed ? chip('Edited by ' + esc(ed.by)) : '') +
    (editing ? '' : '<button class="btn sm" data-act="edit" data-c="' + c.id + '">Edit' + lockBtn('author') + '</button>') + '</div>' +
    (editing
      ? '<div class="d2-md"><div class="field"><textarea class="d2-tbox" id="d2-ta-' + c.id + '" aria-label="Markdown cell text">' + esc(text) + '</textarea></div><div class="d2-row" style="margin-top:8px"><button class="btn pri sm" data-act="save" data-c="' + c.id + '">Save' + lockBtn('author') + '</button><button class="btn sm ghost" data-act="cancel">Cancel</button></div></div>'
      : '<div class="d2-md">' + d2_md(text) + '</div>') + '</div>';
}
function d2_nbDraw(el) {
  const B = d2_nbBook();
  const head = pgHead('Notebooks', 'Source: match events, team totals and pass events in D.matches. Python cells show the code. The output is computed here from that data when you press Run.',
    seg('d2-nb-book', d2_NB.map((b) => [b.id, b.title]), B.id));
  const clubs = D.clubs.map((c) => '<option value="' + c.key + '"' + (c.key === d2_S.nb.club ? ' selected' : '') + '>' + esc(c.club) + '</option>').join('');
  el.innerHTML = head +
    d2_prod('Demo notebook. Runs in the browser with precomputed output. Production: Azure Databricks or Fabric notebooks.') +
    '<div class="filters"><div class="field"><label for="d2-nb-club">Club for the pass network</label><select id="d2-nb-club">' + clubs + '</select></div>' +
    '<div class="field" style="justify-content:flex-end"><span class="note">' + esc(B.title) + ' · ' + B.cells.filter((c) => c.t === 'code').length + ' code cells</span></div></div>' +
    '<div class="d2-nb">' + B.cells.map((c, i) => (c.t === 'md' ? d2_nbMdHtml(c) : d2_nbCellHtml(c, i + 1))).join('') + '</div>';
  bindSeg(el, 'd2-nb-book', (v) => { d2_S.nb.book = v; d2_S.nb.editing = null; d2_nbDraw(el); });
  el.onchange = (e) => { if (e.target.id === 'd2-nb-club') { d2_S.nb.club = e.target.value; d2_nbDraw(el); } };
  el.onclick = (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, cid = b.dataset.c;
    if (act === 'run') { const c = d2_NB.flatMap((x) => x.cells).find((x) => x.id === cid); const out = el.querySelector('#d2-o-' + cid); if (c && out) { const idx = B.cells.indexOf(c) + 1; out.innerHTML = '<div class="d2-out-h">Out [' + idx + '] · computed in this browser</div>'; const t0 = performance.now(); let html; try { html = c.run(); } catch (err) { html = '<div class="empty">This cell could not run. ' + esc(err.message) + '</div>'; } out.innerHTML = '<div class="d2-out-h">Out [' + idx + '] · computed in this browser in ' + d2_ms(t0) + ' ms</div>' + html; } }
    if (act === 'edit') { if (!gate('author', 'notebook text')) return; d2_S.nb.editing = cid; d2_nbDraw(el); const ta = el.querySelector('#d2-ta-' + cid); if (ta) ta.focus(); }
    if (act === 'cancel') { d2_S.nb.editing = null; d2_nbDraw(el); }
    if (act === 'save') d2_nbSave(el, B, cid);
  };
}
function d2_nbSave(el, B, cid) {
  if (!gate('author', 'notebook text')) return;
  const ta = el.querySelector('#d2-ta-' + cid); const text = ta ? ta.value : '';
  const rec = { text, notebook: B.title, by: me().name, at: new Date().toISOString() };
  d2_S.nb.edits[cid] = rec; d2_S.nb.editing = null;
  sSet('ds_notebooks', cid, Object.assign({ id: cid }, rec)).catch(() => {});
  audit('notebook.edit', cid, B.title + ' · markdown cell · ' + text.length + ' characters');
  d2_nbDraw(el);
  toast('Cell saved. It is shared when the team store is granted, else kept in this browser.');
}
function d2_nbLoad(el) {
  if (d2_S.nb.loaded) return;
  sList('ds_notebooks').then((rows) => {
    d2_S.nb.loaded = true;
    for (const r of rows) if (!d2_S.nb.edits[r.id] && typeof r.text === 'string') d2_S.nb.edits[r.id] = { text: r.text, by: r.by || 'Saved', at: r.at };
    if (el.isConnected && d2_S.nb.editing == null) d2_nbDraw(el);
  }).catch(() => {});
}

// ================================================================ MODEL LAB
const d2_FIT = { seed: 42, steps: 2000, lr: 0.3, l2: 0.01 };
// full-batch gradient descent on the logistic loss. The starting weights come from a seeded generator, so each run is identical.
function d2_fit(X, y) {
  const rnd = d2_rng(d2_FIT.seed); const p = X[0].length; const n = X.length;
  const w = Array.from({ length: p + 1 }, () => (rnd() - 0.5) * 0.02);
  for (let it = 0; it < d2_FIT.steps; it++) {
    const g = new Array(p + 1).fill(0);
    for (let i = 0; i < n; i++) {
      const xi = X[i]; let z = w[0];
      for (let j = 0; j < p; j++) z += w[j + 1] * xi[j];
      const e = d2_sig(z) - y[i]; g[0] += e;
      for (let j = 0; j < p; j++) g[j + 1] += e * xi[j];
    }
    for (let j = 0; j <= p; j++) w[j] -= d2_FIT.lr * (g[j] / n + (j ? d2_FIT.l2 * w[j] : 0));
  }
  return w;
}
const d2_pred = (w, x) => { let z = w[0]; for (let j = 0; j < x.length; j++) z += w[j + 1] * x[j]; return d2_sig(z); };
function d2_logloss(p, y) { return -avg(y.map((v, i) => { const q = clamp(p[i], 1e-6, 1 - 1e-6); return v * Math.log(q) + (1 - v) * Math.log(1 - q); })); }
function d2_brier(p, y) { return avg(y.map((v, i) => (p[i] - v) ** 2)); }
function d2_auc(p, y) {
  const idx = p.map((_, i) => i).sort((a, b) => p[a] - p[b]);
  let i = 0, sr = 0, np = 0;
  while (i < idx.length) {
    let j = i; while (j + 1 < idx.length && p[idx[j + 1]] === p[idx[i]]) j++;
    const r = (i + 1 + j + 1) / 2;
    for (let k = i; k <= j; k++) if (y[idx[k]]) { sr += r; np++; }
    i = j + 1;
  }
  const nn = y.length - np;
  return np && nn ? (sr - (np * (np + 1)) / 2) / (np * nn) : null;
}
function d2_feats(rows) {
  const cnt = {}; rows.forEach((r) => { cnt[r.phase] = (cnt[r.phase] || 0) + 1; });
  const ph = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
  const F = [
    { k: 'dist', l: 'Distance to goal (m)', f: (r) => r.dist },
    { k: 'ang', l: 'Visible goal angle (°)', f: (r) => (r.ang * 180) / Math.PI },
    { k: 'pen', l: 'Kind: penalty', f: (r) => (r.kind === 'penalty' ? 1 : 0) },
    { k: 'fk', l: 'Kind: free kick', f: (r) => (r.kind === 'free kick' ? 1 : 0) },
  ];
  ph.slice(1).forEach((p) => F.push({ k: 'ph:' + p, l: 'Phase: ' + p, f: (r) => (r.phase === p ? 1 : 0) }));
  return { F, phases: ph };
}
function d2_train(frac) {
  const ms = D.matches; const nTr = Math.max(1, Math.round(ms.length * frac));
  const trM = ms.slice(0, nTr), teM = ms.slice(nTr);
  const trR = trM.flatMap(d2_shotsOf), teR = teM.flatMap(d2_shotsOf);
  if (trR.length < 10) return { error: 'Too few training shots (' + trR.length + ') at this split.' };
  const { F, phases } = d2_feats(trR.concat(teR));
  const keep = []; const mu = [], sd = []; const dropped = [];
  F.forEach((f, j) => {
    const v = trR.map(f.f); const m0 = avg(v); const s0 = Math.sqrt(avg(v, (x) => (x - m0) ** 2));
    const ones = sum(v); const dummy = /^(pen|fk|ph:)/.test(f.k);
    if (dummy && ones < 5) { dropped.push(f.l + ' (' + ones + ' in training, needs 5)'); return; }
    if (s0 > 1e-9) { keep.push(j); mu.push(m0); sd.push(s0); } else dropped.push(f.l + ' (no variation)');
  });
  const KF = keep.map((j) => F[j]);
  const X = (rows) => rows.map((r) => KF.map((f, j) => (f.f(r) - mu[j]) / sd[j]));
  const ytr = trR.map((r) => (r.goal ? 1 : 0)), yte = teR.map((r) => (r.goal ? 1 : 0));
  const w = d2_fit(X(trR), ytr);
  const pTe = X(teR).map((x) => d2_pred(w, x));
  const base = avg(ytr);
  const res = { nTr, trM, teM, trainShots: trR.length, testShots: teR.length, goalsTr: sum(ytr), goalsTe: sum(yte), w, KF, dropped, phases, orphan: sum(ms, (m) => (d2_shotsOf(m), m._d2orph)) };
  if (teR.length) {
    const eng = teR.map((r) => clamp(r.xg, 0.001, 0.999));
    res.m = { ll: d2_logloss(pTe, yte), brier: d2_brier(pTe, yte), auc: d2_auc(pTe, yte) };
    res.e = { ll: d2_logloss(eng, yte), brier: d2_brier(eng, yte), auc: d2_auc(eng, yte) };
    res.b = { ll: d2_logloss(teR.map(() => base), yte), brier: d2_brier(teR.map(() => base), yte) };
    const idx = pTe.map((_, i) => i).sort((a, b) => pTe[a] - pTe[b]); const B = 5; res.bins = [];
    for (let b = 0; b < B; b++) {
      const part = idx.slice(Math.floor((b * idx.length) / B), Math.floor(((b + 1) * idx.length) / B));
      if (!part.length) continue;
      res.bins.push({ b: b + 1, n: part.length, mx: avg(part, (i) => pTe[i]), ex: avg(part, (i) => eng[i]), act: avg(part, (i) => yte[i]) });
    }
  }
  const absSum = sum(w.slice(1), (v) => Math.abs(v)) || 1;
  res.coef = KF.map((f, j) => ({ k: f.k, l: f.l, b: w[j + 1], or: Math.exp(w[j + 1]), imp: Math.abs(w[j + 1]) / absSum }));
  res.intercept = w[0];
  return res;
}
async function d2_mdlRegister(el) {
  const res = d2_S.mdl.last;
  if (!res || !res.m) { toast('Nothing to register: the test split has no shots.'); return; }
  if (!gate('author', 'a model version')) return;
  const rows = await sList('ds_models');
  const version = 'xg-logreg-v' + (rows.length + 1);
  const date = new Date().toISOString().slice(0, 10);
  const metrics = { method: 'Logistic regression, full-batch gradient descent', seed: d2_FIT.seed, steps: d2_FIT.steps, learningRate: d2_FIT.lr, l2: d2_FIT.l2, split: Math.round(d2_S.mdl.frac * 100) + '/' + Math.round((1 - d2_S.mdl.frac) * 100), trainMatches: res.nTr, testMatches: D.matches.length - res.nTr, trainShots: res.trainShots, testShots: res.testShots, features: res.coef.map((c) => c.l), testLogloss: +res.m.ll.toFixed(4), testBrier: +res.m.brier.toFixed(4), testAuc: res.m.auc == null ? null : +res.m.auc.toFixed(3), engineLogloss: +res.e.ll.toFixed(4), engineBrier: +res.e.brier.toFixed(4) };
  await sAdd('ds_models', { version, date, metrics });
  audit('model.register', version, 'Split ' + metrics.split + ' · test log-loss ' + metrics.testLogloss + ' · Brier ' + metrics.testBrier + ' · ' + metrics.testShots + ' test shots');
  toast('Registered ' + version + ' in the model catalogue (this workspace). Production registration is planned in Azure Machine Learning.');
  d2_mdlLoadRegs(el);
}
function d2_mdlLoadRegs(el) {
  sList('ds_models').then((rows) => {
    const box = el.querySelector('#d2-regs'); if (!box) return;
    box.innerHTML = rows.length ? tbl([
      { k: 'version', l: 'Version' }, { k: 'date', l: 'Date' },
      { k: 'split', l: 'Split', f: (r) => esc((r.metrics || {}).split || '–') },
      { k: 'shots', l: 'Test shots', r: true, f: (r) => fmt((r.metrics || {}).testShots) },
      { k: 'll', l: 'Test log-loss', r: true, f: (r) => fmt((r.metrics || {}).testLogloss, 3) },
      { k: 'br', l: 'Test Brier', r: true, f: (r) => fmt((r.metrics || {}).testBrier, 3) },
      { k: 'by', l: 'Registered by', f: (r) => esc(r.by || '') },
    ], rows, { id: 'd2-reg-t' }) : '<div class="empty">No model versions registered yet. Register the current fit to add one.</div>';
  }).catch(() => {});
}
function d2_mdlDraw(el) {
  let res;
  try { res = d2_train(d2_S.mdl.frac); } catch (e) { console.error(e); res = { error: e.message }; }
  d2_S.mdl.last = res;
  const acts = seg('d2-mdl-split', [[0.5, '50 / 50'], [0.7, '70 / 30'], [0.8, '80 / 20']], d2_S.mdl.frac) +
    '<button class="btn sm" data-act="csv">Export calibration CSV' + lockBtn('export') + '</button>' +
    '<button class="btn sm pri" data-act="reg">Register version' + lockBtn('author') + '</button>';
  let h = pgHead('Model lab', 'Source: the ' + D.matches.reduce((s, m) => s + d2_shotsOf(m).length, 0) + ' shots in the season feed (D.matches events, ax/ay normalised). Trained and tested in this browser. Chronological split: earliest matches train, latest test.', acts);
  h += d2_prod('Production: Azure Machine Learning, registered in the Foundry model catalogue.');
  if (res.error) { el.innerHTML = h + card('Model', '', '<div class="empty">' + esc(res.error) + '</div>'); return; }
  const m = res.m, e = res.e;
  const f3 = (v) => (v == null ? '–' : fmt(v, 3));
  h += '<div class="kpis">' +
    kpi('Test shots', fmt(res.testShots), res.nTr + ' train matches · ' + res.trainShots + ' train shots') +
    kpi('Model log-loss', m ? f3(m.ll) : '–', m ? 'Engine xG ' + f3(e.ll) + ' · constant ' + f3(res.b.ll) : 'No test shots at this split', m && m.ll <= e.ll ? 'good' : '') +
    kpi('Model Brier', m ? f3(m.brier) : '–', m ? 'Engine xG ' + f3(e.brier) : '') +
    kpi('Model AUC', m && m.auc != null ? f3(m.auc) : '–', m && e.auc != null ? 'Engine xG ' + f3(e.auc) : '') +
    '</div>';
  h += '<div class="grid">' +
    '<div class="s7">' + d2_card('Calibration, test matches', 'Five bins of equal size, sorted by the model’s predicted xG. Points on the grey diagonal are perfectly calibrated.', () => {
      if (!res.bins || !res.bins.length) return '<div class="empty">No test shots at this split.</div>';
      const mx = Math.max(...res.bins.map((b) => Math.max(b.mx, b.ex, b.act)), 0.05) * 1.1;
      const top = niceMax(mx);
      const chart = lineChart({ series: [
        { name: 'Actual goal rate', color: D2_PG.act, pts: res.bins.map((b) => [b.mx, b.act]) },
        { name: 'Engine xG', color: D2_PG.eng, pts: res.bins.map((b) => [b.mx, b.ex]), dash: true },
        { name: 'Perfect calibration', color: D2_PG.base, pts: [[0, 0], [top, top]], dash: true },
      ], marks: res.bins.map((b) => ({ x: b.mx, y: b.act, color: D2_PG.act, title: 'Bin ' + b.b + ': model ' + fmt(b.mx, 3) + ', actual ' + fmt(b.act, 3) })), xMin: 0, xMax: top, yMin: 0, yMax: top, xTicks: [0, top / 2, top], xFmt: (v) => v.toFixed(2), yFmt: (v) => v.toFixed(2), h: 200 });
      return chart + legend([['Actual goal rate', D2_PG.act], ['Engine xG', D2_PG.eng], ['Perfect calibration', D2_PG.base, true]]) +
        tbl([
          { k: 'b', l: 'Bin' }, { k: 'n', l: 'Shots', r: true },
          { k: 'mx', l: 'Model xG', r: true, f: (r) => fmt(r.mx, 3) },
          { k: 'ex', l: 'Engine xG', r: true, f: (r) => fmt(r.ex, 3) },
          { k: 'act', l: 'Actual goals', r: true, f: (r) => fmt(r.act, 3) },
          { k: 'gap', l: 'Actual − model', r: true, f: (r) => (((r.act - r.mx) >= 0) ? '+' : '') + fmt(r.act - r.mx, 3) },
        ], res.bins.map((b) => Object.assign({ gap: b.act - b.mx }, b)), { id: 'd2-cal-t' });
    }, '', 'flat') + '</div>' +
    '<div class="s5">' + d2_card('Feature importance', 'Share of the absolute standardised coefficient. A simple proxy, not SHAP.', () => {
      if (!res.coef.length) return '<div class="empty">No feature varies in the training shots.</div>';
      return hbars(res.coef.slice().sort((a, b) => b.imp - a.imp).map((c) => ({ label: c.l, v: c.imp, color: 'var(--accent)' })), { max: 1, fmt: (v) => fmt(v * 100, 1) + '%' }) +
        d2_src('Intercept ' + fmt(res.intercept, 3) + ' on standardised features. Dropped: ' + (res.dropped.join('; ') || 'none') + '.');
    }) + '</div></div>' +
    '<div class="grid" style="margin-top:14px">' +
    '<div class="s7">' + d2_card('Logistic regression coefficients', 'Standardised coefficients. Odds ratio is the change in goal odds for one standard deviation of the feature.', () => tbl([
      { k: 'l', l: 'Feature' },
      { k: 'b', l: 'Coefficient', r: true, f: (r) => fmt(r.b, 3) },
      { k: 'or', l: 'Odds ratio per SD', r: true, f: (r) => fmt(r.or, 2) },
      { k: 'imp', l: 'Share of weight', r: true, f: (r) => fmt(r.imp * 100, 1) + '%' },
    ], res.coef, { id: 'd2-coef-t' }) + d2_src('Phase values present in this feed: ' + res.phases.join(', ') + '. One value gives no coefficient.')) + '</div>' +
    '<div class="s5">' + d2_card('How this model is fitted', '', () => '<div class="note" style="font-size:13px;line-height:1.6;color:var(--ink-2)">' +
      '<p style="margin:0 0 8px">Logistic regression on ' + res.trainShots + ' training shots, fitted in this browser by gradient descent.</p>' +
      '<ul style="margin:0 0 8px;padding-left:18px"><li>Seed ' + d2_FIT.seed + ' sets the starting weights, so every run gives the same fit.</li><li>' + d2_FIT.steps + ' full-batch steps, learning rate ' + d2_FIT.lr + ', L2 penalty ' + d2_FIT.l2 + ' on the slopes.</li><li>Features are standardised on the training shots only.</li>' +
      '<li>A shot is a goal when a non-own-goal goal event matches its team and player within 0.6 minutes. ' + res.orphan + ' goals have no shot record and are left out.</li></ul>' +
      '<p style="margin:0">Log-loss and Brier are on the test matches only. The engine’s own xG is the baseline to beat.</p></div>') + '</div></div>' +
    '<div class="grid" style="margin-top:14px"><div class="s12">' + d2_card('Registered versions', 'Written with sAdd to ds_models. Versions are kept in this workspace; Azure Machine Learning registration is planned.', () => '<div id="d2-regs"><div class="empty">Loading versions…</div></div>') + '</div></div>';
  el.innerHTML = h;
  bindSeg(el, 'd2-mdl-split', (v) => { d2_S.mdl.frac = +v; d2_mdlDraw(el); });
  el.onclick = (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'reg') d2_mdlRegister(el);
    if (b.dataset.act === 'csv') {
      if (!d2_S.mdl.last || !d2_S.mdl.last.bins) { toast('No calibration table at this split.'); return; }
      const rows = d2_S.mdl.last.bins.map((x) => ({ bin: x.b, shots: x.n, model_xg: +x.mx.toFixed(4), engine_xg: +x.ex.toFixed(4), actual_goal_rate: +x.act.toFixed(4) }));
      exportFile('xg-calibration.csv', toCSV(rows), 'text/csv', 'Model calibration table');
    }
  };
  d2_mdlLoadRegs(el);
}

// ================================================================ PLAYER SIMILARITY
const d2_SIM = [
  { k: 'passes', l: 'Passes' }, { k: 'passPct', l: 'Pass %' }, { k: 'takeOns', l: 'Take-ons won' }, { k: 'tackles', l: 'Tackles' },
  { k: 'wins', l: 'Ball wins' }, { k: 'shots', l: 'Shots' }, { k: 'xg', l: 'xG' }, { k: 'km', l: 'Distance (km)' }, { k: 'recv', l: 'Receptions' },
];
const d2_TRAIT = { passes: 'passing volume', passPct: 'pass accuracy', takeOns: 'dribbling', tackles: 'tackling', wins: 'ball winning', shots: 'shooting', xg: 'shot quality', km: 'work rate', recv: 'link-up play' };
// per-90 values from each player's real minutes (the sum of the matches he played)
function d2_p90(p) {
  if (p._d2v) return p._d2v;
  const mins = p.games.reduce((s, g) => s + d2_mins(D.match(g.id) || {}), 0) || 90;
  const per = (v) => (v * 90) / mins;
  return (p._d2v = { mins, passes: per(p.passes), passPct: p.passPct, takeOns: per(p.takeOns), tackles: per(p.tackles), wins: per(p.wins), shots: per(p.shots), xg: per(p.xg), km: per(p.km), recv: per(p.recv) });
}
function d2_zAll() {
  const P = D.players, keys = d2_SIM.map((f) => f.k), V = P.map(d2_p90);
  const mu = keys.map((k) => avg(V, (v) => v[k]));
  const sd = keys.map((k, j) => Math.sqrt(avg(V, (v) => (v[k] - mu[j]) ** 2)) || 1);
  return { P, keys, V, Z: V.map((v) => keys.map((k, j) => (v[k] - mu[j]) / sd[j])) };
}
// k-means with k-means++ starts. Seeded, so the archetypes are the same on every load.
function d2_kmeans(Z, k, seed, iters = 60) {
  const rnd = d2_rng(seed); const n = Z.length, p = Z[0].length;
  const d2d = (a, b) => { let s0 = 0; for (let j = 0; j < p; j++) { const t = a[j] - b[j]; s0 += t * t; } return s0; };
  const C = [Z[Math.floor(rnd() * n)].slice()];
  while (C.length < k) {
    const dist = Z.map((z) => Math.min(...C.map((c) => d2d(z, c))));
    let r = rnd() * sum(dist); let pick = n - 1;
    for (let i = 0; i < n; i++) { r -= dist[i]; if (r <= 0) { pick = i; break; } }
    C.push(Z[pick].slice());
  }
  const asg = new Array(n).fill(-1);
  for (let it = 0; it < iters; it++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const dd = d2d(Z[i], C[c]); if (dd < bd) { bd = dd; best = c; } }
      if (asg[i] !== best) { asg[i] = best; changed = true; }
    }
    for (let c = 0; c < k; c++) {
      const idx = []; for (let i = 0; i < n; i++) if (asg[i] === c) idx.push(i);
      if (!idx.length) continue;
      for (let j = 0; j < p; j++) C[c][j] = sum(idx, (i) => Z[i][j]) / idx.length;
    }
    if (!changed) break;
  }
  return { C, asg, d2d };
}
function d2_simDraw(el) {
  const ZZ = d2_zAll();
  if (!ZZ.P.length) { el.innerHTML = pgHead('Player similarity', 'No players are loaded.'); return; }
  const P = ZZ.P, keys = ZZ.keys, V = ZZ.V, Z = ZZ.Z;
  if (!d2_S.sim.p || !D.player(d2_S.sim.p)) d2_S.sim.p = P.slice().sort((a, b) => b.rating - a.rating)[0].name;
  const sel = d2_S.sim.p, i0 = P.findIndex((p) => p.name === sel);
  const dist = Z.map((z, i) => (i === i0 ? Infinity : Math.hypot(...keys.map((_, j) => z[j] - Z[i0][j]))));
  const sims = P.map((_, i) => i).filter((i) => i !== i0).sort((a, b) => dist[a] - dist[b]).slice(0, 5);
  const KM = d2_kmeans(Z, 4, 7);
  const cl = KM.asg;
  const archName = (c) => {
    const ord = keys.map((k, j) => ({ k, z: KM.C[c][j] })).sort((a, b) => b.z - a.z);
    return ord.slice(0, 2).map((o) => d2_TRAIT[o.k]).join(' · ');
  };
  const sizes = [0, 1, 2, 3].map((c) => cl.filter((x) => x === c).length);
  const acts = '<button class="btn sm" data-act="csv">Export similarity CSV' + lockBtn('export') + '</button>';
  let h = pgHead('Player similarity', 'Source: season aggregates in D.players, converted to per-90 values from each player’s real minutes in D.matches. Computed in this browser.', acts);
  h += '<div class="filters">' +
    '<div class="field" style="min-width:230px"><label for="d2-sim-p">Player</label><select id="d2-sim-p">' + P.slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => '<option value="' + esc(p.name) + '"' + (p.name === sel ? ' selected' : '') + '>' + esc(p.name + ' · ' + clubName(p.team) + ' · ' + p.pos) + '</option>').join('') + '</select></div>' +
    '<div class="field"><label for="d2-sim-x">Scatter x axis</label><select id="d2-sim-x">' + d2_SIM.map((f) => '<option value="' + f.k + '"' + (f.k === d2_S.sim.x ? ' selected' : '') + '>' + f.l + ' per 90</option>').join('') + '</select></div>' +
    '<div class="field"><label for="d2-sim-y">Scatter y axis</label><select id="d2-sim-y">' + d2_SIM.map((f) => '<option value="' + f.k + '"' + (f.k === d2_S.sim.y ? ' selected' : '') + '>' + f.l + ' per 90</option>').join('') + '</select></div>' +
    '</div>';
  h += '<div class="grid">' +
    '<div class="s7">' + d2_card('Two-axis view', 'Each dot is a player, coloured by archetype. The selected player is large and labelled; his five closest matches are labelled too. Click any dot to select it.', () => {
      const xk = d2_S.sim.x, yk = d2_S.sim.y;
      const pts = P.map((p, i) => ({ x: V[i][xk], y: V[i][yk], color: D2_CL[cl[i]], r: 4, id: p.name, title: p.name + ' · ' + clubName(p.team) + ' · ' + p.pos + ' · ' + d2_SIM.find((f) => f.k === xk).l + ' ' + fmt(V[i][xk], 2) + ', ' + d2_SIM.find((f) => f.k === yk).l + ' ' + fmt(V[i][yk], 2) }));
      sims.forEach((i) => { pts[i].r = 6; pts[i].label = P[i].name.split(' ').slice(-1)[0]; });
      pts[i0].r = 8; pts[i0].label = P[i0].name;
      return '<div class="d2-pitchbox" style="max-width:none">' + scatter({ pts, xLabel: d2_SIM.find((f) => f.k === xk).l + ' per 90', yLabel: d2_SIM.find((f) => f.k === yk).l + ' per 90', h: 320 }) + '</div>' +
        legend(KM.C.map((_, c) => [archName(c), D2_CL[c]]));
    }) + '</div>' +
    '<div class="s5">' + d2_card('Most similar to ' + esc(sel), 'Euclidean distance on the nine z-scored per-90 features. Lower is closer.', () => {
      const rows = sims.map((i) => {
        const diffs = keys.map((k, j) => ({ k, d: Math.abs(Z[i][j] - Z[i0][j]) })).sort((a, b) => a.d - b.d);
        return { name: P[i].name, club: P[i].team, pos: P[i].pos, dist: dist[i], traits: diffs.slice(0, 2).map((x) => d2_TRAIT[x.k]).join(', '), rating: P[i].rating };
      });
      return tbl([
        { k: 'name', l: 'Player', f: (r) => '<b>' + esc(r.name) + '</b><div class="sub">' + clubTag(r.club) + ' · ' + esc(r.pos) + '</div>' },
        { k: 'dist', l: 'Distance', r: true, f: (r) => fmt(r.dist, 2) },
        { k: 'traits', l: 'Closest on', cls: 'wrap' },
        { k: 'rating', l: 'Rating', r: true, f: (r) => fmt(r.rating, 2) },
      ], rows, { id: 'd2-sim-t', click: true, key: (r) => r.name }) +
        '<div class="d2-src">Selected: ' + esc(P[i0].name) + ' · ' + esc(P[i0].pos) + ' · ' + P[i0].apps + ' apps · archetype ' + esc(archName(cl[i0])) + '</div>';
    }) + '</div></div>' +
    '<div class="grid" style="margin-top:14px"><div class="s12">' + d2_card('Role archetypes', 'K-means, k = 4, on the same nine z-scored per-90 features. Seeded start (seed 7), k-means++ initialisation, up to 60 iterations. Labels name each centroid’s two strongest traits. The typical player is the member closest to his centroid.', () => {
      const rows = [0, 1, 2, 3].map((c) => {
        const mem = P.map((_, i) => i).filter((i) => cl[i] === c);
        const typ = mem.slice().sort((a, b) => KM.d2d(Z[a], KM.C[c]) - KM.d2d(Z[b], KM.C[c]))[0];
        return { c, n: mem.length, name: archName(c), typ: typ == null ? null : P[typ], typPos: typ == null ? '' : P[typ].pos, topK: keys.map((k, j) => ({ k, z: KM.C[c][j] })).sort((a, b) => b.z - a.z).slice(0, 3).map((o) => d2_TRAIT[o.k]).join(', ') };
      });
      return '<div class="grid" style="gap:12px"><div class="s5">' + hbars(rows.map((r, c) => ({ label: 'Archetype ' + (c + 1), v: r.n, color: D2_CL[c] })), { max: Math.max(...sizes), fmt: (v) => fmt(v) }) + '</div>' +
        '<div class="s7">' + tbl([
          { k: 'c', l: 'Archetype', f: (r) => '<span class="dot" style="background:' + D2_CL[r.c] + '"></span>' + (r.c + 1) },
          { k: 'name', l: 'Strongest traits', f: (r) => esc(r.name) },
          { k: 'n', l: 'Players', r: true },
          { k: 'typ', l: 'Most typical', f: (r) => (r.typ ? esc(r.typ.name) + ' <span class="sub">' + esc(r.typPos) + ' · ' + esc(clubName(r.typ.team)) + '</span>' : '–') },
        ], rows, { id: 'd2-arch-t' }) + '</div></div>' +
        d2_src('Players: ' + P.length + ' with at least one season appearance. Features are z-scored across all players, so goalkeepers and outfield players share one space.');
    }) + '</div></div>';
  el.innerHTML = h;
  el.onchange = (e) => {
    if (e.target.id === 'd2-sim-p') { d2_S.sim.p = e.target.value; d2_simDraw(el); }
    if (e.target.id === 'd2-sim-x') { d2_S.sim.x = e.target.value; d2_simDraw(el); }
    if (e.target.id === 'd2-sim-y') { d2_S.sim.y = e.target.value; d2_simDraw(el); }
  };
  el.onclick = (e) => {
    const c = e.target.closest && e.target.closest('circle[data-id]');
    if (c) { d2_S.sim.p = c.dataset.id; d2_simDraw(el); return; }
    const b = e.target.closest && e.target.closest('[data-act="csv"]');
    if (b) {
      const rows = sims.map((i) => ({ player: P[i].name, club: P[i].team, pos: P[i].pos, distance: +dist[i].toFixed(3) }));
      exportFile('similar-' + sel.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase() + '.csv', toCSV(rows), 'text/csv', 'Similar players list');
    }
  };
  bindTbl(el, 'd2-sim-t', {}, () => d2_simDraw(el), (name) => { d2_S.sim.p = name; d2_simDraw(el); });
}

// ================================================================ TRACKING LAB
const d2_TRK = { press: 10, pressers: 2, sprint: 20 }; // pressing: two or more opponents within 10 m of the carrier; a step over 20 m between frames is a sprint step
function d2_pcGrid(P) {
  const NX = 21, NY = 14, cw = 105 / NX, ch = 68 / NY; const cells = []; let hc = 0;
  for (let gx = 0; gx < NX; gx++) for (let gy = 0; gy < NY; gy++) {
    const cx = (gx + 0.5) * cw, cy = (gy + 0.5) * ch; let dh = Infinity, da = Infinity;
    for (let i = 0; i < P.length; i++) {
      const q = P[i]; if (!q) continue;
      const d = (q[0] - cx) ** 2 + (q[1] - cy) ** 2;
      if (i < 11) { if (d < dh) dh = d; } else if (d < da) da = d;
    }
    const home = dh < da; if (home) hc++;
    cells.push({ x: gx * cw, y: gy * ch, home, m: Math.abs(Math.sqrt(dh) - Math.sqrt(da)) });
  }
  return { cells, share: hc / cells.length, cw, ch };
}
function d2_trkPrep(m) {
  if (m._d2trk) return m._d2trk;
  const F = m.frames || [], pids = m.pids || [];
  const press = {}, pcTs = [], players = pids.map((p) => ({ name: p.name, team: p.team, dist: 0, sprints: 0, maxStep: 0 }));
  let prev = null;
  for (const f of F) {
    const P = f.p || [], b = f.b;
    if (!b || !P.length) { prev = null; continue; }
    // ball carrier, approximated as the nearest player to the ball (only when within 3 m)
    let best = -1, bd = Infinity;
    for (let i = 0; i < P.length; i++) { const q = P[i]; if (!q) continue; const d = Math.hypot(q[0] - b[0], q[1] - b[1]); if (d < bd) { bd = d; best = i; } }
    if (best >= 0 && bd <= 3) {
      const cx = P[best][0], cy = P[best][1], bh = best < 11;
      let pr = 0;
      for (let i = 0; i < P.length; i++) { const q = P[i]; if (!q || (i < 11) === bh) continue; if (Math.hypot(q[0] - cx, q[1] - cy) <= d2_TRK.press) pr++; }
      const k = Math.floor(f.m), pb = press[k] || (press[k] = { h: [0, 0], a: [0, 0] });
      const side = bh ? pb.a : pb.h; // the pressing side: away presses when home has the ball, and the reverse
      side[1]++; if (pr >= d2_TRK.pressers) side[0]++;
    }
    pcTs.push([f.m, d2_pcGrid(P).share]);
    if (prev) for (let i = 0; i < P.length && i < players.length; i++) {
      const a = prev[i], q = P[i]; if (!a || !q) continue;
      const d = Math.hypot(q[0] - a[0], q[1] - a[1]), pl = players[i];
      pl.dist += d; if (d > pl.maxStep) pl.maxStep = d; if (d > d2_TRK.sprint) pl.sprints++;
    }
    prev = P;
  }
  const mins = Object.keys(press).map(Number).sort((a, b) => a - b);
  const pts = (side) => mins.filter((k) => press[k][side][1]).map((k) => [k, press[k][side][0] / press[k][side][1]]);
  // centred 3-minute share, so the line is readable; the per-minute points are kept as marks
  const roll = (side) => mins.map((k) => { let a = 0, b = 0; for (let j = k - 1; j <= k + 1; j++) { const x = press[j]; if (x) { a += x[side][0]; b += x[side][1]; } } return b ? [k, a / b] : null; }).filter(Boolean);
  const tot = (side) => { const a = sum(mins, (k) => press[k][side][0]), b = sum(mins, (k) => press[k][side][1]); return b ? a / b : null; };
  return (m._d2trk = { frames: F.length, pressH: roll('h'), pressA: roll('a'), minH: pts('h'), minA: pts('a'), pcTs, players, overH: tot('h'), overA: tot('a'), pcAvg: avg(pcTs, (p) => p[1]), lastMin: F.length ? F[F.length - 1].m : 90 });
}
function d2_trkPitchHtml(m, fi) {
  const f = m.frames[fi]; const P = f.p || []; const G = d2_pcGrid(P);
  const [hc, ac] = pairCols(m.home, m.away);
  let inner = '';
  for (const c of G.cells) {
    const a = 0.16 + 0.5 * Math.min(1, c.m / 8);
    inner += '<rect x="' + c.x.toFixed(2) + '" y="' + c.y.toFixed(2) + '" width="' + G.cw.toFixed(2) + '" height="' + G.ch.toFixed(2) + '" style="fill:' + (c.home ? hc : ac) + ';fill-opacity:' + a.toFixed(2) + '"/>';
  }
  P.forEach((q, i) => {
    if (!q) return;
    inner += '<circle cx="' + q[0].toFixed(2) + '" cy="' + q[1].toFixed(2) + '" r="1.7" style="fill:' + (i < 11 ? hc : ac) + ';stroke:#fff;stroke-width:.4px"><title>' + esc(m.pids[i].name) + '</title></circle>';
  });
  inner += '<circle cx="' + f.b[0].toFixed(2) + '" cy="' + f.b[1].toFixed(2) + '" r="1" style="fill:#fff;stroke:#000;stroke-width:.3px"/>';
  return pitch(inner, { title: 'Pitch control at ' + Math.floor(f.m) + ' minutes' }) +
    legend([[clubName(m.home) + ' control', hc], [clubName(m.away) + ' control', ac], ['Ball', '#ffffff']]) +
    '<div class="d2-src">Frame ' + (fi + 1) + ' of ' + m.frames.length + ' · ' + Math.floor(f.m) + "'" + ' · ' + clubName(m.home) + ' control ' + fmt(G.share * 100, 0) + '%</div>';
}
function d2_trkDraw(el) {
  const ms = D.matches.filter((m) => m.frames && m.frames.length);
  if (!ms.length) { el.innerHTML = pgHead('Tracking lab', 'No tracking frames are loaded.'); return; }
  const m = D.match(d2_S.trk.mid) || ms[ms.length - 1];
  d2_S.trk.mid = m.id; d2_S.trk.cur = m;
  if (d2_S.trk.fi >= m.frames.length) d2_S.trk.fi = 0;
  let T = null, err = null;
  try { T = d2_trkPrep(m); } catch (e) { console.error(e); err = e.message; }
  const opts = ms.slice().reverse().map((x) => '<option value="' + x.id + '"' + (x.id === m.id ? ' selected' : '') + '>' + esc(x.title + ' · ' + dateLbl(x.date)) + '</option>').join('');
  const [hc, ac] = pairCols(m.home, m.away);
  const acts = '<div class="field" style="min-width:260px"><label for="d2-trk-m">Match</label><select id="d2-trk-m">' + opts + '</select></div>';
  let h = pgHead('Tracking lab', 'Source: tracking frames for this match (22 players and the ball every 0.5 minutes, m.frames). Pressing, sprint and pitch-control figures are computed from those frames in this browser.', acts);
  h += d2_prod('Computed from tracking frames in your browser. Production: Azure Databricks batch on the tracking lake.');
  if (err || !T) { el.innerHTML = h + '<div class="empty">' + esc(err || 'No tracking data for this match.') + '</div>'; return; }
  const pct1 = (v) => (v == null ? '–' : fmt(v * 100, 1) + '%');
  h += '<div class="kpis">' +
    kpi('Frames', fmt(T.frames), 'About 0.5 minutes apart') +
    kpi('Home pressing', pct1(T.overH), clubName(m.home) + ' presses when ' + clubName(m.away) + ' has the ball') +
    kpi('Away pressing', pct1(T.overA), clubName(m.away) + ' presses when ' + clubName(m.home) + ' has the ball') +
    kpi('Pitch control', pct1(T.pcAvg), 'Average share of the pitch ' + clubName(m.home) + ' controls') +
    '</div>';
  const xmax = Math.max(90, Math.ceil(T.lastMin));
  h += '<div class="grid">' +
    '<div class="s7">' + d2_card('Pitch control at one frame', 'Each cell goes to the team with the nearest player. Stronger shading means a bigger lead. Move the slider through the match.', () =>
      '<input type="range" class="d2-scrub" id="d2-trk-range" min="0" max="' + (m.frames.length - 1) + '" value="' + d2_S.trk.fi + '" aria-label="Frame">' +
      '<div class="d2-pitchbox" id="d2-trk-pitch">' + d2_trkPitchHtml(m, d2_S.trk.fi) + '</div>') + '</div>' +
    '<div class="s5">' +
      d2_card('Pressing intensity by minute', 'Share of frames where the carrier is from the other side and two or more of its players are within 10 m. The line is a centred 3-minute share. Dots are single minutes.', () =>
        lineChart({ series: [
          { name: clubName(m.home) + ' presses', color: hc, pts: T.pressH },
          { name: clubName(m.away) + ' presses', color: ac, pts: T.pressA, dash: true },
        ], marks: T.minH.map(([x, y]) => ({ x, y, r: 1.6, color: hc })).concat(T.minA.map(([x, y]) => ({ x, y, r: 1.6, color: ac }))),
        xMin: 0, xMax: xmax, yMin: 0, yMax: 1, xTicks: [0, 45, xmax], yFmt: (v) => Math.round(v * 100) + '%', h: 220 }) +
        legend([[clubName(m.home) + ' presses', hc], [clubName(m.away) + ' presses', ac, true]]) +
        d2_src('Carrier: the nearest player to the ball, within 3 m.')) +
      '<div style="height:14px"></div>' +
      d2_card('Pitch control over the match', 'Share of the pitch the home side controls, frame by frame.', () =>
        lineChart({ series: [{ name: clubName(m.home) + ' control', color: hc, area: true, pts: T.pcTs }], xMin: 0, xMax: xmax, yMin: 0, yMax: 1, xTicks: [0, 45, xmax], yFmt: (v) => Math.round(v * 100) + '%', h: 180 }) +
        d2_src('Grid: 21 × 14 cells, about 5 m × 4.9 m. Each frame is scored on the positions in that frame.')) +
    '</div></div>' +
    '<div class="grid" style="margin-top:14px"><div class="s12">' + d2_card('Sprint profile by player', 'Distance and sprint steps from frame-to-frame movement. Frames are about 30 seconds apart, so these are relative counts, not km/h.', () => tbl([
      { k: 'name', l: 'Player', f: (r) => esc(r.name) + ' <span class="sub">' + esc(clubName(r.team)) + '</span>' },
      { k: 'dist', l: 'Distance (m)', r: true, f: (r) => fmt(r.dist) },
      { k: 'sprints', l: 'Sprint steps', r: true },
      { k: 'maxStep', l: 'Longest step (m)', r: true, f: (r) => fmt(r.maxStep, 1) },
    ], T.players, { id: 'd2-spr-t', sort: d2_S.trk.spr }) +
      d2_src('Sprint step: a move over ' + d2_TRK.sprint + ' m between two frames. Source: m.frames positions and m.pids.')) + '</div></div>';
  el.innerHTML = h;
  el.onchange = (e) => { if (e.target.id === 'd2-trk-m') { d2_S.trk.mid = e.target.value; d2_S.trk.fi = 0; d2_trkDraw(el); } };
  el.oninput = (e) => {
    if (e.target.id !== 'd2-trk-range' || !d2_S.trk.cur) return;
    d2_S.trk.fi = +e.target.value;
    const box = el.querySelector('#d2-trk-pitch'); if (box) box.innerHTML = d2_trkPitchHtml(d2_S.trk.cur, d2_S.trk.fi);
  };
  bindTbl(el, 'd2-spr-t', d2_S.trk.spr, () => d2_trkDraw(el));
}

// ================================================================ DATA SCIENTIST AGENT
const d2_HAR = 'HAR';
function d2_topPlayers(inp) {
  inp = inp || {};
  const f = String(inp.field || 'goals'); const n = clamp(+inp.n || 5, 1, 10);
  const p0 = D.players[0] || {};
  if (typeof p0[f] !== 'number') return { error: 'Unknown numeric field: ' + f, fields: Object.keys(p0).filter((k) => typeof p0[k] === 'number') };
  return D.players.slice().sort((a, b) => (b[f] || 0) - (a[f] || 0) || a.name.localeCompare(b.name)).slice(0, n).map((p) => ({ name: p.name, club: p.team, pos: p.pos, value: +(+p[f]).toFixed(2) }));
}
function d2_matchSum(id) {
  const m = D.match(String(id || '').toUpperCase());
  if (!m) return { error: 'No match ' + id, ids: D.matches.map((x) => x.id) };
  return { id: m.id, date: m.date, home: m.home, away: m.away, score: m.score, xg: [m.ts[m.home].xg, m.ts[m.away].xg], shots: [m.ts[m.home].shots, m.ts[m.away].shots], possessionPct: [m.ts[m.home].poss, m.ts[m.away].poss] };
}
const d2_TOOLS = [
  { name: 'season_table', description: 'League table: position, club, played, won, drawn, lost, goals for and against, points, xG and xGA.', inputSchema: { type: 'object', properties: {} }, execute: () => D.table.map((t) => ({ pos: t.pos, club: t.key, p: t.p, w: t.w, d: t.d, l: t.l, gf: t.gf, ga: t.ga, pts: t.pts, xg: t.xg, xga: t.xga })) },
  { name: 'top_players', description: 'Top players by any numeric season field, for example goals, xg, passes, tackles, rating or km. Returns name, club, position and the value.', inputSchema: { type: 'object', properties: { field: { type: 'string' }, n: { type: 'number' } }, required: ['field'] }, execute: (inp) => d2_topPlayers(inp) },
  { name: 'match_summary', description: 'One match by id (for example M010): teams, score, date, xG, shots and possession.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, execute: (inp) => d2_matchSum((inp || {}).id) },
  { name: 'xg_by_match', description: 'Every match in date order with both teams’ xG and the score.', inputSchema: { type: 'object', properties: {} }, execute: () => D.matches.map((m) => ({ id: m.id, date: m.date, home: m.home, away: m.away, score: m.score, xg: [m.ts[m.home].xg, m.ts[m.away].xg] })) },
];
function d2_ctx() {
  return { competition: D.league ? D.league.competition : '', season: D.league ? D.league.season : '', matches: D.matches.length, table: D.table.slice(0, 4).map((t) => ({ pos: t.pos, club: t.key, pts: t.pts, xg: t.xg })), scorers: d2_topPlayers({ field: 'goals', n: 3 }) };
}
// rules fallback: four common question shapes, answered by calling the same tools the model would use
function d2_agRules(q, calls) {
  const s = q.toLowerCase();
  const call = (name, input, fn) => { calls.push(name + '(' + JSON.stringify(input) + ')'); return fn(input); };
  const idm = s.match(/m\d{3}/i);
  if (idm || /\bmatch\b|\bgame\b|\bresult\b|\bfixture\b|\blast\b/.test(s)) {
    const id = idm ? idm[0].toUpperCase() : (D.matches.filter((m) => m.home === d2_HAR || m.away === d2_HAR).slice(-1)[0] || D.matches[D.matches.length - 1] || {}).id;
    const r = call('match_summary', { id }, d2_matchSum);
    if (r.error) return 'No match ' + id + ' in this season. The matches run from ' + D.matches[0].id + ' to ' + D.matches[D.matches.length - 1].id + '.';
    const mm = D.match(r.id);
    return mm.title + ' on ' + dateLbl(r.date) + ' (' + r.id + '). xG ' + fmt(r.xg[0], 2) + ' to ' + fmt(r.xg[1], 2) + ', shots ' + r.shots[0] + ' to ' + r.shots[1] + ', possession ' + r.possessionPct[0] + '% to ' + r.possessionPct[1] + '%.';
  }
  if (/\bxg\b|expected goal/.test(s)) {
    const against = /against|conced|xga/.test(s);
    const rows = call('season_table', {}, () => D.table.map((t) => ({ key: t.key, p: t.p, v: against ? t.xga : t.xg }))).sort((x, y) => y.v - x.v);
    const top = rows[0], low = rows[rows.length - 1];
    if (against) return clubName(top.key) + ' conceded the most xG this season: ' + fmt(top.v, 2) + ' from ' + top.p + ' matches. Least: ' + clubName(low.key) + ' at ' + fmt(low.v, 2) + '.';
    return clubName(top.key) + ' had the highest xG this season: ' + fmt(top.v, 2) + ' from ' + top.p + ' matches (' + fmt(top.v / top.p, 2) + ' per match). Lowest: ' + clubName(low.key) + ' at ' + fmt(low.v, 2) + '.';
  }
  if (/table|standing|points|league|top of|champion|win the/.test(s)) {
    const rows = call('season_table', {}, () => D.table.map((t) => ({ key: t.key, p: t.p, pts: t.pts, w: t.w, d: t.d, l: t.l })));
    return [1, 2, 3].map((i) => i + '. ' + clubName(rows[i - 1].key) + ', ' + rows[i - 1].pts + ' points (' + rows[i - 1].w + ' wins from ' + rows[i - 1].p + ')').join('\n');
  }
  if (/scor|goal|striker|top scorer/.test(s)) {
    const rows = call('top_players', { field: 'goals', n: 3 }, d2_topPlayers);
    return 'Most goals this season: ' + rows[0].name + ' (' + clubName(rows[0].club) + ') with ' + rows[0].value + '. Then ' + rows.slice(1).map((r) => r.name + ' (' + r.value + ')').join(' and ') + '.';
  }
  return 'I answer four kinds of question from the season data: who scored most, which team had the highest xG, the league table, and a match result (try "summarise M010"). Rules mode does not cover other questions.';
}
async function d2_agAsk(el, q) {
  q = String(q || '').trim();
  if (!q) return;
  if (!gate('ask', 'a question to the Data Scientist agent')) return;
  const st = d2_S.agt;
  if (st.busy) return;
  st.log.push({ role: 'q', text: q }); st.busy = true;
  if (el.isConnected) d2_agDraw(el);
  const calls = []; let run;
  try {
    run = await askAgent({ agent: 'Data Scientist', q, ctx: d2_ctx(), tools: d2_TOOLS, rules: () => d2_agRules(q, calls) });
  } catch (e) { console.error(e); run = { text: 'The agent could not answer: ' + e.message, src: 'rules', ground: null, steps: [] }; }
  const steps = run.steps && run.steps.length ? run.steps.slice() : calls;
  st.log.push({ role: 'a', text: run.text, src: run.src, run, steps });
  st.log = st.log.slice(-12); st.busy = false;
  if (el.isConnected) d2_agDraw(el);
}
function d2_agDraw(el) {
  const st = d2_S.agt;
  const qs = st.log.filter((x) => x.role === 'q').length;
  const msgs = st.log.map((x) => x.role === 'q'
    ? '<div class="d2-q">' + esc(x.text) + '</div>'
    : '<div class="d2-a">' + esc(x.text) + (x.steps && x.steps.length ? '<div class="steps" style="margin:8px 0 0">' + x.steps.map((t) => '<div>' + esc(t) + '</div>').join('') + '</div>' : '') +
      '<div class="d2-meta">' + chip(x.src === 'ai' ? 'Data Scientist · Claude' : 'Data Scientist · rules', x.src === 'ai' ? 'acc' : '') + d2_gchip(x.run) + '</div></div>').join('');
  const sugg = ['Who scored most this season?', 'Which team had the highest xG?', 'Show the league table', 'Summarise M010'];
  const h = pgHead('Data Scientist agent', 'Source: the season table, player aggregates and match summaries in D, read through four tools. Answers carry a grounding check.') +
    d2_prod('Production: Azure AI Foundry agent, grounded on the Fabric semantic model.') +
    '<div class="kpis">' + kpi('Matches', fmt(D.matches.length), 'In the season feed') + kpi('Tools', '4', 'season_table, top_players, match_summary, xg_by_match') + kpi('Questions', fmt(qs), 'This session') + kpi('Engine', AI.on ? 'Claude' : 'Rules', AI.on ? 'Grounded on the data' : 'Claude is not granted here') + '</div>' +
    '<div class="grid"><div class="s8">' + d2_card('Ask a question', 'Plain English. The agent calls the tools, then answers in a few sentences.', () =>
      '<div class="d2-chat" id="d2-chat" aria-live="polite">' + (msgs || '<div class="empty">Ask about the season, a club, a player or a match. Try a suggestion below.</div>') + (st.busy ? '<div class="note" style="padding:4px 2px">Working on it…</div>' : '') + '</div>' +
      '<div class="d2-sugg">' + sugg.map((x) => '<button type="button" data-act="sugg" data-q="' + esc(x) + '">' + esc(x) + '</button>').join('') + '</div>' +
      '<form class="d2-ask" id="d2-ag-f"><input class="inp" id="d2-ag-q" placeholder="Ask about the season, a club, a player or a match" autocomplete="off" aria-label="Ask the Data Scientist agent"><button class="btn pri" type="submit"' + (st.busy ? ' disabled' : '') + '>Ask' + lockBtn('ask') + '</button></form>') + '</div>' +
      '<div class="s4">' + d2_card('Tools the agent can call', 'Each tool returns small JSON from the same data the console shows.', () => [
        { n: 'season_table', d: 'League table with xG and xGA per club.' },
        { n: 'top_players', d: 'Top players by any numeric season field.' },
        { n: 'match_summary', d: 'One match by id: score, xG, shots, possession.' },
        { n: 'xg_by_match', d: 'Every match with both teams’ xG.' },
      ].map((t) => '<div class="d2-tool"><code>' + t.n + '</code><p>' + esc(t.d) + '</p></div>').join('') +
        '<div class="d2-src">Rules mode answers four question types using the same tools, so every rules answer is traceable to a tool call.</div>') + '</div></div>';
  el.innerHTML = h;
  const chat = el.querySelector('#d2-chat'); if (chat) chat.scrollTop = chat.scrollHeight;
  el.onsubmit = (e) => { if (e.target.id !== 'd2-ag-f') return; e.preventDefault(); const q = e.target.querySelector('#d2-ag-q').value; d2_agAsk(el, q); };
  el.onclick = (e) => { const b = e.target.closest('[data-act="sugg"]'); if (b) d2_agAsk(el, b.dataset.q); };
}

// ================================================================ pages
page({ id: 'ds-notebooks', title: 'Notebooks', group: 'Data science', render(el) { d2_nbDraw(el); d2_nbLoad(el); } });
page({ id: 'ds-model', title: 'Model lab', group: 'Data science', render(el) { d2_mdlDraw(el); } });
page({ id: 'ds-similar', title: 'Player similarity', group: 'Data science', render(el) { d2_simDraw(el); } });
page({ id: 'ds-tracking', title: 'Tracking lab', group: 'Data science', render(el) { d2_trkDraw(el); } });
page({ id: 'ds-agent', title: 'Data Scientist agent', group: 'AI agents', render(el) { d2_agDraw(el); } });
