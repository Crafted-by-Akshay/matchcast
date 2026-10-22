// ===================================================================================================
// 20_tools.js: Analysis tools. Query explorer, Scouting (database, profile, club), Opposition report,
// Set pieces, Tactical board. Private names use the tl_ prefix.
// ===================================================================================================
(function () {
  const s = document.createElement('style');
  s.textContent = `
.tl_types{display:flex;flex-wrap:wrap;gap:6px}
.tl_types button{background:var(--surface);border:1px solid var(--line-2);border-radius:999px;padding:4px 10px;font-size:12px;color:var(--ink-2)}
.tl_types button[aria-pressed="true"]{background:var(--accent-soft);border-color:var(--accent);color:var(--ink);font-weight:600}
.tl_qf{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.tl_qf .full{grid-column:1/-1}
.tl_row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.tl_presets{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.tl_src{font:500 11px var(--f-mono);color:var(--muted);margin-top:8px;display:flex;gap:4px 12px;flex-wrap:wrap}
.tl_rad svg{overflow:visible}
.tl_scroll .tw{max-height:560px;overflow:auto}
.tl_scroll td{white-space:nowrap}
.tl_pbar{display:grid;grid-template-columns:minmax(0,8.5rem) minmax(0,1fr) 2.6rem 4.2rem;gap:8px;align-items:center;font-size:12.5px;padding:3px 0}
.tl_pbar .bar{height:8px}
.tl_pbar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tl_sw{margin:0;padding-left:18px;font-size:13px;line-height:1.5}
.tl_sw li{margin:3px 0}
.tl_formula{font:11.5px/1.45 var(--f-mono);color:var(--muted);background:var(--surface-2);border:1px solid var(--line);border-radius:6px;padding:6px 9px;margin-top:8px;overflow-wrap:anywhere}
.tl_ph{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.tl_num{font:700 40px/1 var(--f-disp);width:64px;height:64px;border-radius:10px;display:grid;place-items:center;color:var(--top-ink);flex:none}
.tl_ans{white-space:pre-wrap;font-size:13.5px;line-height:1.5;margin-top:10px}
.tl_board{position:relative}
.tl_board svg.tl_drawing{touch-action:none;cursor:crosshair}
.tl_tick{display:flex;flex-direction:column;max-height:360px;overflow-y:auto}
.tl_tick button{display:grid;grid-template-columns:3rem minmax(0,1fr);gap:8px;text-align:left;background:none;border:0;border-top:1px solid var(--line);padding:6px 2px;font-size:12.5px;color:var(--ink-2)}
.tl_tick button:first-child{border-top:0}
.tl_tick button.now{background:var(--accent-soft);color:var(--ink)}
.tl_tick .mn{font:600 12px var(--f-mono);color:var(--muted)}
.tl_score{font:700 26px/1 var(--f-disp);letter-spacing:.02em;font-variant-numeric:tabular-nums}
.tl_ctrl{display:flex;gap:8px 10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.tl_slider{width:100%;accent-color:var(--accent);margin:8px 0 2px}
.tl_tools{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px}
.tl_tools .seg button{min-height:30px}
.tl_sw3{display:inline-flex;gap:4px}
.tl_sw3 button{width:26px;height:26px;border-radius:50%;border:2px solid var(--line-2)}
.tl_sw3 button[aria-pressed="true"]{border-color:var(--ink)}
.tl_md{font-size:13.5px;line-height:1.55}
.tl_md ul{margin:4px 0 0;padding-left:18px}
.tl_md li{margin:4px 0}
.tl_mini{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}
.tl_mini div{background:var(--surface-2);border-radius:6px;padding:7px 9px}
.tl_mini b{display:block;font:700 20px/1.1 var(--f-disp);font-variant-numeric:tabular-nums}
.tl_mini span{font-size:11px;color:var(--muted)}
@media (max-width:340px){.tl_qf{grid-template-columns:minmax(0,1fr)}}
@media (max-width:640px){.tl_pl circle{r:2.4px}.tl_pl text{font-size:2.3px!important;transform:translateY(.2px)}.tl_num{width:52px;height:52px;font-size:32px}}
`;
  document.head.appendChild(s);
})();

// ---------------------------------------------------------------- shared helpers
const tl_slug = (n) => String(n).replace(/[^A-Za-z0-9]/g, '_');
const tl_bySlug = (sl) => D.players.find((p) => tl_slug(p.name) === sl);
const tl_ord = (n) => { n = Math.round(n); const sx = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (sx[(v - 20) % 10] || sx[v] || sx[0]); };
const tl_short = (m) => 'MD' + m.matchday + ' ' + m.home + '–' + m.away;
const tl_lc = (l) => (/^xG|^Km/.test(l) ? l : l.charAt(0).toLowerCase() + l.slice(1));
const tl_pc = (v, d = 0) => (v == null || isNaN(v) ? '–' : fmt(v * 100, d) + '%');
const TL_GRP = { GK: 'goalkeepers', DEF: 'defenders', MID: 'midfielders', ATT: 'attackers' };
function tl_safe(f, label) { try { return f(); } catch (e) { console.error(e); return '<div class="empty">' + esc(label || 'This section') + ' could not be drawn (' + esc(e.message) + ').</div>'; } }
function tl_bindGo(el) { el.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => { const [p, ...a] = b.dataset.go.split('.'); go(p, a.join('.') || null); }; }); }
const tl_gchip = (run) => (run.src === 'ai' ? groundChip(run.ground) : chip('Deterministic rules · computed from the data', 'info'));
const tl_ctag = (k) => '<span class="dot" style="background:' + ccol(k) + '"></span>' + esc(clubName(k));
const tl_src = (items) => '<div class="tl_src">' + items.map((x) => '<span>' + x + '</span>').join('') + '</div>';
const tl_flip = (pt) => [105 - pt[0], 68 - pt[1]];
// tracking point i in frame fr normalised so that player's team attacks toward x = 105
const tl_norm = (fr, i) => { const p = fr.p[i]; if (!p) return null; const fl = i < 11 ? fr.f === 1 : fr.f !== 1; return fl ? tl_flip(p) : p; };

// success definitions, computed once per match and cached on the match (m.tl_ok: event index -> true/false)
const TL_ONBALL = new Set(['pass', 'shot', 'take_on', 'turnover', 'slide_tackle', 'throw_in', 'freekick', 'corner', 'goalkick']);
const TL_STOP = new Set(['kickoff', 'half_time', 'full_time']);
function tl_prep(m) {
  if (m.tl_ok) return m;
  const ev = m.events || []; const ok = new Map();
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    if (e.type === 'pass' || e.type === 'slide_tackle') {
      let r = null;
      for (let j = i + 1; j < ev.length; j++) { const n = ev[j]; if (TL_STOP.has(n.type)) break; if (TL_ONBALL.has(n.type) && n.team) { r = n.team === e.team; break; } }
      if (r !== null) ok.set(i, r);
    } else if (e.type === 'take_on') ok.set(i, !!e.success);
    else if (e.type === 'shot') {
      let g = false;
      for (let j = i + 1; j < ev.length && ev[j].minute <= e.minute + 0.5; j++) { const n = ev[j]; if (n.type === 'shot' || TL_STOP.has(n.type) && n.type !== 'kickoff') break; if (n.type === 'goal') { g = n.team === e.team && !n.ownGoal; break; } }
      ok.set(i, g);
    }
  }
  m.tl_ok = ok; return m;
}
const tl_clubMatches = (k) => D.matches.filter((m) => m.home === k || m.away === k);

// set pieces of one team in one match: shots and xG within 0.5 match minutes, plus first-contact points
const TL_SP = { corner: 'Corner', freekick: 'Free kick', throw_in: 'Throw-in' };
function tl_spMatch(m, team) {
  const win = tl_SPS.win;
  const ev = m.events || []; tl_prep(m);
  const out = { corner: 0, freekick: 0, throw_in: 0, shots: 0, xg: 0, goals: 0, byKind: { corner: { shots: 0, xg: 0 }, freekick: { shots: 0, xg: 0 }, throw_in: { shots: 0, xg: 0 } }, deliv: [], shotList: [] };
  const used = new Set();
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i]; if (!TL_SP[e.type] || e.team !== team) continue;
    out[e.type]++;
    const o = [e.ax ?? e.bx ?? 0, e.ay ?? e.by ?? 0]; let contact = null;
    for (let j = i + 1; j < ev.length && ev[j].minute <= e.minute + Math.max(win, 1.5); j++) {
      const n = ev[j]; if (TL_STOP.has(n.type)) break;
      if (!contact && TL_ONBALL.has(n.type) && n.team && n.ax != null) {
        const p = n.team === team ? [n.ax, n.ay] : [105 - n.ax, 68 - n.ay];
        if (Math.hypot(p[0] - o[0], p[1] - o[1]) > 3) contact = { p, own: n.team === team };
      }
      if (n.type === 'shot' && n.team === team && !used.has(j) && n.minute <= e.minute + win) { used.add(j); out.shots++; out.xg += n.xg || 0; out.byKind[e.type].shots++; out.byKind[e.type].xg += n.xg || 0; const g = m.tl_ok.get(j); if (g) out.goals++; out.shotList.push({ m, sp: e.type, min: n.minute, player: n.player, xg: n.xg || 0, goal: !!g }); }
    }
    if (e.type !== 'throw_in') out.deliv.push({ kind: e.type, o, contact, team, m: m.id, min: e.minute });
  }
  return out;
}
function tl_spClub(k) {
  const ms = tl_clubMatches(k);
  const a = { club: k, mp: ms.length, corner: 0, freekick: 0, throw_in: 0, shots: 0, xg: 0, goals: 0, cShots: 0, cXg: 0, byKind: { corner: { shots: 0, xg: 0 }, freekick: { shots: 0, xg: 0 }, throw_in: { shots: 0, xg: 0 } }, deliv: [], shotList: [] };
  for (const m of ms) {
    const s = tl_spMatch(m, k), c = tl_spMatch(m, m.home === k ? m.away : m.home);
    for (const f of ['corner', 'freekick', 'throw_in', 'shots', 'xg', 'goals']) a[f] += s[f];
    for (const kk in s.byKind) { a.byKind[kk].shots += s.byKind[kk].shots; a.byKind[kk].xg += s.byKind[kk].xg; }
    a.deliv.push(...s.deliv); a.shotList.push(...s.shotList); a.cShots += c.shots; a.cXg += c.xg;
  }
  a.sp = a.corner + a.freekick + a.throw_in; a.xg = +a.xg.toFixed(2); a.cXg = +a.cXg.toFixed(2);
  return a;
}

// ---------------------------------------------------------------- player metrics and percentiles
const TL_MX = [
  { k: 'rating', l: 'Average match rating', s: 'Rating', f: (p) => p.rating, d: 2 },
  { k: 'goals90', l: 'Goals per 90', s: 'Goals', f: (p) => p.goals / p.apps, d: 2, rad: 1, good: 'Finishes chances', bad: 'Rarely scores' },
  { k: 'xg90', l: 'xG per 90', s: 'xG', f: (p) => p.xg / p.apps, d: 2, rad: 1, good: 'Gets into good shooting positions', bad: 'Generates little shot quality' },
  { k: 'shots90', l: 'Shots per 90', s: 'Shots', f: (p) => p.shots / p.apps, d: 2, good: 'Shoots often', bad: 'Shoots rarely' },
  { k: 'done90', l: 'Passes completed per 90', s: 'Pass cmp', f: (p) => p.done / p.apps, d: 1, rad: 1, good: 'Heavily involved in circulation', bad: 'Low passing volume' },
  { k: 'passPct', l: 'Pass completion %', s: 'Pass %', f: (p) => p.passPct, d: 0, rad: 1, good: 'Secure passer', bad: 'Gives the ball away when passing' },
  { k: 'recv90', l: 'Passes received per 90', s: 'Receives', f: (p) => p.recv / p.apps, d: 1, good: 'Teammates look for him', bad: 'Seldom found by teammates' },
  { k: 'wins90', l: 'Ball wins per 90', s: 'Ball wins', f: (p) => p.wins / p.apps, d: 2, rad: 1, good: 'Wins the ball back often', bad: 'Contributes few ball recoveries' },
  { k: 'loss90', l: 'Ball losses per 90 (fewer ranks higher)', s: 'Security', f: (p) => p.losses / p.apps, d: 2, rad: 1, inv: 1, good: 'Rarely loses the ball', bad: 'Loses the ball often' },
  { k: 'tko90', l: 'Take-ons won per 90', s: 'Take-ons', f: (p) => p.takeOnsWon / p.apps, d: 2, rad: 1, good: 'Beats defenders one-on-one', bad: 'Rarely beats a man' },
  { k: 'tkl90', l: 'Tackles per 90', s: 'Tackles', f: (p) => p.tackles / p.apps, d: 2, rad: 1, good: 'Active tackler', bad: 'Makes few tackles' },
  { k: 'km90', l: 'Km/90 (distance at 90-minute pace)', s: 'Km/90', f: (p) => p.per90, d: 1, rad: 1, good: 'Covers a lot of ground', bad: 'Covers little ground' },
  { k: 'top', l: 'Top speed (km/h)', s: 'Top speed', f: (p) => p.top, d: 1, rad: 1, good: 'Has top-end pace', bad: 'Lacks top-end pace' },
];
const TL_MXK = Object.fromEntries(TL_MX.map((x) => [x.k, x]));
const TL_RAD = TL_MX.filter((x) => x.rad);
let TL_PCT = null;
function tl_pctTables() {
  if (TL_PCT && TL_PCT.n === D.players.length) return TL_PCT;
  TL_PCT = { n: D.players.length };
  for (const g of ['GK', 'DEF', 'MID', 'ATT']) { const ps = D.players.filter((p) => p.group === g); TL_PCT[g] = {}; for (const x of TL_MX) TL_PCT[g][x.k] = ps.map((p) => x.f(p) || 0); }
  return TL_PCT;
}
// share of the position group below this value (ties count half); inverted metrics flip
function tl_pct(p, k) {
  const arr = (tl_pctTables()[p.group] || {})[k] || []; if (arr.length < 2) return 0.5;
  const v = TL_MXK[k].f(p) || 0; let lo = 0, eq = 0; for (const x of arr) { if (x < v) lo++; else if (x === v) eq++; }
  const r = (lo + 0.5 * eq) / arr.length; return TL_MXK[k].inv ? 1 - r : r;
}
const tl_vec = (p) => TL_RAD.map((x) => tl_pct(p, x.k));
function tl_similar(p, n = 5) {
  const a = tl_vec(p).map((v) => v - 0.5);
  return D.players.filter((q) => q.name !== p.name && q.group === p.group).map((q) => {
    const b = tl_vec(q).map((v) => v - 0.5); let d = 0, na = 0, nb = 0; a.forEach((v, i) => { d += v * b[i]; na += v * v; nb += b[i] * b[i]; });
    return { p: q, sim: na && nb ? d / Math.sqrt(na * nb) : 0 };
  }).sort((x, y) => y.sim - x.sim).slice(0, n);
}
function tl_sw(p) {
  const rows = TL_MX.filter((x) => x.good).map((x) => ({ x, pc: tl_pct(p, x.k), v: x.f(p) }));
  const g = TL_GRP[p.group];
  const line = (r) => '<b>' + r.x.good.replace(/^./, (c) => c) + '</b>: ' + fmt(r.v, r.x.d) + ' ' + tl_lc(r.x.l.replace(/ \(.*\)$/, '')) + ' (' + tl_ord(r.pc * 100) + ' percentile among ' + g + ').';
  const lineB = (r) => '<b>' + r.x.bad + '</b>: ' + fmt(r.v, r.x.d) + ' ' + tl_lc(r.x.l.replace(/ \(.*\)$/, '')) + ' (' + tl_ord(r.pc * 100) + ' percentile among ' + g + ').';
  const st = rows.filter((r) => r.pc >= 0.7).sort((a, b) => b.pc - a.pc).slice(0, 3);
  const wk = rows.filter((r) => r.pc <= 0.3).sort((a, b) => a.pc - b.pc).slice(0, 3);
  return { st: st.map(line), wk: wk.map(lineB) };
}

// ===================================================================================================
// 1. QUERY EXPLORER
// ===================================================================================================
const TL_TYPES = [['pass', 'Passes'], ['shot', 'Shots'], ['goal', 'Goals'], ['turnover', 'Ball wins'], ['take_on', 'Take-ons'], ['slide_tackle', 'Slide tackles'], ['aerial_duel', 'Aerial duels won'], ['foul', 'Fouls'], ['freekick', 'Free kicks won'], ['corner', 'Corners won'], ['throw_in', 'Throw-ins'], ['yellow_card', 'Yellow cards']];
const TL_TLBL = Object.fromEntries(TL_TYPES);
const TL_GBY = [['player', 'Player'], ['club', 'Club'], ['match', 'Match'], ['bucket', '15-min bucket'], ['kind', 'Event kind']];
const TL_MET = [['count', 'Count'], ['xg', 'Sum of xG'], ['rate', 'Success rate']];
const TL_ZONE = [['all', 'Whole pitch'], ['def', 'Defensive third'], ['mid', 'Middle third'], ['att', 'Final third']];
const TL_PRESETS = [
  { name: 'Shots and xG by player', q: { types: ['shot'], group: 'player', metric: 'xg' } },
  { name: 'Pass completion by club', q: { types: ['pass'], group: 'club', metric: 'rate' } },
  { name: 'Final-third ball wins by player', q: { types: ['turnover'], zone: 'att', group: 'player', metric: 'count' } },
  { name: 'Harbor City passing by 15 minutes', q: { types: ['pass'], team: 'HAR', group: 'bucket', metric: 'rate' } },
  { name: 'Take-on success by player', q: { types: ['take_on'], group: 'player', metric: 'rate', minN: 3 } },
  { name: 'Pass kind mix', q: { types: ['pass'], group: 'kind', metric: 'count' } },
];
const tl_qBase = () => ({ types: ['shot'], team: '', player: '', scope: 'all', md: '', match: '', minFrom: 0, minTo: 120, zone: 'all', group: 'player', metric: 'xg', minN: 1 });
const tl_X = { q: null, sort: null, preset: '' };
function tl_loadQ(q, name) { tl_X.q = Object.assign(tl_qBase(), JSON.parse(JSON.stringify(q))); tl_X.preset = name || ''; tl_X.sort = tl_defSort(tl_X.q); }
const tl_defSort = (q) => (q.group === 'bucket' ? { k: 'label', dir: 'asc' } : { k: q.metric === 'xg' ? 'xg' : q.metric === 'rate' ? 'rate' : 'n', dir: 'desc' });
tl_loadQ(TL_PRESETS[0].q, TL_PRESETS[0].name);

function tl_gLabel(g, k) {
  if (g === 'club') return clubName(k);
  if (g === 'match') { const m = D.match(k); return m ? tl_short(m) : k; }
  if (g === 'bucket') return +k >= 6 ? '90+' : k * 15 + '–' + (k * 15 + 15);
  return String(k);
}
function tl_run(q) {
  const t0 = performance.now(); const G = {}; let scanned = 0, matched = 0; const types = new Set(q.types);
  const ms = D.matches.filter((m) => (q.scope === 'md' ? String(m.matchday) === String(q.md) : q.scope === 'match' ? m.id === q.match : true));
  for (const m of ms) {
    tl_prep(m); const ev = m.events || [];
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i]; scanned++;
      if (!types.has(e.type)) continue;
      if (q.team && e.team !== q.team) continue;
      const pl = e.player || e.won || '';
      if (q.player && pl !== q.player) continue;
      if (e.minute < q.minFrom || e.minute > q.minTo) continue;
      if (q.zone !== 'all') { if (e.ax == null) continue; const z = e.ax < 35 ? 'def' : e.ax < 70 ? 'mid' : 'att'; if (z !== q.zone) continue; }
      let key;
      if (q.group === 'player') key = pl || '(no player)'; else if (q.group === 'club') key = e.team || '(none)'; else if (q.group === 'match') key = m.id;
      else if (q.group === 'bucket') key = Math.min(6, Math.floor(e.minute / 15)); else key = e.kind || e.move || e.how || TL_TLBL[e.type] || e.type;
      const g = G[key] || (G[key] = { key, n: 0, ok: 0, att: 0, xg: 0, team: q.group === 'player' || q.group === 'club' ? e.team : '' });
      g.n++; matched++;
      const ok = m.tl_ok.get(i); if (ok === true || ok === false) { g.att++; if (ok) g.ok++; }
      if (e.type === 'shot') g.xg += e.xg || 0;
    }
  }
  const rows = Object.values(G).filter((g) => g.n >= (q.minN || 1)).map((g) => Object.assign(g, { xg: +g.xg.toFixed(2), rate: g.att ? g.ok / g.att : null, label: tl_gLabel(q.group, g.key) }));
  return { rows, scanned, matched, matches: ms.length, ms: Math.max(1, Math.round(performance.now() - t0)) };
}
const tl_mv = (q, r) => (q.metric === 'xg' ? r.xg : q.metric === 'rate' ? r.rate : r.n);
function tl_sql(q, res) {
  const s = (v) => "'" + String(v).replace(/'/g, "''") + "'";
  const gcol = { player: 'player', club: 'team', match: 'match_id', bucket: 'LEAST(FLOOR(minute / 15), 6) AS bucket_15', kind: 'COALESCE(kind, move, how, type) AS kind' }[q.group];
  const gname = { player: 'player', club: 'team', match: 'match_id', bucket: 'bucket_15', kind: 'kind' }[q.group];
  const mname = { count: 'events', xg: 'xg_total', rate: 'success_rate' }[q.metric];
  const w = ['type IN (' + q.types.map(s).join(', ') + ')'];
  if (q.team) w.push('team = ' + s(q.team));
  if (q.player) w.push('player = ' + s(q.player));
  if (q.scope === 'md' && q.md) w.push('matchday = ' + (+q.md));
  if (q.scope === 'match' && q.match) w.push('match_id = ' + s(q.match));
  w.push('minute BETWEEN ' + q.minFrom + ' AND ' + q.minTo);
  if (q.zone === 'def') w.push('ax < 35          -- defensive third, team attacks toward x = 105');
  if (q.zone === 'mid') w.push('ax >= 35 AND ax < 70   -- middle third');
  if (q.zone === 'att') w.push('ax >= 70         -- final third, team attacks toward x = 105');
  return 'SELECT ' + gcol + ',\n       COUNT(*)                         AS events,\n       SUM(success) || \'/\' || COUNT(success) AS successful,\n       AVG(success)                     AS success_rate,\n       SUM(xg)                          AS xg_total\n' +
    'FROM   match_events                     -- ' + D.version + ' · ' + res.matches + ' matches\nWHERE  ' + w.join('\n  AND  ') + '\nGROUP  BY ' + gname + (q.minN > 1 ? '\nHAVING COUNT(*) >= ' + q.minN : '') + '\nORDER  BY ' + (q.group === 'bucket' ? 'bucket_15' : mname + ' DESC') + ';\n' +
    '-- scanned ' + fmt(res.scanned) + ' events · ' + fmt(res.matched) + ' matched · ' + res.rows.length + ' groups · ' + res.ms + ' ms';
}

page({
  id: 'explorer', title: 'Query explorer', group: 'Analysis tools',
  render(el) { tl_exRender(el); },
});
function tl_exRender(el) {
  const q = tl_X.q; let res;
  try { res = tl_run(q); } catch (e) { res = { rows: [], scanned: 0, matched: 0, matches: 0, ms: 0 }; console.error(e); }
  const hasShot = q.types.includes('shot'); const hasRate = q.types.some((t) => ['pass', 'take_on', 'shot', 'slide_tackle'].includes(t));
  const players = D.players.filter((p) => !q.team || p.team === q.team).sort((a, b) => (a.name < b.name ? -1 : 1));
  const mds = [...new Set(D.matches.map((m) => m.matchday))].sort((a, b) => a - b);
  const opt = (v, l, cur) => '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(l) + '</option>';
  const builder =
    '<div class="field full" style="margin-bottom:10px"><span>Event types</span><div class="tl_types" id="tl_xtypes">' + TL_TYPES.map(([v, l]) => '<button data-v="' + v + '" aria-pressed="' + q.types.includes(v) + '">' + l + '</button>').join('') + '</div></div>' +
    '<div class="tl_qf">' +
    '<label class="field">Team<select id="tl_xteam">' + opt('', 'All clubs', q.team) + D.clubs.map((c) => opt(c.key, c.club, q.team)).join('') + '</select></label>' +
    '<label class="field">Player<select id="tl_xpl">' + opt('', 'All players', q.player) + players.map((p) => opt(p.name, p.name + ' · ' + p.team, q.player)).join('') + '</select></label>' +
    '<label class="field">Matches<select id="tl_xscope">' + opt('all', 'All matches', q.scope) + opt('md', 'One matchday', q.scope) + opt('match', 'One match', q.scope) + '</select></label>' +
    (q.scope === 'md' ? '<label class="field">Matchday<select id="tl_xmd">' + mds.map((d) => opt(d, 'Matchday ' + d, q.md)).join('') + '</select></label>' :
      q.scope === 'match' ? '<label class="field">Match<select id="tl_xmatch">' + D.matches.map((m) => opt(m.id, tl_short(m) + ' ' + m.score.join('–'), q.match)).join('') + '</select></label>' : '<div></div>') +
    '<label class="field">From minute<input id="tl_xmin0" type="number" min="0" max="130" value="' + q.minFrom + '"></label>' +
    '<label class="field">To minute<input id="tl_xmin1" type="number" min="0" max="130" value="' + q.minTo + '"></label>' +
    '<label class="field">Pitch zone<select id="tl_xzone">' + TL_ZONE.map(([v, l]) => opt(v, l, q.zone)).join('') + '</select></label>' +
    '<label class="field">Min. events per group<input id="tl_xminn" type="number" min="1" max="200" value="' + q.minN + '"></label>' +
    '<label class="field">Group by<select id="tl_xgrp">' + TL_GBY.map(([v, l]) => opt(v, l, q.group)).join('') + '</select></label>' +
    '<label class="field">Metric<select id="tl_xmet">' + TL_MET.map(([v, l]) => opt(v, l, q.metric)).join('') + '</select></label>' +
    '</div>' +
    '<details style="margin-top:12px"><summary class="note" style="cursor:pointer">How success and zones are defined</summary><div class="note" style="margin-top:6px;line-height:1.55">' +
    '<b>Pass</b> and <b>slide tackle</b>: successful when the next on-ball event (pass, shot, take-on, turnover, tackle or restart) belongs to the same team. On the test season this reproduces the engine’s own completed-pass totals within about 2%.<br><b>Take-on</b>: the event’s success flag.<br><b>Shot</b>: a goal by the same team within 0.5 match minutes.<br>Other types have no success definition and are left out of the rate.<br><b>Zones</b> use ax, the ball position normalised so the acting team attacks toward x = 105: defensive third ax &lt; 35, middle 35–70, final third ≥ 70.</div></details>';

  const metricLbl = { count: 'events', xg: 'xG (sum of shot xG)', rate: 'success rate (%)' }[q.metric];
  let chart = '';
  const valid = res.rows.filter((r) => tl_mv(q, r) != null);
  if (!q.types.length) chart = '<div class="empty">Pick at least one event type.</div>';
  else if (q.metric === 'xg' && !hasShot) chart = '<div class="empty">Sum of xG needs shots in the event types. Add <b>Shots</b> or switch the metric.</div>';
  else if (q.metric === 'rate' && !hasRate) chart = '<div class="empty">Success rate is defined for passes, take-ons, shots and slide tackles only.</div>';
  else if (!valid.length) chart = '<div class="empty">No events match this query. Widen the minute range, zone or matches.</div>';
  else if (q.group === 'bucket') {
    const pts = valid.slice().sort((a, b) => a.key - b.key).map((r) => [r.key, q.metric === 'rate' ? r.rate * 100 : tl_mv(q, r)]);
    chart = lineChart({ series: [{ name: metricLbl, color: q.team ? ccol(q.team) : 'var(--accent)', pts, area: true }], h: 230, xMin: 0, xMax: 6, xTicks: [0, 1, 2, 3, 4, 5, 6], xFmt: (v) => tl_gLabel('bucket', v), yMax: q.metric === 'rate' ? 100 : undefined, yLabel: metricLbl, marks: pts.map((p) => ({ x: p[0], y: p[1], color: q.team ? ccol(q.team) : 'var(--accent)', title: tl_gLabel('bucket', p[0]) + ': ' + fmt(p[1], q.metric === 'count' ? 0 : q.metric === 'rate' ? 1 : 2) })) });
  } else {
    const top = valid.slice().sort((a, b) => tl_mv(q, b) - tl_mv(q, a)).slice(0, 15);
    chart = hbars(top.map((r) => ({ label: r.label, labelHtml: r.team ? '<span class="dot" style="background:' + ccol(r.team) + '"></span>' + esc(r.label) : esc(r.label), v: q.metric === 'rate' ? r.rate * 100 : tl_mv(q, r), color: r.team ? ccol(r.team) : 'var(--accent)' })), { max: q.metric === 'rate' ? 100 : undefined, fmt: (v) => (q.metric === 'rate' ? fmt(v, 0) + '%' : fmt(v, q.metric === 'xg' ? 2 : 0)) }) +
      (valid.length > 15 ? '<div class="note" style="margin-top:6px">Top 15 of ' + valid.length + ' groups by ' + metricLbl + '. The table below has all of them.</div>' : '');
  }
  const gl = (TL_GBY.find((x) => x[0] === q.group) || [])[1];
  const cols = [
    { k: 'label', l: gl, f: (r) => (r.team ? '<span class="dot" style="background:' + ccol(r.team) + '"></span>' : '') + (q.group === 'player' && D.player(r.key) ? '<button class="btn ghost sm" style="padding:0;min-height:0" data-go="scouting.p-' + tl_slug(r.key) + '">' + esc(r.label) + '</button>' : esc(r.label)), v: (r) => (q.group === 'bucket' ? r.key : r.label) },
    { k: 'n', l: 'Events', r: 1 },
    { k: 'ok', l: 'Successful', r: 1, f: (r) => (r.att ? r.ok + ' / ' + r.att : '–'), v: (r) => r.ok },
    { k: 'rate', l: 'Success %', r: 1, f: (r) => tl_pc(r.rate, 1), v: (r) => r.rate ?? -1 },
  ];
  if (hasShot) cols.push({ k: 'xg', l: 'xG', r: 1, f: (r) => fmt(r.xg, 2) });
  const totals = { n: sum(res.rows, (r) => r.n), ok: sum(res.rows, (r) => r.ok), att: sum(res.rows, (r) => r.att), xg: sum(res.rows, (r) => r.xg) };

  el.innerHTML = pgHead('Query explorer', 'Ask the season’s event data a question without writing code. The exact query that ran is printed under the chart, so every number can be checked.',
    '<button class="btn" id="tl_xcsv">Export CSV' + lockBtn('export') + '</button><button class="btn pri" id="tl_xsave">Save query' + lockBtn('author') + '</button>') +
    '<div class="tl_presets"><span class="note" style="align-self:center">Presets:</span>' + TL_PRESETS.map((p, i) => '<button class="btn sm' + (tl_X.preset === p.name ? ' pri' : '') + '" data-pre="' + i + '">' + esc(p.name) + '</button>').join('') + '</div>' +
    '<div class="grid">' +
    '<div class="s4">' + card('Query', 'Every filter maps to one line of the query', builder) +
    card('Saved queries', 'Shared with your organisation', '<div id="tl_xsaved"><div class="empty">Loading…</div></div>', '', 'flat" style="margin-top:14px') + '</div>' +
    '<div class="s8">' +
    '<div class="kpis">' + kpi('Events matched', fmt(res.matched), 'of ' + fmt(res.scanned) + ' scanned') + kpi('Groups', fmt(res.rows.length), gl) + (hasRate ? kpi('Success rate', tl_pc(totals.att ? totals.ok / totals.att : null, 1), totals.ok + ' of ' + totals.att + ' with a defined outcome') : '') + (hasShot ? kpi('xG total', fmt(totals.xg, 2), 'sum over matched shots') : kpi('Matches', fmt(res.matches), q.scope === 'all' ? 'whole season' : q.scope === 'md' ? 'matchday ' + q.md : q.match)) + '</div>' +
    card(esc(tl_X.preset || 'Custom query'), (q.metric === 'xg' ? metricLbl : metricLbl.replace(/^./, (c) => c.toUpperCase())) + ' by ' + gl.toLowerCase(), chart + tl_src(['Source: match_events (' + D.version + ')', 'Unit: ' + metricLbl, res.matches + ' matches'])) +
    '<div style="height:14px"></div>' +
    card('Generated query', 'Readable pseudo-SQL of exactly what ran in the browser', '<pre class="code">' + esc(tl_sql(q, res)) + '</pre>') +
    '<div style="height:14px"></div>' +
    card('Results', res.rows.length + ' groups · click a column to sort', tbl(cols, res.rows, { id: 'tl_xtbl', sort: tl_X.sort, empty: 'No groups. Loosen a filter.' })) +
    '</div></div>';

  const re = () => tl_exRender(el);
  const set = (k, v) => { q[k] = v; tl_X.preset = ''; re(); };
  el.querySelectorAll('[data-pre]').forEach((b) => { b.onclick = () => { const p = TL_PRESETS[+b.dataset.pre]; tl_loadQ(p.q, p.name); re(); }; });
  $('#tl_xtypes', el).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; const v = b.dataset.v; q.types = q.types.includes(v) ? q.types.filter((x) => x !== v) : q.types.concat(v); tl_X.preset = ''; re(); };
  $('#tl_xteam', el).onchange = (e) => { q.team = e.target.value; if (q.player && D.player(q.player) && q.team && D.player(q.player).team !== q.team) q.player = ''; tl_X.preset = ''; re(); };
  $('#tl_xpl', el).onchange = (e) => set('player', e.target.value);
  $('#tl_xscope', el).onchange = (e) => { q.scope = e.target.value; if (q.scope === 'md' && !q.md) q.md = String(mds[0]); if (q.scope === 'match' && !q.match) q.match = D.matches[0].id; tl_X.preset = ''; re(); };
  if ($('#tl_xmd', el)) $('#tl_xmd', el).onchange = (e) => set('md', e.target.value);
  if ($('#tl_xmatch', el)) $('#tl_xmatch', el).onchange = (e) => set('match', e.target.value);
  $('#tl_xmin0', el).onchange = (e) => set('minFrom', clamp(+e.target.value || 0, 0, 130));
  $('#tl_xmin1', el).onchange = (e) => set('minTo', clamp(+e.target.value || 0, 0, 130));
  $('#tl_xminn', el).onchange = (e) => set('minN', clamp(Math.round(+e.target.value) || 1, 1, 500));
  $('#tl_xzone', el).onchange = (e) => set('zone', e.target.value);
  $('#tl_xgrp', el).onchange = (e) => { q.group = e.target.value; tl_X.sort = tl_defSort(q); tl_X.preset = ''; re(); };
  $('#tl_xmet', el).onchange = (e) => { q.metric = e.target.value; tl_X.sort = tl_defSort(q); tl_X.preset = ''; re(); };
  bindTbl(el, 'tl_xtbl', tl_X.sort, re);
  tl_bindGo(el);
  $('#tl_xcsv', el).onclick = () => {
    if (!res.rows.length) return toast('Nothing to export: the query returned no rows.');
    const rows = res.rows.map((r) => Object.assign({ [q.group]: r.label, events: r.n, successful: r.ok, with_outcome: r.att, success_rate: r.rate == null ? '' : +(r.rate * 100).toFixed(1) }, hasShot ? { xg: r.xg } : {}));
    exportFile('query-' + tl_slug((tl_X.preset || 'custom').toLowerCase()) + '.csv', '# ' + tl_sql(q, res).split('\n').join('\n# ') + '\n' + toCSV(rows), 'text/csv', 'Query explorer CSV');
  };
  $('#tl_xsave', el).onclick = () => {
    if (!gate('author', 'Save query')) return;
    const bg = modal('<h3>Save query</h3><p class="note">Saved queries are shared with your organisation and logged in the audit trail.</p><label class="field" style="margin:12px 0">Name<input id="tl_xname" value="' + esc(tl_X.preset || 'My query') + '" maxlength="80"></label><div class="acts" style="justify-content:flex-end"><button class="btn" id="tl_xc">Cancel</button><button class="btn pri" id="tl_xok">Save</button></div>');
    $('#tl_xc', bg).onclick = closeModal;
    $('#tl_xok', bg).onclick = async () => {
      const name = ($('#tl_xname', bg).value || '').trim() || 'Untitled query'; closeModal();
      await sAdd('queries', { name, q: JSON.parse(JSON.stringify(q)), author: me().name, role: ROLE, sql: tl_sql(q, res) });
      audit('query.save', name, q.types.join('+') + ' by ' + q.group + ' · ' + q.metric);
      toast('Saved “' + name + '”'); tl_X.preset = name; tl_exSaved(el);
    };
  };
  tl_exSaved(el);
}
async function tl_exSaved(el) {
  const box = $('#tl_xsaved', el); if (!box) return;
  let list = []; try { list = await sList('queries'); } catch (e) {}
  if (!box.isConnected) return;
  if (!list.length) { box.innerHTML = '<div class="empty">No saved queries yet. Build one and press <b>Save query</b>.</div>'; return; }
  box.innerHTML = '<div class="list">' + list.slice(0, 20).map((x, i) => '<div class="li"><div style="flex:1"><div class="t">' + esc(x.name) + '</div><div class="s">' + esc(x.author || '') + ' · ' + esc((x.at || '').slice(0, 10)) + ' · ' + esc(((x.q || {}).types || []).join(', ')) + ' by ' + esc((x.q || {}).group || '') + '</div></div><button class="btn sm" data-ld="' + i + '">Load</button><button class="btn sm ghost" data-dl="' + i + '" aria-label="Delete saved query">✕</button></div>').join('') + '</div>';
  box.querySelectorAll('[data-ld]').forEach((b) => { b.onclick = () => { const x = list[+b.dataset.ld]; tl_loadQ(x.q || {}, x.name); audit('query.run', x.name, 'Loaded saved query'); tl_exRender(el); }; });
  box.querySelectorAll('[data-dl]').forEach((b) => { b.onclick = async () => { if (!gate('author', 'Delete saved query')) return; const x = list[+b.dataset.dl]; await sDel('queries', x.id); audit('query.delete', x.name, ''); tl_exSaved(el); }; });
}

// ===================================================================================================
// 2. SCOUTING: database, profile (p-<slug>), club (club-<KEY>)
// ===================================================================================================
const tl_SC = { grp: '', club: '', minApps: 1, q: '', sort: { k: 'rating', dir: 'desc' }, x: 'done90', y: 'wins90', cmp: {}, ask: '', askRun: null, sqSort: { k: 'num', dir: 'asc' } };
page({
  id: 'scouting', title: 'Scouting', group: 'Analysis tools',
  render(el, arg) {
    if (arg && arg.startsWith('p-')) { const p = tl_bySlug(arg.slice(2)); if (p) return tl_profile(el, p); el.innerHTML = pgHead('Player not found', 'No player matches “' + esc(arg.slice(2)) + '”.', '<button class="btn" data-go="scouting">Back to the database</button>'); return tl_bindGo(el); }
    if (arg && arg.startsWith('club-')) return tl_club(el, arg.slice(5));
    tl_scDb(el);
  },
});
const tl_scFilter = () => D.players.filter((p) => (!tl_SC.grp || p.group === tl_SC.grp) && (!tl_SC.club || p.team === tl_SC.club) && p.apps >= tl_SC.minApps && (!tl_SC.q || (p.name + ' ' + clubName(p.team) + ' ' + p.pos).toLowerCase().includes(tl_SC.q.toLowerCase())));
function tl_scatter({ pts, xLabel, yLabel, w = 640, h = 320, xd = 1, yd = 1 }) {
  if (!pts.length) return '<div class="empty">No players match these filters.</div>';
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const pad = (a, b) => { const r = (b - a) || Math.abs(b) || 1; return [Math.max(0, a - r * 0.08), b + r * 0.08]; };
  const [x0, x1] = pad(Math.min(...xs), Math.max(...xs)), [y0, y1] = pad(Math.min(...ys), Math.max(...ys));
  const L = 46, Rr = 14, T = 16, B = 36, X = (x) => L + ((x - x0) / (x1 - x0)) * (w - L - Rr), Y = (y) => T + (1 - (y - y0) / (y1 - y0)) * (h - T - B);
  let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" role="img" aria-label="' + esc(yLabel + ' against ' + xLabel) + '" style="height:auto;display:block">';
  for (let i = 0; i <= 4; i++) { const v = y0 + ((y1 - y0) * i) / 4, u = x0 + ((x1 - x0) * i) / 4; s += '<line class="gl" x1="' + L + '" x2="' + (w - Rr) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="ax" x="' + (L - 5) + '" y="' + (Y(v) + 3) + '" text-anchor="end">' + fmt(v, yd) + '</text><text class="ax" x="' + X(u) + '" y="' + (h - 20) + '" text-anchor="middle">' + fmt(u, xd) + '</text>'; }
  s += '<text class="ax" x="' + ((L + w - Rr) / 2) + '" y="' + (h - 4) + '" text-anchor="middle">' + esc(xLabel) + ' →</text><text class="ax" x="' + L + '" y="' + (T - 5) + '">↑ ' + esc(yLabel) + '</text>';
  const ax = avg(xs), ay = avg(ys);
  s += '<line x1="' + X(ax) + '" x2="' + X(ax) + '" y1="' + T + '" y2="' + (h - B) + '" stroke="var(--line-2)" stroke-dasharray="3 3"/><line x1="' + L + '" x2="' + (w - Rr) + '" y1="' + Y(ay) + '" y2="' + Y(ay) + '" stroke="var(--line-2)" stroke-dasharray="3 3"/>';
  const lab = pts.slice().sort((a, b) => (b.x - ax) / ((x1 - x0) || 1) + (b.y - ay) / ((y1 - y0) || 1) - ((a.x - ax) / ((x1 - x0) || 1) + (a.y - ay) / ((y1 - y0) || 1))).slice(0, 8).map((p) => p.id);
  const placed = []; const labOk = (p) => { if (!lab.includes(p.id)) return false; const x = X(p.x), y = Y(p.y); if (x > w - 70 || placed.some((q) => Math.abs(q[0] - x) < 70 && Math.abs(q[1] - y) < 12) || placed.length >= 5) return false; placed.push([x, y]); return true; };
  for (const p of pts) s += '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="5.5" fill="' + p.color + '" fill-opacity=".85" stroke="var(--surface)" stroke-width="1.2" data-id="' + esc(p.id) + '" style="cursor:pointer" tabindex="0"><title>' + esc(p.title) + '</title></circle>' + (labOk(p) ? '<text x="' + (X(p.x) + 8).toFixed(1) + '" y="' + (Y(p.y) + 3).toFixed(1) + '" style="font-size:10px;fill:var(--ink-2)">' + esc(p.label) + '</text>' : '');
  return s + '</svg>';
}
function tl_scDb(el) {
  const clubs = D.clubs;
  const ask = tl_SC.askRun;
  el.innerHTML = pgHead('Scouting', 'Every player in the league with season totals, per-90 rates and percentiles against his position group. Click a row or a dot to open the profile.', '<button class="btn" data-go="scouting.club-HAR">Our squad</button><button class="btn" id="tl_slist">Shortlist</button>') +
    '<div class="filters">' +
    '<label class="field">Position group<select id="tl_sgrp"><option value="">All</option>' + ['GK', 'DEF', 'MID', 'ATT'].map((g) => '<option value="' + g + '"' + (tl_SC.grp === g ? ' selected' : '') + '>' + TL_GRP[g][0].toUpperCase() + TL_GRP[g].slice(1) + '</option>').join('') + '</select></label>' +
    '<label class="field">Club<select id="tl_sclub"><option value="">All clubs</option>' + clubs.map((c) => '<option value="' + c.key + '"' + (tl_SC.club === c.key ? ' selected' : '') + '>' + esc(c.club) + '</option>').join('') + '</select></label>' +
    '<label class="field">Min. appearances<input id="tl_sapps" type="number" min="1" max="60" value="' + tl_SC.minApps + '" style="width:110px"></label>' +
    '<label class="field" style="flex:1;min-width:180px">Search<input id="tl_sq" placeholder="Name, club or position" value="' + esc(tl_SC.q) + '"></label>' +
    '</div>' +
    '<div id="tl_sres"></div>';
  const askCard = card('Ask the Scout', 'The Scout agent searches the player database with tool calls. Without Claude it answers from fixed rules over the same metrics.',
      '<form class="tl_row" id="tl_saskf"><input class="inp" id="tl_sask" style="flex:1;min-width:200px" placeholder="e.g. Best young ball-winning midfielder" value="' + esc(tl_SC.ask) + '"><button class="btn pri" type="submit">Ask' + lockBtn('ask') + '</button></form>' +
      '<div class="tl_row" style="margin-top:8px">' + ['Best young ball-winning midfielder', 'Which attacker has the most xG per 90?', 'Most secure passer among defenders', 'Who is similar to ' + ((D.players.find((p) => p.group === 'ATT') || {}).name || '') + '?'].map((t) => '<button class="btn sm ghost" data-ex="' + esc(t) + '">' + esc(t) + '</button>').join('') + '</div>' +
      '<div id="tl_sans">' + (ask ? tl_askHtml(ask) : '') + '</div>');
  tl_SC.askCard = askCard;
  tl_scRes(el);
  const re = () => tl_scDb(el);
  $('#tl_sgrp', el).onchange = (e) => { tl_SC.grp = e.target.value; re(); };
  $('#tl_sclub', el).onchange = (e) => { tl_SC.club = e.target.value; re(); };
  $('#tl_sapps', el).onchange = (e) => { tl_SC.minApps = clamp(+e.target.value || 1, 1, 99); re(); };
  $('#tl_sq', el).oninput = (e) => { tl_SC.q = e.target.value; tl_scRes(el); };
  $('#tl_slist', el).onclick = () => tl_shortlistModal();
  $('#tl_saskf', el).onsubmit = (e) => { e.preventDefault(); tl_scAsk(el, $('#tl_sask', el).value); };
  el.querySelectorAll('[data-ex]').forEach((b) => { b.onclick = () => { $('#tl_sask', el).value = b.dataset.ex; tl_scAsk(el, b.dataset.ex); }; });
  tl_bindGo(el);
}
function tl_scRes(el) {
  const box = $('#tl_sres', el); if (!box) return;
  const ps = tl_scFilter();
  const mo = (k, cur) => TL_MX.map((x) => '<option value="' + x.k + '"' + (x.k === cur ? ' selected' : '') + '>' + esc(x.l) + '</option>').join('');
  const X = TL_MXK[tl_SC.x], Y = TL_MXK[tl_SC.y];
  const pts = ps.map((p) => ({ x: X.f(p) || 0, y: Y.f(p) || 0, color: ccol(p.team), id: tl_slug(p.name), label: p.name, title: p.name + ' (' + p.team + ', ' + p.pos + ') · ' + X.s + ' ' + fmt(X.f(p), X.d) + ' · ' + Y.s + ' ' + fmt(Y.f(p), Y.d) }));
  const p90 = (k) => (p) => fmt(TL_MXK[k].f(p), TL_MXK[k].d);
  const cols = [
    { k: 'name', l: 'Player', f: (p) => '<span class="dot" style="background:' + ccol(p.team) + '"></span><b>' + esc(p.name) + '</b> <span class="sub">#' + p.num + '</span>', v: (p) => p.name },
    { k: 'team', l: 'Club', f: (p) => esc(clubName(p.team)) },
    { k: 'pos', l: 'Pos', f: (p) => esc(p.pos) + ' <span class="sub">' + p.group + '</span>' },
    { k: 'apps', l: 'Apps', r: 1 },
    { k: 'rating', l: 'Rating', r: 1, f: (p) => '<b>' + fmt(p.rating, 2) + '</b>', t: 'Average match rating. ' + RATING_FORMULA },
    { k: 'goals', l: 'Goals', r: 1 },
    { k: 'xg', l: 'xG', r: 1, f: (p) => fmt(p.xg, 2) },
    { k: 'passPct', l: 'Pass %', r: 1, f: (p) => p.passPct + '%' },
    { k: 'xg90', l: 'xG/90', r: 1, f: p90('xg90'), v: TL_MXK.xg90.f },
    { k: 'done90', l: 'Cmp/90', r: 1, f: p90('done90'), v: TL_MXK.done90.f, t: 'Passes completed per 90' },
    { k: 'wins90', l: 'Wins/90', r: 1, f: p90('wins90'), v: TL_MXK.wins90.f, t: 'Ball wins per 90' },
    { k: 'tko90', l: 'T-ons/90', r: 1, f: p90('tko90'), v: TL_MXK.tko90.f, t: 'Take-ons won per 90' },
    { k: 'km90', l: 'Km/90', r: 1, f: p90('km90'), v: TL_MXK.km90.f, t: 'Distance at a 90-minute pace (matches run on a compressed clock)' },
  ];
  const oldAsk = $('#tl_saskbox', box); const keepAsk = oldAsk ? [...oldAsk.childNodes] : null; const askHtml = keepAsk ? '' : tl_SC.askCard;
  box.innerHTML = '<div class="grid">' +
    '<div class="s12 tl_scroll">' + card('Players', ps.length + ' of ' + D.players.length + ' players · per-90 = per match, since every player plays every minute', tbl(cols, ps, { id: 'tl_stbl', sort: tl_SC.sort, click: true, key: (p) => tl_slug(p.name), empty: 'No players match. Clear the search or lower the minimum appearances.' }) +
      '<div class="tl_formula" title="How the rating is calculated">Rating = ' + esc(RATING_FORMULA) + '</div>') + '</div>' +
    '<div class="s7">' + card('Scatter', 'Pick any two metrics. Dashed lines are the averages of the players shown.',
      '<div class="tl_row" style="margin-bottom:8px"><label class="field" style="flex:1">X axis<select id="tl_sx">' + mo('x', tl_SC.x) + '</select></label><label class="field" style="flex:1">Y axis<select id="tl_sy">' + mo('y', tl_SC.y) + '</select></label></div>' +
      '<div id="tl_ssc">' + tl_scatter({ pts, xLabel: X.l, yLabel: Y.l, xd: X.d, yd: Y.d, h: 360 }) + '</div>' +
      legend(D.clubs.filter((c) => ps.some((p) => p.team === c.key)).map((c) => [c.key, ccol(c.key)])) + tl_src(['Source: season player aggregates', ps.length + ' players'])) + '</div>' +
    '<div class="s5" id="tl_saskbox">' + askHtml + '</div>' +
    '</div>';
  if (keepAsk) $('#tl_saskbox', box).replaceChildren(...keepAsk);
  bindTbl(box, 'tl_stbl', tl_SC.sort, () => tl_scRes(el), (id) => go('scouting', 'p-' + id));
  $('#tl_sx', box).onchange = (e) => { tl_SC.x = e.target.value; tl_scRes(el); };
  $('#tl_sy', box).onchange = (e) => { tl_SC.y = e.target.value; tl_scRes(el); };
  box.querySelectorAll('circle[data-id]').forEach((c) => { c.onclick = () => go('scouting', 'p-' + c.dataset.id); c.onkeydown = (e) => { if (e.key === 'Enter') go('scouting', 'p-' + c.dataset.id); }; });
}
const tl_askHtml = (run) => '<div class="tl_ans">' + esc(run.text) + '</div><div class="tl_row" style="margin-top:8px">' + chip((AGENTS[run.agent] || {}).name + ' · ' + (run.src === 'ai' ? 'Claude' : 'rules'), 'acc') + tl_gchip(run) + (run.steps.length ? '<span class="note">Tools: ' + esc(run.steps.join(' → ')) + '</span>' : '') + '<span class="note">' + run.ms + ' ms</span></div>';
function tl_findMetric(q) {
  const t = q.toLowerCase();
  const map = [[/xg|expected/, 'xg90'], [/goal|scor|finish/, 'goals90'], [/shoot|shot/, 'shots90'], [/secure|lose|loss|careless|retain/, 'loss90'], [/pass.*(%|accura|percent)|accura|completion/, 'passPct'], [/pass|playmak|creat|distribut/, 'done90'], [/win|recover|press|ball-winn|ball winn|regain/, 'wins90'], [/dribbl|take-on|take on|beat/, 'tko90'], [/tackl/, 'tkl90'], [/run|distance|work|engine|stamina/, 'km90'], [/pace|fast|speed|quick/, 'top'], [/receiv|movement|find/, 'recv90']];
  for (const [re, k] of map) if (re.test(t)) return k;
  return 'rating';
}
function tl_findGroup(q) {
  const t = q.toLowerCase();
  if (/keeper|goalie|\bgk\b/.test(t)) return 'GK';
  if (/defend|centre-back|center-back|full-back|fullback|\bcb\b|back\b/.test(t)) return 'DEF';
  if (/midfield|\bdm\b|\bcm\b|\bam\b|playmaker/.test(t)) return 'MID';
  if (/attack|striker|forward|winger|\bst\b/.test(t)) return 'ATT';
  return '';
}
function tl_scoutRules(q) {
  const t = q.toLowerCase();
  const named = D.players.find((p) => t.includes(p.name.toLowerCase()) || t.includes(p.name.split(' ').slice(-1)[0].toLowerCase()));
  if (named && /similar|like|replace|alternative/.test(t)) {
    const sim = tl_similar(named, 3);
    return 'Players most similar to ' + named.name + ' (' + named.pos + ', ' + clubName(named.team) + '), by cosine similarity of percentile profiles among ' + TL_GRP[named.group] + ':\n' + sim.map((x, i) => (i + 1) + '. ' + x.p.name + ' (' + clubName(x.p.team) + ', ' + x.p.pos + '): similarity ' + fmt(x.sim * 100, 0) + '%, rating ' + fmt(x.p.rating, 2)).join('\n');
  }
  const k = tl_findMetric(q), g = tl_findGroup(q), mk = TL_MXK[k];
  const club = D.clubs.find((c) => t.includes(c.club.toLowerCase()) || new RegExp('\\b' + c.key.toLowerCase() + '\\b').test(t));
  const pool = D.players.filter((p) => (!g || p.group === g) && (!club || p.team === club.key) && p.apps >= Math.min(2, Math.max(...D.players.map((x) => x.apps))));
  const top = pool.slice().sort((a, b) => (mk.inv ? mk.f(a) - mk.f(b) : mk.f(b) - mk.f(a)) || b.rating - a.rating).slice(0, 5);
  if (!top.length) return 'No players match that question in this season’s data.';
  let out = '';
  if (/young|age|u2[0-9]|under/.test(t)) out += 'The data has no player ages, so I ranked on the metrics instead.\n';
  out += 'Top ' + (g ? TL_GRP[g] : 'players') + (club ? ' at ' + club.club : '') + ' by ' + tl_lc(mk.l) + ':\n';
  out += top.map((p, i) => (i + 1) + '. ' + p.name + ' (' + p.pos + ', ' + clubName(p.team) + '): ' + fmt(mk.f(p), mk.d) + ', ' + tl_ord(tl_pct(p, k) * 100) + ' percentile, rating ' + fmt(p.rating, 2) + ' over ' + p.apps + ' apps').join('\n');
  return out;
}
async function tl_scAsk(el, q) {
  q = (q || '').trim(); if (!q) return;
  if (!gate('ask', 'Ask the Scout')) return;
  tl_SC.ask = q; const box = $('#tl_sans', el); if (box) box.innerHTML = '<div class="note" style="margin-top:10px">The Scout is working…</div>';
  const row = (p) => ({ name: p.name, club: p.team, pos: p.pos, group: p.group, apps: p.apps, rating: p.rating, goals: p.goals, xg: p.xg, passPct: p.passPct });
  const tools = [
    { name: 'search_players', description: 'Rank players by a metric. Metrics: ' + TL_MX.map((x) => x.k + ' (' + x.l + ')').join(', ') + '. Optional group GK/DEF/MID/ATT and club key.', inputSchema: { type: 'object', properties: { metric: { type: 'string' }, group: { type: 'string' }, club: { type: 'string' }, limit: { type: 'number' } }, required: ['metric'] },
      execute: (i) => { const mk = TL_MXK[i.metric] || TL_MXK.rating; return D.players.filter((p) => (!i.group || p.group === i.group) && (!i.club || p.team === i.club)).sort((a, b) => (mk.inv ? mk.f(a) - mk.f(b) : mk.f(b) - mk.f(a))).slice(0, clamp(i.limit || 5, 1, 10)).map((p) => Object.assign(row(p), { value: +(+mk.f(p)).toFixed(2), percentile: Math.round(tl_pct(p, mk.k) * 100) })); } },
    { name: 'player_profile', description: 'Season totals and percentiles for one player by exact name.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      execute: (i) => { const p = D.player(i.name); if (!p) return { error: 'not found' }; return Object.assign(row(p), { percentiles: Object.fromEntries(TL_MX.map((x) => [x.k, Math.round(tl_pct(p, x.k) * 100)])) }); } },
    { name: 'similar_players', description: 'Players with the most similar percentile profile in the same position group.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      execute: (i) => { const p = D.player(i.name); if (!p) return { error: 'not found' }; return tl_similar(p, 5).map((x) => Object.assign(row(x.p), { similarity: Math.round(x.sim * 100) })); } },
  ];
  const ctx = { note: 'No player ages exist in the data. Per-90 equals per match.', groups: { GK: 'goalkeepers', DEF: 'defenders', MID: 'midfielders', ATT: 'attackers' }, clubs: D.clubs.map((c) => ({ key: c.key, club: c.club })), metrics: TL_MX.map((x) => ({ k: x.k, l: x.l })) };
  const run = await askAgent({ agent: 'scout', q, ctx, tools, rules: () => tl_scoutRules(q) });
  tl_SC.askRun = run; const b2 = $('#tl_sans', el); if (b2) b2.innerHTML = tl_askHtml(run);
}
async function tl_shortlistModal() {
  let list = []; try { list = await sList('shortlist'); } catch (e) {}
  const bg = modal('<h3>Shortlist</h3><p class="note">Players flagged by the scouting team. Shared with your organisation.</p>' +
    (list.length ? '<div class="list">' + list.map((x, i) => { const p = D.player(x.name); return '<div class="li"><div style="flex:1"><div class="t">' + (p ? '<span class="dot" style="background:' + ccol(p.team) + '"></span>' : '') + esc(x.name) + '</div><div class="s">' + esc(x.pos || '') + ' · ' + esc(clubName(x.team)) + ' · added by ' + esc(x.by || '') + ' on ' + esc((x.at || '').slice(0, 10)) + (x.note ? ' · ' + esc(x.note) : '') + '</div></div><button class="btn sm" data-o="' + i + '">Open</button><button class="btn sm ghost" data-r="' + i + '" aria-label="Remove">✕</button></div>'; }).join('') + '</div>' : '<div class="empty">No players on the shortlist yet. Open a profile and press <b>Add to shortlist</b>.</div>') +
    '<div class="acts" style="justify-content:flex-end;margin-top:12px"><button class="btn" id="tl_slx">Close</button></div>');
  $('#tl_slx', bg).onclick = closeModal;
  bg.querySelectorAll('[data-o]').forEach((b) => { b.onclick = () => { closeModal(); go('scouting', 'p-' + tl_slug(list[+b.dataset.o].name)); }; });
  bg.querySelectorAll('[data-r]').forEach((b) => { b.onclick = async () => { if (!gate('author', 'Remove from shortlist')) return; const x = list[+b.dataset.r]; await sDel('shortlist', x.id); audit('shortlist.remove', x.name, ''); closeModal(); tl_shortlistModal(); }; });
}
function tl_heat(names, club) {
  const NX = 21, NY = 14, H = new Array(NX * NY).fill(0); let n = 0, ms = 0;
  for (const m of D.matches) {
    for (const name of names) {
      const idx = (m.pids || []).findIndex((p) => p.name === name); if (idx < 0) continue; ms++;
      for (const fr of m.frames || []) { const p = tl_norm(fr, idx); if (!p) continue; const bx = clamp(Math.floor(p[0] / 5), 0, NX - 1), by2 = clamp(Math.floor(p[1] / (68 / NY)), 0, NY - 1); H[by2 * NX + bx]++; n++; }
    }
  }
  if (!n) return { svg: '<div class="empty">No tracking frames for this player yet.</div>', n: 0, ms };
  const mx = Math.max(...H); let inner = '';
  H.forEach((c, i) => { if (!c) return; const x = (i % NX) * 5, y = Math.floor(i / NX) * (68 / NY); inner += '<rect x="' + x + '" y="' + y.toFixed(2) + '" width="5" height="' + (68 / NY).toFixed(2) + '" fill="var(--bad)" fill-opacity="' + (0.08 + 0.75 * Math.pow(c / mx, 0.7)).toFixed(2) + '"/>'; });
  inner += '<text x="52.5" y="66.5" text-anchor="middle" style="font-size:2.4px;fill:var(--muted)">attacking direction →</text>';
  return { svg: pitch(inner, { title: 'Heatmap' }), n, ms };
}
function tl_profile(el, p) {
  const cmp = (tl_SC.cmp[p.name] || []).map((n) => D.player(n)).filter(Boolean);
  const sim = tl_similar(p, 5); const sw = tl_sw(p);
  const g = TL_GRP[p.group];
  const head = '<div class="tl_ph"><div class="tl_num" style="background:' + ccol(p.team) + '">' + p.num + '</div><div style="min-width:0"><div class="note">' + esc(p.pos) + ' · ' + esc(g.replace(/s$/, '')) + ' · <button class="btn ghost sm" style="padding:0;min-height:0" data-go="scouting.club-' + p.team + '">' + tl_ctag(p.team) + '</button></div></div></div>';
  const kp = '<div class="kpis">' + kpi('Appearances', p.apps, 'full matches') + kpi('Avg rating', fmt(p.rating, 2), 'percentile ' + tl_ord(tl_pct(p, 'rating') * 100)) + kpi('Goals', p.goals, 'xG ' + fmt(p.xg, 2)) + kpi('Pass completion', p.passPct + '%', p.done + ' of ' + p.passes) + kpi('Ball wins', p.wins, fmt(p.wins / p.apps, 2) + ' per 90') + kpi('Km/90', fmt(p.per90, 1) + '<small>km/90</small>', 'top speed ' + fmt(p.top, 1) + ' km/h') + '</div>';
  const pctRows = '<div>' + TL_MX.map((x) => { const pc = tl_pct(p, x.k); return '<div class="tl_pbar"><span title="' + esc(x.l) + '">' + esc(x.l.replace(' (fewer ranks higher)', ' ↓').replace(' (distance at 90-minute pace)', '')) + '</span><div class="bar"><i style="width:' + (pc * 100).toFixed(0) + '%;background:' + (pc >= 0.7 ? 'var(--good)' : pc <= 0.3 ? 'var(--bad)' : 'var(--info)') + '"></i></div><span class="num" style="text-align:right">' + fmt(x.f(p), x.d) + '</span><span class="num note" style="text-align:right">' + tl_ord(pc * 100) + '</span></div>'; }).join('') + '</div>';
  const radarCard = tl_safe(() => card('Percentile radar', 'Against ' + D.players.filter((q) => q.group === p.group).length + ' ' + g + ' · 0 = lowest, edge = highest',
    '<div class="tl_rad">' + radar(TL_RAD.map((x) => ({ l: x.s })), [{ name: p.name, color: ccol(p.team), vals: tl_vec(p) }], 320) + '</div>' + tl_src(['Source: season aggregates', 'Unit: percentile within position group', '“Security” is inverted ball losses'])), 'Radar');
  const games = p.games || [];
  const rl = tl_safe(() => {
    if (!games.length) return '<div class="empty">No matches yet.</div>';
    const pts = games.map((x, i) => [i + 1, x.rating]);
    const step = Math.max(1, Math.ceil(games.length / 8));
    return lineChart({ series: [{ name: 'Rating', color: ccol(p.team), pts }], h: 200, xMin: 1, xMax: Math.max(2, games.length), yMin: 4, yMax: 10, xTicks: games.map((_, i) => i + 1).filter((i) => (i - 1) % step === 0), xFmt: (i) => { const x = games[i - 1]; const m = x && D.match(x.id); return m ? 'MD' + m.matchday : ''; }, yLabel: 'match rating', marks: games.map((x, i) => ({ x: i + 1, y: x.rating, color: ccol(p.team), title: dateLbl(x.date) + ' vs ' + clubName(x.opp) + ': ' + x.rating })) });
  }, 'Rating line');
  const ht = tl_heat([p.name]);
  const bestGame = games.slice().sort((a, b) => b.rating - a.rating)[0];
  const others = D.players.filter((q) => q.name !== p.name && !cmp.includes(q)).sort((a, b) => (a.group === p.group ? 0 : 1) - (b.group === p.group ? 0 : 1) || (a.name < b.name ? -1 : 1));
  const cmpSets = [p].concat(cmp);
  const CC = ['var(--accent)', 'var(--info)', 'var(--warn)'];
  const cmpBody = cmp.length ? '<div class="grid"><div class="s5"><div class="tl_rad">' + radar(TL_RAD.map((x) => ({ l: x.s })), cmpSets.map((q, i) => ({ name: q.name, color: CC[i], vals: tl_vec(q), dash: i > 0 }))) + '</div>' + legend(cmpSets.map((q, i) => [q.name + ' (' + q.team + ')', CC[i]])) + '<p class="note">Percentiles are within each player’s own position group.</p></div><div class="s7">' +
    tbl([{ k: 'l', l: 'Metric', f: (r) => esc(r.l) }].concat(cmpSets.map((q, i) => ({ k: 'c' + i, l: '<span class="dot" style="background:' + CC[i] + '"></span>' + esc(q.name.split(' ').slice(-1)[0]), r: 1, f: (r) => r.c[i] }))), [{ l: 'Position', c: cmpSets.map((q) => esc(q.pos)) }, { l: 'Club', c: cmpSets.map((q) => q.team) }, { l: 'Apps', c: cmpSets.map((q) => q.apps) }].concat(TL_MX.map((x) => { const vals = cmpSets.map((q) => x.f(q)); const best = x.inv ? Math.min(...vals) : Math.max(...vals); return { l: x.l, c: vals.map((v) => (v === best && cmpSets.length > 1 ? '<b>' + fmt(v, x.d) + '</b>' : fmt(v, x.d))) }; }))) + '</div></div>' : '<div class="empty">Add up to two players to overlay their radars and compare season numbers side by side.</div>';

  el.innerHTML = pgHead(esc(p.name), head, '<button class="btn" id="tl_pshort">Add to shortlist' + lockBtn('author') + '</button><button class="btn" data-go="opposition.' + p.team + '">Opposition report: ' + esc(p.team) + '</button>', [['Scouting', 'scouting'], [clubName(p.team), 'scouting.club-' + p.team], [p.name]]) +
    kp +
    '<div class="grid">' +
    '<div class="s5">' + radarCard + '</div>' +
    '<div class="s7">' + card('Percentiles and per-90 values', 'Value · percentile among ' + g + ' (green ≥ 70th, red ≤ 30th)', pctRows) + '</div>' +
    '<div class="s7">' + card('Match ratings', games.length + ' matches' + (bestGame ? ' · best ' + bestGame.rating + ' vs ' + esc(clubName(bestGame.opp)) : ''), rl + '<div class="tl_formula">Rating = ' + esc(RATING_FORMULA) + '</div>') + '</div>' +
    '<div class="s5">' + card('Heatmap', 'Tracking positions every 30 s of match time, ' + ht.ms + ' matches, normalised so he always attacks right', ht.svg + tl_src(['Source: tracking frames', fmt(ht.n) + ' samples', 'Cell: 5 × 4.9 m'])) + '</div>' +
    '<div class="s6">' + card('Scouting notes', 'Generated from the percentiles above, not from opinion',
      '<div class="note" style="margin-bottom:4px"><b>Strengths</b></div>' + (sw.st.length ? '<ul class="tl_sw">' + sw.st.map((x) => '<li>' + x + '</li>').join('') + '</ul>' : '<p class="note">No metric reaches the 70th percentile of his group.</p>') +
      '<div class="note" style="margin:10px 0 4px"><b>Weaknesses</b></div>' + (sw.wk.length ? '<ul class="tl_sw">' + sw.wk.map((x) => '<li>' + x + '</li>').join('') + '</ul>' : '<p class="note">No metric falls below the 30th percentile of his group.</p>')) + '</div>' +
    '<div class="s6">' + card('Similar players', 'Cosine similarity of centred percentile profiles, same position group',
      sim.length ? '<div class="list">' + sim.map((x) => '<div class="li" style="align-items:center"><div style="flex:1"><div class="t"><span class="dot" style="background:' + ccol(x.p.team) + '"></span>' + esc(x.p.name) + '</div><div class="s">' + esc(x.p.pos) + ' · ' + esc(clubName(x.p.team)) + ' · rating ' + fmt(x.p.rating, 2) + '</div></div><span class="chip ' + (x.sim > 0.7 ? 'good' : x.sim > 0.4 ? 'info' : '') + '">' + fmt(x.sim * 100, 0) + '%</span><button class="btn sm" data-go="scouting.p-' + tl_slug(x.p.name) + '">Open</button><button class="btn sm" data-cmp="' + esc(x.p.name) + '"' + (cmp.length >= 2 ? ' disabled' : '') + '>Compare</button></div>').join('') + '</div>' : '<div class="empty">No other players in this group.</div>') + '</div>' +
    '<div class="s12">' + card('Compare', 'Up to two other players', '<div class="tl_row" style="margin-bottom:12px"><select class="inp" id="tl_pcsel" style="flex:1;min-width:200px;max-width:380px"' + (cmp.length >= 2 ? ' disabled' : '') + '><option value="">Choose a player…</option>' + others.map((q) => '<option value="' + esc(q.name) + '">' + esc(q.name) + ' · ' + q.pos + ' · ' + q.team + '</option>').join('') + '</select><button class="btn" id="tl_pcadd"' + (cmp.length >= 2 ? ' disabled' : '') + '>Add</button>' + cmp.map((q) => '<span class="chip">' + esc(q.name) + ' <button class="btn ghost sm" style="min-height:0;padding:0 2px" data-rm="' + esc(q.name) + '" aria-label="Remove ' + esc(q.name) + '">✕</button></span>').join('') + '</div>' + cmpBody) + '</div>' +
    '</div>';
  const re = () => tl_profile(el, p);
  const add = (n) => { if (!n) return; const a = tl_SC.cmp[p.name] || (tl_SC.cmp[p.name] = []); if (a.length < 2 && !a.includes(n)) a.push(n); re(); };
  $('#tl_pcadd', el).onclick = () => add($('#tl_pcsel', el).value);
  el.querySelectorAll('[data-cmp]').forEach((b) => { b.onclick = () => add(b.dataset.cmp); });
  el.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { tl_SC.cmp[p.name] = (tl_SC.cmp[p.name] || []).filter((x) => x !== b.dataset.rm); re(); }; });
  $('#tl_pshort', el).onclick = async () => {
    if (!gate('author', 'Add to shortlist')) return;
    let list = []; try { list = await sList('shortlist'); } catch (e) {}
    if (list.some((x) => x.name === p.name)) return toast(p.name + ' is already on the shortlist.');
    await sAdd('shortlist', { name: p.name, team: p.team, pos: p.pos, rating: p.rating, by: me().name, note: sw.st.length ? sw.st[0].replace(/<[^>]+>/g, '') : '' });
    audit('shortlist.add', p.name, p.pos + ' · ' + p.team + ' · rating ' + p.rating); toast(p.name + ' added to the shortlist');
  };
  tl_bindGo(el);
}
function tl_club(el, key) {
  const c = D.clubs.find((x) => x.key === key);
  if (!c) { el.innerHTML = pgHead('Club not found', 'No club has the key “' + esc(key) + '”.', '<button class="btn" data-go="scouting">Back to the database</button>'); return tl_bindGo(el); }
  const t = D.table.find((x) => x.key === key) || {};
  const sq = D.players.filter((p) => p.team === key);
  const cols = [
    { k: 'num', l: '#', r: 1 },
    { k: 'name', l: 'Player', f: (p) => '<b>' + esc(p.name) + '</b>' },
    { k: 'pos', l: 'Pos' },
    { k: 'abil', l: 'Ability', r: 1, t: 'Engine ability rating (76–93)' },
    { k: 'apps', l: 'Apps', r: 1 },
    { k: 'rating', l: 'Rating', r: 1, f: (p) => '<b>' + fmt(p.rating, 2) + '</b>', t: RATING_FORMULA },
    { k: 'goals', l: 'Goals', r: 1 }, { k: 'xg', l: 'xG', r: 1, f: (p) => fmt(p.xg, 2) },
    { k: 'passPct', l: 'Pass %', r: 1, f: (p) => p.passPct + '%' }, { k: 'wins', l: 'Ball wins', r: 1 }, { k: 'takeOnsWon', l: 'Take-ons won', r: 1 }, { k: 'tackles', l: 'Tackles', r: 1 },
    { k: 'per90', l: 'Km/90', r: 1, f: (p) => fmt(p.per90, 1), t: 'Distance at a 90-minute pace (matches run on a compressed clock)' },
  ];
  const top = sq.slice().sort((a, b) => b.rating - a.rating).slice(0, 8);
  el.innerHTML = pgHead('<span class="dot" style="background:' + ccol(key) + ';width:14px;height:14px"></span>' + esc(c.club), esc([c.city, c.stadium, c.coach ? 'Coach ' + c.coach : ''].filter(Boolean).join(' · ')), '<button class="btn pri" data-go="opposition.' + key + '">Opposition report</button>', [['Scouting', 'scouting'], [c.club]]) +
    '<div class="kpis">' + kpi('League position', t.pos ? tl_ord(t.pos) : '–', t.pts != null ? t.pts + ' pts from ' + t.p : '') + kpi('Record', (t.w ?? 0) + '–' + (t.d ?? 0) + '–' + (t.l ?? 0), 'W–D–L') + kpi('Goals', (t.gf ?? 0) + ':' + (t.ga ?? 0), 'for : against') + kpi('xG difference', fmt(t.xgd, 2), 'xG ' + fmt(t.xg, 2) + ' · xGA ' + fmt(t.xga, 2), t.xgd > 0 ? 'good' : t.xgd < 0 ? 'bad' : '') + kpi('Squad avg rating', fmt(avg(sq, (p) => p.rating), 2), sq.length + ' players') + '</div>' +
    '<div class="grid"><div class="s8">' + card('Squad', 'Season numbers · click a player for the profile', tbl(cols, sq, { id: 'tl_ctbl', sort: tl_SC.sqSort, click: true, key: (p) => tl_slug(p.name), empty: 'No players have appeared for this club yet.' }) + '<div class="tl_formula">Rating = ' + esc(RATING_FORMULA) + '</div>') + '</div>' +
    '<div class="s4">' + card('Ratings', 'Top 8 by average match rating', hbars(top.map((p) => ({ label: p.name + ' · ' + p.pos, v: p.rating, color: ccol(key) })), { max: 10, fmt: (v) => fmt(v, 2) }) + tl_src(['Source: season aggregates', 'Unit: rating 3–10'])) + '</div></div>';
  bindTbl(el, 'tl_ctbl', tl_SC.sqSort, () => tl_club(el, key), (id) => go('scouting', 'p-' + id));
  tl_bindGo(el);
}

// ===================================================================================================
// 3. OPPOSITION REPORT
// ===================================================================================================
const tl_OP = { club: null, draft: {}, submitted: {} };
function tl_defaultOpp() {
  const played = new Set(D.matches.map((m) => m.id));
  const fx = (D.league && D.league.fixtures) || [];
  for (let k = 0; k < fx.length; k++) { const id = 'M' + String(k + 1).padStart(3, '0'); const f = fx[k]; if (!played.has(id) && (f.home === 'HAR' || f.away === 'HAR')) return { key: f.home === 'HAR' ? f.away : f.home, why: 'next fixture (matchday ' + f.md + ')' }; }
  const t = D.table.find((x) => x.key !== 'HAR'); return { key: t ? t.key : (D.clubs.find((c) => c.key !== 'HAR') || {}).key, why: 'highest-placed rival (no unplayed fixture left)' };
}
function tl_opp(club) {
  const ms = tl_clubMatches(club); const roster = new Set(D.players.filter((p) => p.team === club).map((p) => p.name));
  const rows = ms.map((m) => { const s = m.ts[club]; const opp = m.home === club ? m.away : m.home; return { m, opp, ha: m.home === club ? 'H' : 'A', gf: s.goals, ga: s.against, xg: s.xg, xga: s.xga, form: s.form, style: s.style, res: s.result, ppda: s.ppda, poss: s.poss, high: s.highWins, shots: s.shots, ost: m.ts[opp].shots }; });
  const cnt = (a) => { const o = {}; for (const x of a) if (x) o[x] = (o[x] || 0) + 1; return Object.entries(o).sort((a, b) => b[1] - a[1]); };
  const forms = cnt(rows.map((r) => r.form)), styles = cnt(rows.map((r) => r.style));
  const kinds = {}, phases = {}; let pAll = 0, pOk = 0;
  const losses = [], conceded = []; let lossN = 0;
  for (const m of ms) {
    tl_prep(m); const ev = m.events || [];
    ev.forEach((e, i) => {
      if (e.type === 'pass' && e.team === club) { const k = e.kind || 'pass'; const o = kinds[k] || (kinds[k] = { n: 0, ok: 0, att: 0 }); o.n++; const ok = m.tl_ok.get(i); if (ok != null) { o.att++; pAll++; if (ok) { o.ok++; pOk++; } } phases[e.phase || 'other'] = (phases[e.phase || 'other'] || 0) + 1; }
      if (e.type === 'turnover' && roster.has(e.from)) { lossN++; if (e.ax != null) losses.push({ x: 105 - e.ax, y: 68 - e.ay, who: e.from, min: e.minute, m: m.id }); }
      if (e.type === 'shot' && e.team !== club && e.team) conceded.push({ x: e.ax, y: e.ay, xg: e.xg || 0, goal: !!m.tl_ok.get(i), who: e.player, min: e.minute, m: m.id });
    });
  }
  // pass network for the most common formation
  const f0 = forms[0] ? forms[0][0] : null; const fm = ms.filter((m) => m.ts[club].form === f0);
  const pair = {}, inv = {}, pos = {};
  for (const m of fm) {
    for (const e of m.events || []) if (e.type === 'pass' && e.team === club && e.to) { const k = [e.player, e.to].sort().join('|'); pair[k] = (pair[k] || 0) + 1; inv[e.player] = (inv[e.player] || 0) + 1; inv[e.to] = (inv[e.to] || 0) + 1; }
    (m.pids || []).forEach((pd, i) => { if (pd.team !== club) return; const a = pos[pd.name] || (pos[pd.name] = { x: 0, y: 0, n: 0, num: pd.num }); for (const fr of m.frames || []) { const p = tl_norm(fr, i); if (p) { a.x += p[0]; a.y += p[1]; a.n++; } } });
  }
  const players = D.players.filter((p) => p.team === club);
  const key3 = players.slice().sort((a, b) => b.rating - a.rating || (b.goals + b.xg) - (a.goals + a.xg) || b.done - a.done).slice(0, 3);
  const danger = players.slice().sort((a, b) => (b.goals + b.xg) - (a.goals + a.xg) || b.takeOnsWon - a.takeOnsWon)[0];
  const ppdaAll = D.clubs.map((c) => { const v = tl_clubMatches(c.key).map((m) => m.ts[c.key].ppda).filter((x) => x != null); return { key: c.key, v: v.length ? avg(v) : null }; }).filter((x) => x.v != null).sort((a, b) => a.v - b.v);
  const ppda = (ppdaAll.find((x) => x.key === club) || {}).v; const ppdaRank = ppdaAll.findIndex((x) => x.key === club) + 1;
  const sp = tl_spClub(club);
  const thirds = [0, 0, 0], lanes = [0, 0, 0]; for (const l of losses) { thirds[l.x < 35 ? 0 : l.x < 70 ? 1 : 2]++; lanes[l.y < 22.7 ? 0 : l.y < 45.3 ? 1 : 2]++; }
  const t = D.table.find((x) => x.key === club) || {};
  return { club, ms, rows, forms, styles, kinds, phases, pAll, pOk, losses, lossN, conceded, f0, fm, pair, inv, pos, players, key3, danger, ppda, ppdaRank, ppdaN: ppdaAll.length, sp, thirds, lanes, t,
    w: rows.filter((r) => r.res === 'W').length, d: rows.filter((r) => r.res === 'D').length, l: rows.filter((r) => r.res === 'L').length,
    gf: sum(rows, (r) => r.gf), ga: sum(rows, (r) => r.ga), xg: sum(rows, (r) => r.xg), xga: sum(rows, (r) => r.xga), high: sum(rows, (r) => r.high), poss: avg(rows, (r) => r.poss) };
}
const TL_THIRD = ['own third', 'middle third', 'final third'], TL_LANE = ['left channel', 'centre', 'right channel'];
function tl_oppRules(o) {
  const N = o.ms.length; const name = clubName(o.club);
  if (!N) return '• ' + name + ' have not played a match in this dataset yet.';
  const topKind = Object.entries(o.kinds).sort((a, b) => b[1].n - a[1].n)[0];
  const ti = o.thirds.indexOf(Math.max(...o.thirds)), li = o.lanes.indexOf(Math.max(...o.lanes));
  const conXg = sum(o.conceded, (s) => s.xg);
  const b = [];
  b.push('Results: ' + o.w + 'W ' + o.d + 'D ' + o.l + 'L from ' + N + ' matches, goals ' + o.gf + '–' + o.ga + ', xG ' + fmt(o.xg / N, 2) + ' for and ' + fmt(o.xga / N, 2) + ' against per match. Recent form ' + o.rows.slice(-5).map((r) => r.res).join('') + '.');
  b.push('Shape: ' + (o.f0 || 'unknown') + ' in ' + (o.forms[0] ? o.forms[0][1] : 0) + ' of ' + N + ' matches, usually ' + (o.styles[0] ? o.styles[0][0] : 'balanced') + '. Build-up leans on the ' + (topKind ? topKind[0] + ' (' + pct(topKind[1].n, sum(Object.values(o.kinds), (k) => k.n)) + '% of passes)' : 'short pass') + ', with ' + pct(o.pOk, o.pAll) + '% of passes completed.');
  b.push('Pressing: PPDA ' + fmt(o.ppda, 1) + ' (press rank ' + o.ppdaRank + ' of ' + o.ppdaN + ', 1 = most aggressive), with ' + fmt(o.high / N, 1) + ' high ball wins (final third) per match.');
  b.push('Where to press them: ' + o.lossN + ' ball losses, most in their ' + TL_THIRD[ti] + ' (' + o.thirds[ti] + ') and ' + TL_LANE[li] + ' (' + o.lanes[li] + '). They conceded ' + o.conceded.length + ' shots worth ' + fmt(conXg, 2) + ' xG.');
  b.push('Key threat: ' + (o.danger ? o.danger.name + ' (' + o.danger.pos + ', ' + o.danger.goals + ' goals, ' + fmt(o.danger.xg, 2) + ' xG)' : 'no standout player') + '. Set pieces: ' + o.sp.sp + ' won, ' + o.sp.shots + ' shots and ' + fmt(o.sp.xg, 2) + ' xG within ' + tl_SPS.win + ' match minutes of the restart.');
  return b.map((x) => '• ' + x).join('\n');
}
function tl_oppMd(o, draft) {
  const name = clubName(o.club); const N = o.ms.length;
  const L = ['# Opposition report: ' + name, '', '_Prepared by ' + me().name + ' (' + me().title + '), ' + new Date().toISOString().slice(0, 10) + '. Source: MatchCast ' + D.version + ', ' + N + ' matches (' + o.ms.map((m) => m.id).join(', ') + '). Synthetic data._', '', '## Summary', draft || tl_oppRules(o), '',
    '## Results', '| Date | Opponent | H/A | Score | xG | xGA | Formation | Style |', '|---|---|---|---|---|---|---|---|'];
  for (const r of o.rows) L.push('| ' + r.m.date + ' | ' + clubName(r.opp) + ' | ' + r.ha + ' | ' + r.gf + '–' + r.ga + ' (' + r.res + ') | ' + fmt(r.xg, 2) + ' | ' + fmt(r.xga, 2) + ' | ' + r.form + ' | ' + r.style + ' |');
  L.push('', '## Build-up', '- Most used formation: ' + (o.f0 || '–'), '- Pass completion: ' + pct(o.pOk, o.pAll) + '% (' + o.pOk + ' of ' + o.pAll + ', success = next on-ball event by the same team)');
  for (const [k, v] of Object.entries(o.kinds).sort((a, b) => b[1].n - a[1].n)) L.push('- ' + k + ': ' + v.n + ' passes, ' + pct(v.ok, v.att) + '% completed');
  L.push('', '## Pressing', '- PPDA: ' + fmt(o.ppda, 1) + ' (rank ' + o.ppdaRank + ' of ' + o.ppdaN + ', lower = more aggressive)', '- High ball wins: ' + o.high + ' (' + fmt(N ? o.high / N : 0, 1) + ' per match)',
    '', '## Ball losses', '- ' + o.lossN + ' losses: own third ' + o.thirds[0] + ', middle ' + o.thirds[1] + ', final ' + o.thirds[2] + '; left ' + o.lanes[0] + ', centre ' + o.lanes[1] + ', right ' + o.lanes[2],
    '', '## Set pieces', '- Corners ' + o.sp.corner + ', free kicks ' + o.sp.freekick + ', throw-ins ' + o.sp.throw_in, '- Shots within ' + tl_SPS.win + ' min: ' + o.sp.shots + ', xG ' + fmt(o.sp.xg, 2) + ', goals ' + o.sp.goals, '- Conceded after opponents’ set pieces: ' + o.sp.cShots + ' shots, ' + fmt(o.sp.cXg, 2) + ' xG',
    '', '## Key players');
  for (const p of o.key3) L.push('- ' + p.name + ' (' + p.pos + '): rating ' + fmt(p.rating, 2) + ', ' + p.goals + ' goals, ' + fmt(p.xg, 2) + ' xG, ' + p.passPct + '% passing');
  if (o.danger) L.push('', '**Danger man:** ' + o.danger.name + ' (' + o.danger.goals + ' goals, ' + fmt(o.danger.xg, 2) + ' xG, ' + o.danger.takeOnsWon + ' take-ons won).');
  L.push('', '_Rating = ' + RATING_FORMULA + '_');
  return L.join('\n');
}
page({
  id: 'opposition', title: 'Opposition report', group: 'Analysis tools',
  render(el, arg) {
    if (arg && D.clubs.some((c) => c.key === arg)) tl_OP.club = arg;
    if (!tl_OP.club) tl_OP.club = tl_defaultOpp().key;
    tl_oppRender(el);
  },
});
function tl_oppRender(el) {
  const club = tl_OP.club; const o = tl_opp(club); const N = o.ms.length; const def = tl_defaultOpp(); const C = ccol(club);
  const dr = tl_OP.draft[club];
  const sub = tl_OP.submitted[club];
  const head = pgHead('Opposition report: ' + esc(clubName(club)), 'Built automatically from ' + N + ' matches. Every chart names its source; numbers update when new matches are imported.',
    '<label class="field" style="flex-direction:row;align-items:center;gap:8px">Opponent<select id="tl_oclub" class="inp">' + D.clubs.filter((c) => c.key !== 'HAR' || club === 'HAR').map((c) => '<option value="' + c.key + '"' + (c.key === club ? ' selected' : '') + '>' + esc(c.club) + (c.key === def.key ? ' · ' + (def.why.startsWith('next') ? 'next' : 'top rival') : '') + '</option>').join('') + '</select></label>' +
    '<button class="btn" id="tl_omd">Export markdown' + lockBtn('export') + '</button><button class="btn pri" id="tl_osub">Submit for approval' + lockBtn('author') + '</button>');
  if (!N) { el.innerHTML = head + card('', '', '<div class="empty">' + esc(clubName(club)) + ' have not played a match in this dataset yet.</div>'); return tl_oppBind(el, o); }
  const kp = '<div class="kpis">' + kpi('League position', o.t.pos ? tl_ord(o.t.pos) : '–', (o.t.pts ?? 0) + ' pts') + kpi('Record', o.w + '–' + o.d + '–' + o.l, 'W–D–L · form ' + o.rows.slice(-5).map((r) => r.res).join('')) + kpi('xG per match', fmt(o.xg / N, 2), 'against ' + fmt(o.xga / N, 2)) + kpi('Possession', fmt(o.poss, 0) + '%', 'average') + kpi('PPDA', fmt(o.ppda, 1), 'press rank ' + o.ppdaRank + ' of ' + o.ppdaN + ' (1 = most aggressive)') + kpi('Danger man', '<span style="font-size:22px">' + esc(o.danger ? o.danger.name : '–') + '</span>', o.danger ? o.danger.goals + ' goals · ' + fmt(o.danger.xg, 2) + ' xG' : '') + '</div>';
  const res = tbl([
    { k: 'd', l: 'Date', f: (r) => '<span class="mono">' + r.m.date.slice(5) + '</span>' },
    { k: 'o', l: 'Opp', f: (r) => '<span style="white-space:nowrap" title="' + esc(clubName(r.opp)) + '">' + r.ha + ' · <span class="dot" style="background:' + ccol(r.opp) + '"></span>' + r.opp + '</span>' },
    { k: 's', l: 'Score', f: (r) => '<span style="white-space:nowrap">' + resChip(r.res) + ' <b class="num">' + r.gf + '–' + r.ga + '</b></span>' },
    { k: 'x', l: 'xG', r: 1, f: (r) => fmt(r.xg, 2) + ' <span class="sub">' + fmt(r.xga, 2) + '</span>' },
    { k: 'f', l: 'Shape', f: (r) => esc(r.form) + ' <span class="sub">' + esc(r.style) + '</span>' },
  ], o.rows.slice().reverse(), { id: 'tl_ores', click: true, key: (r) => r.m.id });
  const xgc = tl_safe(() => barChart({ groups: o.rows.map((r) => ({ label: 'MD' + r.m.matchday, vals: [{ v: r.xg, color: C, title: 'MD' + r.m.matchday + ' vs ' + r.opp + ' · xG for ' + fmt(r.xg, 2) }, { v: r.xga, color: 'var(--muted)', title: 'MD' + r.m.matchday + ' vs ' + r.opp + ' · xG against ' + fmt(r.xga, 2) }] })), h: 200 }) + legend([['xG for', C], ['xG against', 'var(--muted)']]) + tl_src(['Source: engine match stats', 'Unit: expected goals per match']), 'xG chart');
  const kindsT = sum(Object.values(o.kinds), (k) => k.n);
  const build = hbars(Object.entries(o.kinds).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => ({ label: k + ' · ' + pct(v.ok, v.att) + '% cmp', v: pct(v.n, kindsT), color: C })), { max: 100, fmt: (v) => v + '%' }) + tl_src(['Source: pass events', 'Unit: share of ' + fmt(kindsT) + ' passes', 'cmp = next on-ball event by same team']);
  const net = tl_safe(() => {
    const ent = Object.entries(o.pair).sort((a, b) => b[1] - a[1]); if (!ent.length) return '<div class="empty">No passes recorded in this formation.</div>';
    const mx = ent[0][1]; const keep = ent.slice(0, 24); let inner = '';
    for (const [k, c] of keep) { const [a, b] = k.split('|'); const A = o.pos[a], B = o.pos[b]; if (!A || !B || !A.n || !B.n) continue; inner += '<line x1="' + (A.x / A.n).toFixed(1) + '" y1="' + (A.y / A.n).toFixed(1) + '" x2="' + (B.x / B.n).toFixed(1) + '" y2="' + (B.y / B.n).toFixed(1) + '" stroke="' + C + '" stroke-opacity="' + (0.25 + 0.5 * c / mx).toFixed(2) + '" stroke-width="' + (0.25 + 1.5 * c / mx).toFixed(2) + '" stroke-linecap="round"><title>' + esc(a + ' ↔ ' + b + ': ' + c + ' passes') + '</title></line>'; }
    const imx = Math.max(1, ...Object.values(o.inv));
    for (const [n, a] of Object.entries(o.pos)) { if (!a.n) continue; const x = a.x / a.n, y = a.y / a.n, r = 1.6 + 1.4 * Math.sqrt((o.inv[n] || 0) / imx); inner += '<g><title>' + esc(n + ' · ' + (o.inv[n] || 0) + ' passes made or received') + '</title><circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(2) + '" fill="' + C + '" stroke="var(--surface)" stroke-width=".4"/><text x="' + x.toFixed(1) + '" y="' + (y + 0.7).toFixed(1) + '" text-anchor="middle" style="font-size:2px;font-weight:600;fill:var(--top-ink)">' + a.num + '</text><text x="' + x.toFixed(1) + '" y="' + (y + r + 2.4).toFixed(1) + '" text-anchor="middle" style="font-size:1.9px;fill:var(--ink-2)">' + esc(n.split(' ').slice(-1)[0]) + '</text></g>'; }
    inner += '<text x="52.5" y="66.8" text-anchor="middle" style="font-size:2.2px;fill:var(--muted)">attacking direction →</text>';
    return pitch(inner, { title: 'Pass network' }) + tl_src(['Source: passer → receiver counts, ' + o.fm.length + ' matches in ' + esc(o.f0), 'Nodes: average tracking position', 'Line width: passes between the pair (top 24 pairs)']);
  }, 'Pass network');
  const lossMap = pitch(o.losses.map((l) => '<circle cx="' + l.x.toFixed(1) + '" cy="' + l.y.toFixed(1) + '" r="1" fill="var(--bad)" fill-opacity=".6"><title>' + esc(l.m + ' ' + Math.floor(l.min) + '′ · lost by ' + l.who) + '</title></circle>').join('') + '<line x1="35" y1="0" x2="35" y2="68" stroke="var(--line-2)" stroke-dasharray="1 1" stroke-width=".3"/><line x1="70" y1="0" x2="70" y2="68" stroke="var(--line-2)" stroke-dasharray="1 1" stroke-width=".3"/><text x="52.5" y="66.8" text-anchor="middle" style="font-size:2.2px;fill:var(--muted)">' + esc(clubName(club)) + ' attacking →</text>', { title: 'Ball losses' }) +
    '<div class="tl_mini" style="margin-top:8px">' + TL_THIRD.map((t, i) => '<div><b>' + o.thirds[i] + '</b><span>' + t + ' · ' + pct(o.thirds[i], o.losses.length) + '%</span></div>').join('') + '</div>' + tl_src(['Source: turnover events where the loser (from) is a ' + esc(club) + ' player', 'Position flipped to the losing side’s direction (105 − ax, 68 − ay)', o.lossN + ' losses']);
  const conXg = sum(o.conceded, (s) => s.xg);
  const shotMap = pitch(o.conceded.map((s) => '<circle cx="' + s.x.toFixed(1) + '" cy="' + s.y.toFixed(1) + '" r="' + (0.8 + 4 * Math.sqrt(s.xg)).toFixed(2) + '" fill="' + (s.goal ? 'var(--bad)' : 'var(--info)') + '" fill-opacity="' + (s.goal ? 0.85 : 0.35) + '" stroke="' + (s.goal ? 'var(--bad)' : 'var(--info)') + '" stroke-width=".3"><title>' + esc(s.m + ' ' + Math.floor(s.min) + '′ · ' + (s.who || '') + ' · xG ' + fmt(s.xg, 2) + (s.goal ? ' · goal' : '')) + '</title></circle>').join(''), { half: true, title: 'Shots conceded', h: '340px' }) +
    legend([['Goal', 'var(--bad)'], ['No goal', 'var(--info)', 1]]) + tl_src(['Source: opponents’ shot events (ax/ay, goal ' + esc(club) + ' defend on the right)', o.conceded.length + ' shots · ' + fmt(conXg, 2) + ' xG', 'Dot area ∝ xG']);
  const press = '<div class="tl_mini">' + '<div><b>' + fmt(o.ppda, 1) + '</b><span>PPDA (rank ' + o.ppdaRank + '/' + o.ppdaN + ')</span></div><div><b>' + fmt(o.high / N, 1) + '</b><span>high ball wins / match</span></div><div><b>' + fmt(sum(o.rows, (r) => r.m.ts[club].wins) / N, 1) + '</b><span>ball wins / match</span></div><div><b>' + fmt(sum(o.rows, (r) => r.m.ts[club].tackles) / N, 1) + '</b><span>slide tackles / match</span></div></div>' +
    '<div style="margin-top:10px">' + lineChart({ series: [{ name: 'PPDA', color: C, pts: o.rows.filter((r) => r.ppda != null).map((r, i) => [i + 1, r.ppda]) }], h: 150, xMin: 1, xMax: Math.max(2, o.rows.length), xTicks: o.rows.map((_, i) => i + 1), xFmt: (v) => (o.rows[v - 1] ? 'MD' + o.rows[v - 1].m.matchday : ''), yLabel: 'PPDA (lower = harder press)' }) + '</div>' +
    tl_src(['PPDA = opponent passes in their own 60% ÷ our defensive actions there (core m.ts)', 'High win = turnover won at ax > 70']);
  const spB = '<div class="tl_mini"><div><b>' + o.sp.corner + '</b><span>corners</span></div><div><b>' + o.sp.freekick + '</b><span>free kicks</span></div><div><b>' + o.sp.throw_in + '</b><span>throw-ins</span></div><div><b>' + o.sp.shots + '</b><span>shots after SP</span></div><div><b>' + fmt(o.sp.xg, 2) + '</b><span>xG after SP</span></div><div><b>' + o.sp.goals + '</b><span>goals after SP</span></div></div>' +
    '<p class="note" style="margin:8px 0 0">Conceded after opponents’ set pieces: ' + o.sp.cShots + ' shots, ' + fmt(o.sp.cXg, 2) + ' xG. <button class="btn ghost sm" data-go="setpieces">Open Set pieces</button></p>' + tl_src(['Window: shots by the same team within ' + tl_SPS.win + ' match minutes of the restart (set on the Set pieces page)']);
  const keyP = '<div class="list">' + o.key3.map((p, i) => '<div class="li" style="align-items:center"><span class="tl_num" style="width:34px;height:34px;font-size:18px;border-radius:7px;background:' + C + '">' + p.num + '</span><div style="flex:1"><div class="t">' + esc(p.name) + (o.danger && p.name === o.danger.name ? ' ' + chip('Danger man', 'bad') : '') + '</div><div class="s">' + esc(p.pos) + ' · rating ' + fmt(p.rating, 2) + ' · ' + p.goals + ' G · ' + fmt(p.xg, 2) + ' xG · ' + p.passPct + '% passing</div></div><button class="btn sm" data-go="scouting.p-' + tl_slug(p.name) + '">Profile</button></div>').join('') +
    (o.danger && !o.key3.includes(o.danger) ? '<div class="li" style="align-items:center"><span class="tl_num" style="width:34px;height:34px;font-size:18px;border-radius:7px;background:var(--bad)">' + o.danger.num + '</span><div style="flex:1"><div class="t">' + esc(o.danger.name) + ' ' + chip('Danger man', 'bad') + '</div><div class="s">' + esc(o.danger.pos) + ' · ' + o.danger.goals + ' goals · ' + fmt(o.danger.xg, 2) + ' xG · ' + o.danger.takeOnsWon + ' take-ons won</div></div><button class="btn sm" data-go="scouting.p-' + tl_slug(o.danger.name) + '">Profile</button></div>' : '') + '</div>' +
    '<div class="tl_formula">Key players = top 3 by average rating (ties broken by goals + xG, then passes completed). Danger man = most goals + xG, ties broken by take-ons won. Rating = ' + esc(RATING_FORMULA) + '</div>';
  const draftBox = '<div id="tl_odraft">' + (dr ? '<div class="tl_md">' + esc(dr.text).replace(/\n/g, '<br>') + '</div><div class="tl_row" style="margin-top:8px">' + chip('Report writer · ' + (dr.src === 'ai' ? 'Claude' : 'rules'), 'acc') + tl_gchip(dr) + '<span class="note">' + dr.ms + ' ms</span></div>' : '<div class="tl_md">' + esc(tl_oppRules(o)).replace(/\n/g, '<br>') + '</div><p class="note" style="margin-top:8px">Preview built from the numbers on this page. Press <b>Draft summary</b> to have the Report writer agent write it (and log the run).</p>') + '</div>';
  el.innerHTML = head + kp +
    (sub ? '<div class="lock" style="background:var(--good-soft);color:var(--good);margin-bottom:14px">Submitted for approval as “' + esc(sub.title) + '” at ' + esc(sub.at.slice(11, 16)) + '. Status: pending. ' + (PAGES.reports ? '<button class="btn sm" data-go="reports">Open Reports</button>' : '') + '</div>' : '') +
    '<div class="grid">' +
    '<div class="s7">' + card('Summary', 'Five points for the coaching staff', draftBox, '<button class="btn sm" id="tl_odr">Draft summary with Report writer' + lockBtn('ask') + '</button>') + '</div>' +
    '<div class="s5">' + card('Key players', 'Who to plan for', keyP) + '</div>' +
    '<div class="s7">' + card('xG for and against', 'Per match, in date order', xgc) + '</div>' +
    '<div class="s5">' + card('Results and shape', 'Click a row to open the match · ' + o.forms.map(([f, n]) => f + ' ×' + n).join(' · ') + ' · ' + o.styles.map(([f, n]) => f + ' ×' + n).join(' · '), res) + '</div>' +
    '<div class="s7">' + card('Pass network · ' + esc(o.f0 || ''), 'Their most common formation (' + o.fm.length + ' of ' + N + ' matches)', net) + '</div>' +
    '<div class="s5">' + card('Build-up: pass kind mix', fmt(o.pAll) + ' passes with an outcome · ' + pct(o.pOk, o.pAll) + '% completed', build + '<div style="margin-top:10px">' + hbars(Object.entries(o.phases).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, v, color: 'var(--info)' })), { fmt: (v) => fmt(v) }) + '</div>' + tl_src(['Phase of play from pass events', 'Unit: passes'])) + '</div>' +
    '<div class="s6">' + card('Where they lose the ball', 'Press here', lossMap) + '</div>' +
    '<div class="s6">' + card('Shots conceded', 'Where opponents shoot from against them', shotMap) + '</div>' +
    '<div class="s6">' + card('Pressing', 'How hard and how high they press', press) + '</div>' +
    '<div class="s6">' + card('Set-piece threat', 'Restarts won and what came of them', spB) + '</div>' +
    '</div>';
  tl_oppBind(el, o);
}
function tl_oppBind(el, o) {
  const club = o.club;
  $('#tl_oclub', el).onchange = (e) => { tl_OP.club = e.target.value; try { history.replaceState(null, '', '#opposition.' + tl_OP.club); R.arg = tl_OP.club; } catch (x) {} tl_oppRender(el); };
  const draftText = () => (tl_OP.draft[club] ? tl_OP.draft[club].text : tl_oppRules(o));
  $('#tl_omd', el).onclick = () => exportFile('opposition-' + club.toLowerCase() + '-' + new Date().toISOString().slice(0, 10) + '.md', tl_oppMd(o, draftText()), 'text/markdown', 'Opposition report (Markdown)');
  $('#tl_osub', el).onclick = async () => {
    if (!gate('author', 'Submit opposition report')) return;
    if (!o.ms.length) return toast('Nothing to submit: no matches for this club.');
    const title = 'Opposition report: ' + clubName(club) + ' (' + new Date().toISOString().slice(0, 10) + ')';
    const rec = await sAdd('reports', { title, type: 'Opposition', club, status: 'pending', author: me().name, authorRole: ROLE, body: tl_oppMd(o, draftText()), sources: o.ms.map((m) => m.id), createdAt: new Date().toISOString(), summarySrc: tl_OP.draft[club] ? tl_OP.draft[club].src : 'rules' });
    audit('report.submit', title, 'Opposition · pending approval · ' + o.ms.length + ' source matches · id ' + rec.id);
    tl_OP.submitted[club] = { title, at: new Date().toISOString() };
    toast('Submitted for approval. An approver will see it in Reports.'); tl_oppRender(el);
  };
  const dbtn = $('#tl_odr', el);
  if (dbtn) dbtn.onclick = async () => {
    if (!gate('ask', 'Draft opposition summary')) return;
    const box = $('#tl_odraft', el); if (box) box.innerHTML = '<div class="note">The Report writer is drafting from the numbers on this page…</div>';
    const N = o.ms.length;
    const ctx = { club: clubName(club), matches: N, record: { w: o.w, d: o.d, l: o.l, gf: o.gf, ga: o.ga }, xgPerMatch: +(o.xg / N).toFixed(2), xgaPerMatch: +(o.xga / N).toFixed(2), form: o.rows.slice(-5).map((r) => r.res).join(''), formations: o.forms, styles: o.styles, passCompletionPct: pct(o.pOk, o.pAll),
      passKinds: Object.fromEntries(Object.entries(o.kinds).map(([k, v]) => [k, { passes: v.n, completedPct: pct(v.ok, v.att) }])), ppda: o.ppda == null ? null : +o.ppda.toFixed(1), ppdaRank: o.ppdaRank, clubs: o.ppdaN, highWinsPerMatch: +(o.high / N).toFixed(1),
      ballLosses: { total: o.lossN, ownThird: o.thirds[0], middleThird: o.thirds[1], finalThird: o.thirds[2], left: o.lanes[0], centre: o.lanes[1], right: o.lanes[2] }, shotsConceded: o.conceded.length, xgConceded: +sum(o.conceded, (s) => s.xg).toFixed(2),
      setPieces: { corners: o.sp.corner, freekicks: o.sp.freekick, throwins: o.sp.throw_in, shots: o.sp.shots, xg: o.sp.xg, goals: o.sp.goals }, keyPlayers: o.key3.map((p) => ({ name: p.name, pos: p.pos, rating: p.rating, goals: p.goals, xg: p.xg })), danger: o.danger ? { name: o.danger.name, pos: o.danger.pos, goals: o.danger.goals, xg: o.danger.xg } : null };
    const run = await askAgent({ agent: 'writer', q: 'Write a 5-bullet opposition summary of ' + clubName(club) + ' for our coaching staff: results, shape and build-up, pressing, where to press them, key threat and set pieces. Start each bullet with "• ".', ctx, rules: () => tl_oppRules(o) });
    tl_OP.draft[club] = run; tl_oppRender(el);
  };
  const rt = $('#tl_ores', el); if (rt) rt.querySelectorAll('tr.click').forEach((tr) => { tr.onclick = () => go('match', tr.dataset.i); tr.onkeydown = (e) => { if (e.key === 'Enter') go('match', tr.dataset.i); }; });
  tl_bindGo(el);
}

// ===================================================================================================
// 4. SET PIECES
// ===================================================================================================
const tl_SPS = { club: '', kind: 'all', sort: { k: 'xg', dir: 'desc' }, win: 0.5 };
page({ id: 'setpieces', title: 'Set pieces', group: 'Analysis tools', render(el, arg) { if (arg && D.clubs.some((c) => c.key === arg)) tl_SPS.club = arg; tl_spRender(el); } });
function tl_spRender(el) {
  const all = D.clubs.map((c) => tl_spClub(c.key)).filter((a) => a.mp);
  const sel = tl_SPS.club ? all.filter((a) => a.club === tl_SPS.club) : all;
  const T = { corner: sum(sel, (a) => a.corner), freekick: sum(sel, (a) => a.freekick), throw_in: sum(sel, (a) => a.throw_in), shots: sum(sel, (a) => a.shots), xg: sum(sel, (a) => a.xg), goals: sum(sel, (a) => a.goals), mp: sum(sel, (a) => a.mp) };
  T.sp = T.corner + T.freekick + T.throw_in;
  const lg = { sp: sum(all, (a) => a.sp), shots: sum(all, (a) => a.shots), xg: sum(all, (a) => a.xg), mp: sum(all, (a) => a.mp) };
  const deliv = sel.flatMap((a) => a.deliv).filter((d) => tl_SPS.kind === 'all' || d.kind === tl_SPS.kind);
  const shots = sel.flatMap((a) => a.shotList).sort((a, b) => b.xg - a.xg);
  const nm = tl_SPS.club ? clubName(tl_SPS.club) : 'League';
  const cols = [
    { k: 'club', l: 'Club', f: (a) => '<span style="white-space:nowrap">' + tl_ctag(a.club) + '</span>', v: (a) => clubName(a.club) },
    { k: 'mp', l: 'MP', r: 1 },
    { k: 'corner', l: 'Corners', r: 1 }, { k: 'freekick', l: 'Free kicks', r: 1 }, { k: 'throw_in', l: 'Throw-ins', r: 1 },
    { k: 'spm', l: 'SP / match', r: 1, f: (a) => fmt(a.sp / a.mp, 1), v: (a) => a.sp / a.mp },
    { k: 'shots', l: 'Shots', r: 1, t: 'Shots by the same team within the window after the restart' },
    { k: 'xg', l: 'xG', r: 1, f: (a) => fmt(a.xg, 2) },
    { k: 'goals', l: 'Goals', r: 1 },
    { k: 'conv', l: 'Shots / 100 SP', r: 1, f: (a) => fmt(a.sp ? (100 * a.shots) / a.sp : 0, 1), v: (a) => (a.sp ? a.shots / a.sp : 0), t: 'Conversion of set pieces into shots' },
    { k: 'cXg', l: 'xG conceded', r: 1, f: (a) => fmt(a.cXg, 2), t: 'xG from shots within the window after opponents’ set pieces' },
  ];
  const dense = deliv.length > 80;
  const dm = deliv.map((d) => {
    const c = ccol(d.team);
    if (dense) return d.contact ? '<circle cx="' + d.contact.p[0].toFixed(1) + '" cy="' + d.contact.p[1].toFixed(1) + '" r=".9" fill="' + (d.contact.own ? c : 'var(--muted)') + '" fill-opacity=".6"><title>' + esc(d.m + ' ' + Math.floor(d.min) + '′ · ' + TL_SP[d.kind] + ' (' + d.team + ') · first contact ' + (d.contact.own ? 'kept' : 'lost')) + '</title></circle>' : '';
    let s = '<circle cx="' + d.o[0].toFixed(1) + '" cy="' + d.o[1].toFixed(1) + '" r=".8" fill="none" stroke="' + c + '" stroke-width=".35"><title>' + esc(d.m + ' ' + Math.floor(d.min) + '′ · ' + TL_SP[d.kind] + ' taken (' + d.team + ')') + '</title></circle>';
    if (d.contact) s += '<line x1="' + d.o[0].toFixed(1) + '" y1="' + d.o[1].toFixed(1) + '" x2="' + d.contact.p[0].toFixed(1) + '" y2="' + d.contact.p[1].toFixed(1) + '" stroke="' + c + '" stroke-opacity=".45" stroke-width=".3" stroke-dasharray="1 .8"/><circle cx="' + d.contact.p[0].toFixed(1) + '" cy="' + d.contact.p[1].toFixed(1) + '" r="1.1" fill="' + (d.contact.own ? c : 'var(--muted)') + '" fill-opacity=".85"><title>' + esc('First contact: ' + (d.contact.own ? d.team + ' kept the ball' : 'opponent won it')) + '</title></circle>';
    return s;
  }).join('');
  el.innerHTML = pgHead('Set pieces', 'Corners, free kicks and throw-ins won, and the shots and xG each club creates within ' + tl_SPS.win + ' match minutes of the restart.',
    '<span class="note">Window</span>' + seg('tl_spw', [[0.5, '0.5′'], [1, '1′'], [2, '2′']], tl_SPS.win) + '<label class="field" style="flex-direction:row;align-items:center;gap:8px">Club<select id="tl_spc" class="inp"><option value="">All clubs</option>' + D.clubs.map((c) => '<option value="' + c.key + '"' + (tl_SPS.club === c.key ? ' selected' : '') + '>' + esc(c.club) + '</option>').join('') + '</select></label><button class="btn" id="tl_spcsv">Export CSV' + lockBtn('export') + '</button>') +
    '<div class="kpis">' + kpi('Set pieces won', fmt(T.sp), fmt(T.mp ? T.sp / (tl_SPS.club ? T.mp : T.mp / 2) : 0, 1) + ' per match · ' + T.corner + ' C · ' + T.freekick + ' FK · ' + T.throw_in + ' TI') + kpi('Shots after SP', fmt(T.shots), fmt(T.sp ? (100 * T.shots) / T.sp : 0, 1) + ' per 100 set pieces') + kpi('xG after SP', fmt(T.xg, 2), fmt(T.shots ? T.xg / T.shots : 0, 2) + ' xG per shot') + kpi('Goals after SP', fmt(T.goals), T.shots ? fmt((100 * T.goals) / T.shots, 0) + '% of SP shots scored' : 'no shots yet') +
    (tl_SPS.club ? kpi('vs league', fmt(T.sp ? (100 * T.shots) / T.sp : 0, 1) + '<small>/ ' + fmt(lg.sp ? (100 * lg.shots) / lg.sp : 0, 1) + '</small>', 'shots per 100 SP, club / league') : '') + '</div>' +
    '<div class="grid">' +
    '<div class="s12">' + card('League comparison', 'Click a column to sort · click a club to filter', tbl(cols, all, { id: 'tl_sptbl', sort: tl_SPS.sort, click: true, key: (a) => a.club, sel: (a) => a.club === tl_SPS.club, empty: 'No matches yet.' }) + tl_src(['Source: corner, freekick, throw_in and shot events', 'Window: same team, ≤ ' + tl_SPS.win + ' match minutes after the restart (matches run on a compressed clock)'])) + '</div>' +
    '<div class="s5">' + card('xG after set pieces by club', 'Split by restart type', !all.some((a) => a.xg) ? '<div class="empty">No shot followed a set piece within ' + tl_SPS.win + ' match minutes. Matches run on a compressed clock, so try a 1′ or 2′ window.</div>' : tl_safe(() => barChart({ groups: all.map((a) => ({ label: a.club, vals: [{ v: a.byKind.corner.xg, color: 'var(--accent)', title: a.club + ' corners: ' + fmt(a.byKind.corner.xg, 2) + ' xG' }, { v: a.byKind.freekick.xg, color: 'var(--info)', title: a.club + ' free kicks: ' + fmt(a.byKind.freekick.xg, 2) + ' xG' }, { v: a.byKind.throw_in.xg, color: 'var(--warn)', title: a.club + ' throw-ins: ' + fmt(a.byKind.throw_in.xg, 2) + ' xG' }] })), stacked: true, h: 220, yFmt: (v) => v.toFixed(2) }), 'chart') + legend([['Corners', 'var(--accent)'], ['Free kicks', 'var(--info)'], ['Throw-ins', 'var(--warn)']]) + tl_src(['Unit: expected goals, season total'])) + '</div>' +
    '<div class="s7">' + card('Delivery map · ' + esc(nm), deliv.length + ' corners and free kicks · ' + (dense ? 'dot = first contact (spots and paths hidden above 80 deliveries; pick a club)' : 'ring = where it was taken, dot = first contact'), seg('tl_spk', [['all', 'Both'], ['corner', 'Corners'], ['freekick', 'Free kicks']], tl_SPS.kind) + '<div style="margin-top:8px">' + (deliv.length ? pitch(dm + '<text x="52.5" y="66.8" text-anchor="middle" style="font-size:2.2px;fill:var(--muted)">attacking direction →</text>', { title: 'Set-piece deliveries' }) : '<div class="empty">No corners or free kicks for this selection.</div>') + '</div>' +
      legend([['Taken by the club, kept', tl_SPS.club ? ccol(tl_SPS.club) : 'var(--accent)'], ['Won by the opponent', 'var(--muted)']]) + tl_src(['Positions normalised with the taking team attacking right (ax/ay)', 'First contact = first on-ball event > 3 m from the spot, within ' + Math.max(tl_SPS.win, 1.5) + ' min'])) + '</div>' +
    '<div class="s5">' + card('Shots from set pieces', shots.length + ' shots · highest xG first', tbl([
      { k: 'm', l: 'Match', f: (s) => '<span class="mono">' + esc(tl_short(s.m)) + '</span>' },
      { k: 'min', l: 'Min', r: 1, f: (s) => Math.floor(s.min) + '′' },
      { k: 'p', l: 'Player', f: (s) => esc(s.player || '–') + ' <span class="sub">' + TL_SP[s.sp] + '</span>' },
      { k: 'xg', l: 'xG', r: 1, f: (s) => fmt(s.xg, 2) + (s.goal ? ' ' + chip('Goal', 'good') : '') },
    ], shots, { limit: 12, empty: 'No shots followed a set piece within ' + tl_SPS.win + ' match minutes in this selection.' })) + '</div>' +
    '</div>';
  const re = () => tl_spRender(el);
  $('#tl_spc', el).onchange = (e) => { tl_SPS.club = e.target.value; re(); };
  bindSeg(el, 'tl_spk', (v) => { tl_SPS.kind = v; re(); });
  bindSeg(el, 'tl_spw', (v) => { tl_SPS.win = +v; re(); });
  bindTbl(el, 'tl_sptbl', tl_SPS.sort, re, (k) => { tl_SPS.club = tl_SPS.club === k ? '' : k; re(); });
  $('#tl_spcsv', el).onclick = () => exportFile('set-pieces-' + new Date().toISOString().slice(0, 10) + '.csv', toCSV(all.map((a) => ({ club: a.club, matches: a.mp, corners: a.corner, freekicks: a.freekick, throwins: a.throw_in, shots_after_sp: a.shots, xg_after_sp: a.xg, goals_after_sp: a.goals, shots_per_100_sp: a.sp ? +((100 * a.shots) / a.sp).toFixed(1) : 0, xg_conceded_after_sp: a.cXg }))), 'text/csv', 'Set-piece league table CSV');
  tl_bindGo(el);
}

// ===================================================================================================
// 5. TACTICAL BOARD
// ===================================================================================================
const tl_B = { mid: null, t: 0, playing: false, speed: 1, avg: false, tool: 'none', color: 'var(--warn)', shapes: [], raf: 0, last: 0, clip: null, tickKey: '' };
const TL_TICK = new Set(['goal', 'shot', 'corner', 'freekick', 'foul', 'yellow_card', 'red_card', 'take_on', 'turnover', 'tactical_change', 'offside', 'insight', 'kickoff', 'half_time', 'full_time', 'slide_tackle']);
const tl_reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
page({
  id: 'board', title: 'Tactical board', group: 'Analysis tools',
  render(el, arg) {
    if (arg && D.match(arg) && arg !== tl_B.mid) { tl_B.mid = arg; tl_B.t = 0; tl_B.shapes = []; tl_B.clip = null; }
    if (!tl_B.mid || !D.match(tl_B.mid)) { const m = D.matches.slice().reverse().find((x) => (x.frames || []).length) || D.matches[0]; tl_B.mid = m ? m.id : null; tl_B.t = 0; }
    tl_B.playing = false; tl_bRender(el);
  },
});
function tl_bEvText(e) {
  const L = { goal: '⚽ Goal', shot: 'Shot', corner: 'Corner', freekick: 'Free kick', foul: 'Foul', yellow_card: 'Yellow card', red_card: 'Red card', take_on: 'Take-on', turnover: 'Ball won', tactical_change: 'Tactical change', offside: 'Offside', insight: 'Insight', kickoff: 'Kick-off', half_time: 'Half-time', full_time: 'Full-time', slide_tackle: 'Slide tackle' };
  let t = '<b>' + (L[e.type] || e.type) + '</b>';
  if (e.team) t += ' · ' + e.team;
  if (e.type === 'insight') t += ' · ' + esc(e.agent || '') + ': ' + esc(e.text || '');
  else if (e.type === 'turnover') t += ' · ' + esc(e.player || '') + ' from ' + esc(e.from || '');
  else if (e.type === 'take_on') t += ' · ' + esc(e.player || '') + (e.success ? ' beats ' : ' stopped by ') + esc(e.defender || '');
  else if (e.type === 'shot') t += ' · ' + esc(e.player || '') + ' · xG ' + fmt(e.xg, 2);
  else if (e.type === 'tactical_change') t += ' · ' + esc(e.formation || '') + ' (' + esc(e.why || '') + ')';
  else if (e.type === 'goal') t += ' · ' + esc(e.player || '') + ' · ' + esc(e.score || '');
  else if (e.player) t += ' · ' + esc(e.player);
  return t;
}
function tl_bShape(s) {
  const p = s.p; if (!p || !p.length) return '';
  const st = 'stroke="' + s.c + '" stroke-width=".55" fill="none" stroke-linecap="round" stroke-linejoin="round"';
  if (s.t === 'arrow' || s.t === 'line') { const a = p[0], b = p[p.length - 1]; return '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" ' + st + (s.t === 'arrow' ? ' marker-end="url(#tl_arr_' + tl_cIdx(s.c) + ')"' : '') + '/>'; }
  if (s.t === 'circle') { const a = p[0], b = p[p.length - 1]; const r = Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(1); return '<circle cx="' + a[0] + '" cy="' + a[1] + '" r="' + r + '" stroke="' + s.c + '" stroke-width=".5" fill="' + s.c + '" fill-opacity=".14" stroke-dasharray="1.2 .8"/>'; }
  return '<path d="' + tl_bPath(s) + '" ' + st + '/>';
}
// SVG path data for a shape (stored with saved clips so other tools can draw them)
function tl_bPath(s) {
  const p = s.p; if (!p.length) return ''; const a = p[0], b = p[p.length - 1];
  if (s.t === 'circle') { const r = +Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(1); return 'M' + (a[0] - r).toFixed(1) + ' ' + a[1] + 'a' + r + ' ' + r + ' 0 1 0 ' + 2 * r + ' 0a' + r + ' ' + r + ' 0 1 0 ' + -2 * r + ' 0'; }
  if (s.t === 'line') return 'M' + a.join(' ') + 'L' + b.join(' ');
  if (s.t === 'arrow') { const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), h = 2; const l = [b[0] - h * Math.cos(ang - 0.45), b[1] - h * Math.sin(ang - 0.45)], r = [b[0] - h * Math.cos(ang + 0.45), b[1] - h * Math.sin(ang + 0.45)]; return 'M' + a.join(' ') + 'L' + b.join(' ') + 'M' + l.map((v) => v.toFixed(1)).join(' ') + 'L' + b.join(' ') + 'L' + r.map((v) => v.toFixed(1)).join(' '); }
  return 'M' + p.map((q) => q.join(' ')).join('L');
}
const TL_COLORS = ['var(--warn)', 'var(--info)', 'var(--bad)'];
const tl_cIdx = (c) => Math.max(0, TL_COLORS.indexOf(c));
function tl_bIdx(m, minute) { const fr = m.frames || []; let i = fr.findIndex((f) => f.m >= minute); if (i < 0) i = fr.length - 1; return Math.max(0, i); }
function tl_bRender(el) {
  const m = D.match(tl_B.mid);
  if (!m) { el.innerHTML = pgHead('Tactical board', 'Replay tracking data and draw over it.') + card('', '', '<div class="empty">No matches loaded.</div>'); return; }
  const fr = m.frames || [];
  const [H, A] = pairCols(m.home, m.away);
  const defs = '<defs>' + TL_COLORS.map((c, i) => '<marker id="tl_arr_' + i + '" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="' + c + '"/></marker>').join('') + '</defs>';
  const pl = (m.pids || []).map((p, i) => { const home = i < 11; return '<g class="tl_pl" data-i="' + i + '" style="display:none"><title>' + esc(p.name + ' #' + p.num + ' · ' + p.team) + '</title><circle r="1.75" fill="' + (home ? H : 'var(--surface)') + '" stroke="' + (home ? 'var(--surface)' : A) + '" stroke-width="' + (home ? 0.3 : 0.55) + '"/><text y=".62" text-anchor="middle" style="font-size:1.7px;font-weight:600;fill:' + (home ? 'var(--top-ink)' : A) + '">' + p.num + '</text></g>'; }).join('');
  const inner = defs + '<g id="tl_bavg"></g><g id="tl_bpl">' + pl + '</g><circle id="tl_bball" r=".85" fill="var(--ink)" stroke="var(--surface)" stroke-width=".3" style="display:none"/><g id="tl_bdraw"></g><g id="tl_bdraft"></g><text id="tl_bdir" x="52.5" y="66.8" text-anchor="middle" style="font-size:2.1px;fill:var(--muted)"></text>';
  const svg = pitch(inner, { title: 'Tracking replay' }).replace('<svg ', '<svg id="tl_bsvg" ');
  const opt = D.matches.map((x) => '<option value="' + x.id + '"' + (x.id === m.id ? ' selected' : '') + '>' + esc(tl_short(x) + ' ' + x.score.join('–')) + ((x.frames || []).length ? '' : ' · no tracking') + '</option>').join('');
  el.innerHTML = pgHead('Tactical board', 'Replay the tracking data of any match, draw over it and save the clip for the coaching staff. Tracking is sampled every 30 s of match time; motion between samples is interpolated.',
    '<button class="btn pri" id="tl_bsave">Save clip' + lockBtn('author') + '</button>', null) +
    '<div class="grid">' +
    '<div class="s8">' + card('', '',
      '<div class="tl_ctrl"><select class="inp" id="tl_bm" style="max-width:100%;flex:1 1 220px" aria-label="Match">' + opt + '</select>' +
      '<button class="btn pri" id="tl_bplay" style="min-width:84px"' + (fr.length ? '' : ' disabled') + '>▶ Play</button>' +
      seg('tl_bsp', [[1, '1×'], [2, '2×'], [4, '4×']], tl_B.speed) +
      '<label class="note" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="tl_bavgc"' + (tl_B.avg ? ' checked' : '') + '> Average positions</label>' +
      '<span class="sp"></span><span class="tl_score" id="tl_bscore"></span><span class="mono" id="tl_bmin" style="font-weight:600;min-width:46px;text-align:right"></span></div>' +
      '<div class="tl_board">' + (fr.length ? svg : '<div class="empty">This match has no tracking frames. Pick another match.</div>') + '</div>' +
      (fr.length ? '<input type="range" class="tl_slider" id="tl_bsl" min="0" max="' + (fr.length - 1) + '" step="0.01" value="' + tl_B.t + '" aria-label="Match time">' : '') +
      '<div class="tl_tools"><span class="note">Draw:</span>' + seg('tl_btool', [['none', 'Pointer'], ['arrow', 'Arrow'], ['line', 'Line'], ['circle', 'Zone'], ['free', 'Freehand']], tl_B.tool) +
      '<span class="tl_sw3" role="group" aria-label="Colour">' + TL_COLORS.map((c) => '<button data-c="' + c + '" style="background:' + c + '" aria-pressed="' + (tl_B.color === c) + '" aria-label="Colour"></button>').join('') + '</span>' +
      '<button class="btn sm" id="tl_bundo">Undo</button><button class="btn sm" id="tl_bclr">Clear</button><span class="sp"></span>' +
      legend([[clubName(m.home) + ' (filled)', H], [clubName(m.away) + ' (ring)', A]]) + '</div>' +
      tl_src(['Source: tracking frames (' + fr.length + ' samples, 0.5 match-minute interval)', 'World coordinates: ' + esc(m.home) + ' attack right in the first half']) +
      (tl_B.clip ? '<div class="lock" style="margin-top:10px;background:var(--info-soft);color:var(--info)">Clip loaded: ' + fmt(tl_B.clip.from, 1) + '′–' + fmt(tl_B.clip.to, 1) + '′' + (tl_B.clip.note ? ' · ' + esc(tl_B.clip.note) : '') + ' <span class="sp"></span><button class="btn sm" id="tl_bunclip">Close clip</button></div>' : '')) + '</div>' +
    '<div class="s4">' + card('Event ticker', 'Synced to the replay · click to jump', '<div class="tl_tick" id="tl_btick"></div>') +
    '<div style="height:14px"></div>' + card('Saved clips', 'Shared with your organisation', '<div id="tl_bclips"><div class="empty">Loading…</div></div>') + '</div>' +
    '</div>';
  tl_B.tickKey = '';
  tl_bBind(el, m);
  tl_bDraw();
  tl_bClips(el);
}
function tl_bAvg(m) {
  if (m.tl_avg) return m.tl_avg;
  const a = (m.pids || []).map(() => [0, 0, 0]);
  for (const fr of m.frames || []) for (let i = 0; i < a.length; i++) { const p = tl_norm(fr, i); if (p) { a[i][0] += p[0]; a[i][1] += p[1]; a[i][2]++; } }
  return (m.tl_avg = a.map((x) => (x[2] ? [x[0] / x[2], x[1] / x[2]] : null)));
}
function tl_bDraw() {
  const svg = document.getElementById('tl_bsvg'); const m = D.match(tl_B.mid); if (!m) return;
  const fr = m.frames || []; const n = fr.length;
  const minEl = document.getElementById('tl_bmin');
  if (!svg || !n) { if (minEl) minEl.textContent = ''; return; }
  tl_B.t = clamp(tl_B.t, 0, n - 1);
  const t = tl_reduced() ? Math.round(tl_B.t) : tl_B.t;
  const i0 = Math.floor(t), i1 = Math.min(n - 1, i0 + 1), a = t - i0, F0 = fr[i0], F1 = fr[i1];
  const same = F0.f === F1.f;
  const lerp = (p, q) => (!p ? null : !q || !same ? p : [p[0] + (q[0] - p[0]) * a, p[1] + (q[1] - p[1]) * a]);
  const gs = svg.querySelectorAll('.tl_pl');
  gs.forEach((g, i) => { const p = lerp(F0.p[i], F1.p[i]); if (!p) { g.style.display = 'none'; return; } g.style.display = ''; g.setAttribute('transform', 'translate(' + p[0].toFixed(2) + ' ' + p[1].toFixed(2) + ')'); });
  const b = lerp(F0.b, F1.b); const ball = document.getElementById('tl_bball'); if (b && ball) { ball.style.display = ''; ball.setAttribute('cx', b[0].toFixed(2)); ball.setAttribute('cy', b[1].toFixed(2)); }
  const minute = F0.m + ((F1.m - F0.m) * (same ? a : 0));
  if (minEl) minEl.textContent = Math.floor(minute) + '′' + String(Math.floor((minute % 1) * 60)).padStart(2, '0');
  const sl = document.getElementById('tl_bsl'); if (sl && document.activeElement !== sl) sl.value = tl_B.t;
  const dir = document.getElementById('tl_bdir'); if (dir) dir.textContent = (F0.f ? m.away : m.home) + ' attacking →';
  // average positions in world coordinates for the current half
  const ag = document.getElementById('tl_bavg');
  if (ag) {
    const key = tl_B.avg ? 'a' + F0.f : '';
    if (ag.dataset.k !== key) {
      ag.dataset.k = key;
      ag.innerHTML = !tl_B.avg ? '' : tl_bAvg(m).map((p, i) => { if (!p) return ''; const home = i < 11; const fl = home ? F0.f === 1 : F0.f !== 1; const w = fl ? tl_flip(p) : p; const c = pairCols(m.home, m.away)[home ? 0 : 1]; return '<g><title>Average position · ' + esc(m.pids[i].name) + '</title><circle cx="' + w[0].toFixed(1) + '" cy="' + w[1].toFixed(1) + '" r="1.75" fill="none" stroke="' + c + '" stroke-width=".35" stroke-dasharray=".7 .5"/><text x="' + w[0].toFixed(1) + '" y="' + (w[1] + 3.6).toFixed(1) + '" text-anchor="middle" style="font-size:1.6px;fill:' + c + '">' + m.pids[i].num + '</text></g>'; }).join('');
    }
  }
  // score and ticker, refreshed when the minute moves
  const ev = m.events || [];
  const sc = document.getElementById('tl_bscore');
  const tk = Math.floor(minute * 5) + '|' + m.id;
  if (tk !== tl_B.tickKey) {
    tl_B.tickKey = tk;
    let h = 0, aw = 0; for (const e of ev) { if (e.minute > minute) break; if (e.type === 'goal') { if (e.team === m.home) h++; else if (e.team === m.away) aw++; } }
    const PC = pairCols(m.home, m.away); if (sc) sc.innerHTML = '<span class="dot" style="background:' + PC[0] + '"></span>' + m.home + ' ' + h + '–' + aw + ' ' + m.away + '<span class="dot" style="background:' + PC[1] + ';margin:0 0 0 6px"></span>';
    const box = document.getElementById('tl_btick');
    if (box) {
      const past = []; for (let i = 0; i < ev.length; i++) { const e = ev[i]; if (e.minute > minute) break; if (TL_TICK.has(e.type) && !(e.type === 'insight' && e.status === 'rejected')) { const l = past[past.length - 1]; if (!(l && l.type === e.type && l.minute === e.minute && l.team === e.team && l.player === e.player)) past.push(e); } }
      const last = past.slice(-14).reverse();
      box.innerHTML = last.length ? last.map((e, k) => '<button data-m="' + e.minute + '"' + (k === 0 && minute - e.minute < 1.5 ? ' class="now"' : '') + '><span class="mn">' + Math.floor(e.minute) + '′</span><span>' + tl_bEvText(e) + '</span></button>').join('') : '<div class="empty">Events appear here as the replay runs.</div>';
      box.querySelectorAll('[data-m]').forEach((x) => { x.onclick = () => { tl_B.t = tl_bIdx(m, +x.dataset.m); tl_B.tickKey = ''; tl_bDraw(); }; });
    }
  }
  const dg = document.getElementById('tl_bdraw'); if (dg && dg.dataset.n !== String(tl_B.shapes.length)) { dg.dataset.n = tl_B.shapes.length; dg.innerHTML = tl_B.shapes.map(tl_bShape).join(''); }
}
function tl_bLoop(ts) {
  if (!document.getElementById('tl_bsvg')) { tl_B.playing = false; tl_B.raf = 0; return; }
  const m = D.match(tl_B.mid); const n = (m.frames || []).length;
  const dt = tl_B.last ? Math.min(0.1, (ts - tl_B.last) / 1000) : 0; tl_B.last = ts;
  if (tl_B.playing) {
    tl_B.t += dt * tl_B.speed * 2; // 1x = one match minute per second
    const end = tl_B.clip ? tl_bIdx(m, tl_B.clip.to) : n - 1;
    if (tl_B.t >= end) { tl_B.t = end; tl_bSetPlay(false); }
    tl_bDraw();
  }
  tl_B.raf = tl_B.playing ? requestAnimationFrame(tl_bLoop) : 0;
}
function tl_bSetPlay(on) {
  tl_B.playing = on; const b = document.getElementById('tl_bplay'); if (b) b.textContent = on ? '❚❚ Pause' : '▶ Play';
  if (on && !tl_B.raf) { tl_B.last = 0; tl_B.raf = requestAnimationFrame(tl_bLoop); }
}
function tl_bBind(el, m) {
  const n = (m.frames || []).length;
  $('#tl_bm', el).onchange = (e) => { tl_B.mid = e.target.value; tl_B.t = 0; tl_B.shapes = []; tl_B.clip = null; tl_bSetPlay(false); try { history.replaceState(null, '', '#board.' + tl_B.mid); R.arg = tl_B.mid; } catch (x) {} tl_bRender(el); };
  const pb = $('#tl_bplay', el); if (pb) pb.onclick = () => { if (!tl_B.playing) { const end = tl_B.clip ? tl_bIdx(m, tl_B.clip.to) : n - 1; if (tl_B.t >= end - 0.01) tl_B.t = tl_B.clip ? tl_bIdx(m, tl_B.clip.from) : 0; } tl_bSetPlay(!tl_B.playing); };
  bindSeg(el, 'tl_bsp', (v) => { tl_B.speed = +v; el.querySelectorAll('#tl_bsp button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v))); });
  $('#tl_bavgc', el).onchange = (e) => { tl_B.avg = e.target.checked; tl_bDraw(); };
  const sl = $('#tl_bsl', el); if (sl) sl.oninput = () => { tl_B.t = +sl.value; tl_bDraw(); };
  const svg = $('#tl_bsvg', el);
  const setTool = (v) => { tl_B.tool = v; el.querySelectorAll('#tl_btool button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v))); if (svg) svg.classList.toggle('tl_drawing', v !== 'none'); };
  bindSeg(el, 'tl_btool', setTool); setTool(tl_B.tool);
  el.querySelectorAll('.tl_sw3 button').forEach((b) => { b.onclick = () => { tl_B.color = b.dataset.c; el.querySelectorAll('.tl_sw3 button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }; });
  $('#tl_bundo', el).onclick = () => { tl_B.shapes.pop(); tl_bDraw(); };
  $('#tl_bclr', el).onclick = () => { tl_B.shapes = []; tl_bDraw(); };
  const uc = $('#tl_bunclip', el); if (uc) uc.onclick = () => { tl_B.clip = null; tl_bRender(el); };
  if (svg) {
    let cur = null;
    const P = (ev) => { const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; const q = pt.matrixTransform(svg.getScreenCTM().inverse()); return [+clamp(q.x, -2, 107).toFixed(1), +clamp(q.y, -2, 70).toFixed(1)]; };
    const draft = $('#tl_bdraft', el);
    svg.addEventListener('pointerdown', (ev) => { if (tl_B.tool === 'none') return; ev.preventDefault(); try { svg.setPointerCapture(ev.pointerId); } catch (x) {} const p = P(ev); cur = { t: tl_B.tool, c: tl_B.color, p: [p, p] }; draft.innerHTML = tl_bShape(cur); });
    svg.addEventListener('pointermove', (ev) => { if (!cur) return; const p = P(ev); if (cur.t === 'free') { const l = cur.p[cur.p.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.6) cur.p.push(p); } else cur.p[1] = p; draft.innerHTML = tl_bShape(cur); });
    const end = () => { if (!cur) return; const a = cur.p[0], b = cur.p[cur.p.length - 1]; if (cur.t === 'free' ? cur.p.length > 2 : Math.hypot(b[0] - a[0], b[1] - a[1]) > 1) { if (cur.t === 'free' && cur.p.length > 2) cur.p = cur.p.filter((q, i) => i !== 1 || cur.p.length < 3 ? true : !(q[0] === a[0] && q[1] === a[1])); tl_B.shapes.push(cur); } cur = null; draft.innerHTML = ''; tl_bDraw(); };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  }
  $('#tl_bsave', el).onclick = () => {
    if (!gate('author', 'Save tactical clip')) return;
    const fr = m.frames || []; const curMin = fr.length ? fr[Math.floor(clamp(tl_B.t, 0, fr.length - 1))].m : 0;
    const bg = modal('<h3>Save clip</h3><p class="note">' + esc(m.title) + ' · ' + tl_B.shapes.length + ' drawing' + (tl_B.shapes.length === 1 ? '' : 's') + '. Clips are shared with your organisation.</p>' +
      '<div class="tl_qf" style="margin:12px 0"><label class="field">From minute<input id="tl_bcf" type="number" step="0.5" value="' + Math.max(0, curMin - 2) + '"></label><label class="field">To minute<input id="tl_bct" type="number" step="0.5" value="' + (curMin + 3) + '"></label><label class="field full">Note<textarea id="tl_bcn" maxlength="400" placeholder="What the staff should look at"></textarea></label></div>' +
      '<div class="acts" style="justify-content:flex-end"><button class="btn" id="tl_bcc">Cancel</button><button class="btn pri" id="tl_bco">Save clip</button></div>');
    $('#tl_bcc', bg).onclick = closeModal;
    $('#tl_bco', bg).onclick = async () => {
      let f = +$('#tl_bcf', bg).value || 0, t = +$('#tl_bct', bg).value || 0; if (t < f) [f, t] = [t, f];
      const note = $('#tl_bcn', bg).value.trim(); closeModal();
      await sAdd('clips', { match: m.id, title: m.title, from: f, to: t, drawing: tl_B.shapes.map(tl_bPath).join(' '), shapes: JSON.parse(JSON.stringify(tl_B.shapes)), note, author: me().name });
      audit('clip.save', m.id + ' ' + f + '′–' + t + '′', tl_B.shapes.length + ' drawings' + (note ? ' · ' + note.slice(0, 60) : ''));
      toast('Clip saved'); tl_bClips(el);
    };
  };
}
async function tl_bClips(el) {
  const box = $('#tl_bclips', el); if (!box) return;
  let list = []; try { list = await sList('clips'); } catch (e) {}
  if (!box.isConnected) return;
  if (!list.length) { box.innerHTML = '<div class="empty">No clips yet. Draw on the pitch and press <b>Save clip</b>.</div>'; return; }
  list.sort((a, b) => (a.match === tl_B.mid ? 0 : 1) - (b.match === tl_B.mid ? 0 : 1));
  box.innerHTML = '<div class="list">' + list.slice(0, 20).map((c, i) => { const m = D.match(c.match); return '<div class="li" style="align-items:center"><div style="flex:1"><div class="t">' + esc(m ? tl_short(m) : c.match) + ' · ' + fmt(c.from, 1) + '′–' + fmt(c.to, 1) + '′</div><div class="s">' + esc(c.note || 'No note') + ' · ' + ((c.shapes || []).length) + ' drawings · ' + esc(c.author || '') + '</div></div><button class="btn sm" data-cl="' + i + '">Load</button><button class="btn sm ghost" data-cd="' + i + '" aria-label="Delete clip">✕</button></div>'; }).join('') + '</div>';
  box.querySelectorAll('[data-cl]').forEach((b) => { b.onclick = () => { const c = list[+b.dataset.cl]; const m = D.match(c.match); if (!m) return toast('That match is no longer loaded.'); tl_bSetPlay(false); tl_B.mid = c.match; tl_B.shapes = JSON.parse(JSON.stringify(c.shapes || [])); tl_B.clip = { from: c.from, to: c.to, note: c.note }; tl_B.t = tl_bIdx(m, c.from); try { history.replaceState(null, '', '#board.' + c.match); R.arg = c.match; } catch (x) {} audit('clip.open', c.match + ' ' + c.from + '′–' + c.to + '′', c.note || ''); tl_bRender(el); }; });
  box.querySelectorAll('[data-cd]').forEach((b) => { b.onclick = async () => { if (!gate('author', 'Delete clip')) return; const c = list[+b.dataset.cd]; await sDel('clips', c.id); audit('clip.delete', c.match, ''); tl_bClips(el); }; });
}
