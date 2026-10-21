// ===================================================================================================
// Data science pages: Query workbench, Chart builder, Dashboards, Custom metrics, Data connectors.
// Private names use the ds_ prefix. Season tables are built in memory from D on first use.
// SQL is a small subset that runs in the browser (no server, no CDN): SELECT with WHERE, INNER JOIN
// on one equality, GROUP BY, ORDER BY, LIMIT, COUNT / SUM / AVG / MIN / MAX / ROUND.
// ===================================================================================================
const ds_CSS = `
.ds-sql{font:500 13px/1.55 var(--f-mono);background:var(--surface-2);color:var(--ink);border:1px solid var(--line-2);border-radius:6px;padding:10px 12px;width:100%;min-height:150px;resize:vertical;box-sizing:border-box;tab-size:2}
.ds-sql:focus,.ds-page input:focus,.ds-page select:focus{outline:2px solid var(--focus);outline-offset:1px}
.ds-pre{font:12px/1.5 var(--f-mono);background:var(--surface-2);color:var(--ink-2);border:1px solid var(--line);border-radius:6px;padding:8px 10px;margin:0 0 10px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow:auto}
.ds-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 10px}
.ds-err{background:var(--bad-soft);color:var(--bad);border-radius:6px;padding:9px 11px;font-size:13px;margin:0 0 10px;overflow-wrap:anywhere}
.ds-src{font:500 11.5px/1.4 var(--f-mono);color:var(--muted);margin:8px 0 0;overflow-wrap:anywhere}
.ds-note{font-size:12px;color:var(--muted);margin:0 0 8px;overflow-wrap:anywhere}
.ds-ans{font-size:14px;line-height:1.55;white-space:pre-wrap;margin:8px 0}
.ds-q{font-size:12.5px;color:var(--muted);margin-top:4px;overflow-wrap:anywhere}
.ds-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}
.ds-chips .btn{min-height:28px;font-size:12px;padding:0 9px;max-width:100%;white-space:normal;text-align:left}
.ds-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,480px),1fr));gap:12px}
.ds-tile{border:1px solid var(--line);border-radius:var(--r);padding:10px 12px;background:var(--surface);min-width:0}
.ds-tile-h{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap}
.ds-tile-h b{font-weight:600;font-size:13.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 120px}
.ds-tile-h .acts{flex:none}
.ds-sim{border:1px dashed var(--warn);color:var(--warn);background:var(--warn-soft);border-radius:6px;padding:8px 10px;font-size:12.5px;margin:0 0 12px;overflow-wrap:anywhere}
.ds-li{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:9px 0;border-top:1px solid var(--line);min-width:0}
.ds-li:first-child{border-top:0}
.ds-li .t{font-weight:600;font-size:13.5px;overflow-wrap:anywhere}
.ds-li .s{font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.ds-li>div:first-child{min-width:0}
.ds-li .acts{flex:none}
.ds-mono{font-family:var(--f-mono);font-size:12.5px}
.ds-fx{font:600 15px/1.4 var(--f-mono);color:var(--ink);background:var(--surface-2);border:1px solid var(--line);border-radius:6px;padding:9px 11px;overflow-wrap:anywhere;margin:0 0 8px}
.ds-fields{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}
.ds-fields button{background:var(--surface-2);border:1px solid var(--line);border-radius:999px;padding:3px 9px;font:500 12px var(--f-mono);color:var(--ink-2)}
.ds-fields button:hover{border-color:var(--accent);color:var(--ink)}
.ds-ok{color:var(--good);font-size:12.5px;margin:0 0 8px;overflow-wrap:anywhere}
.ds-kv{margin:0;display:grid;grid-template-columns:minmax(0,auto) minmax(0,1fr);gap:6px 12px;font-size:12.5px}
.ds-kv dt{font:500 12px var(--f-mono);color:var(--accent)}
.ds-kv dd{margin:0;color:var(--ink-2);min-width:0;overflow-wrap:anywhere}
.ds-cell-bar{display:flex;gap:8px;align-items:center;justify-content:flex-end}
.ds-cell-bar .bar{width:88px;flex:none}
.ds-cell-bar .num{min-width:3.5em;text-align:right}
.ds-chipw{white-space:normal;line-height:1.3;border-radius:6px}
.ds-page .filters .field{min-width:0}
.ds-page .filters .field select{min-width:0;max-width:100%}
@media (max-width:560px){.ds-tile{padding:10px}.ds-fx{font-size:14px}}
`;
const ds_STYLE = document.createElement('style');
ds_STYLE.id = 'ds-page-style';
ds_STYLE.textContent = ds_CSS;
document.head.appendChild(ds_STYLE);

// the agent this page calls; core's AGENTS table lists the four core agents, so this file adds the fifth
if (!AGENTS['Data Scientist']) AGENTS['Data Scientist'] = { name: 'Data Scientist', icon: 'Σ', role: 'Writes SQL over the season tables and explains the result', color: '#0E7C86' };

const ds_PAL = ['#2458C6', '#0C7A53', '#A8650F', '#B93B12', '#8A4FBF', '#0E7C86', '#B0457A', '#5F7F2A', '#6B6F7B'];
const ds_S = {
  q: { sql: '', res: null, err: null, ran: null, qsort: { k: null, dir: 'desc' }, ask: null, q: '' },
  cb: { table: 'passes', x: 'phase', y: '', agg: 'count', colour: 'team', type: 'bar', fCol: '', fVal: '', name: '' },
  bd: { id: null, name: 'Match-week board', items: [], sched: null, schedF: 'weekly', schedTo: 'Performance analysis channel' },
  mx: { name: 'Progressive passes per 90', f: 'prog / mins * 90', grp: '', minApps: 1, msg: null, ok: false },
  cache: {}, busy: {}, wait: {},
};

// ---------------------------------------------------------------- saved examples, presets and rules
const ds_EX = [
  { id: 'xg-team', name: 'Shot quality by team', sql: 'SELECT team, COUNT(*) AS shots, ROUND(SUM(xg), 2) AS xg, ROUND(AVG(xg), 3) AS avg_xg\nFROM shots\nGROUP BY team\nORDER BY xg DESC' },
  { id: 'xg-kind', name: 'Shot quality by kind of shot', sql: 'SELECT kind, COUNT(*) AS shots, ROUND(SUM(xg), 2) AS xg, ROUND(AVG(xg), 3) AS avg_xg\nFROM shots\nWHERE kind IS NOT NULL\nGROUP BY kind\nORDER BY xg DESC' },
  { id: 'shooters', name: 'Top shooters with club (JOIN)', sql: 'SELECT p.name, p.team, COUNT(*) AS shots, ROUND(SUM(s.xg), 2) AS xg\nFROM shots AS s\nJOIN players AS p ON s.player = p.name\nGROUP BY p.name, p.team\nORDER BY xg DESC\nLIMIT 10' },
  { id: 'prog90', name: 'Progressive passes per 90', sql: 'SELECT name, team, prog, apps, ROUND(prog / mins * 90, 2) AS prog_p90\nFROM players\nWHERE apps >= 5\nORDER BY prog_p90 DESC\nLIMIT 10' },
  { id: 'press', name: 'Ball wins in the final third', sql: "SELECT team, COUNT(*) AS wins_high\nFROM events\nWHERE type = 'turnover' AND x >= 70\nGROUP BY team\nORDER BY wins_high DESC" },
  { id: 'territory', name: 'Ball time in the right third, by match (JOIN)', sql: 'SELECT m.match_id, m.home, m.away, m.hg, m.ag, f.ball_x70_pct\nFROM matches AS m\nJOIN frames_summary AS f ON m.match_id = f.match_id\nORDER BY f.ball_x70_pct DESC\nLIMIT 8' },
];
const ds_QSUG = ['Who has the most xG?', 'Who scores the most goals?', 'Which team wins the ball high up most often?', 'Who makes the most progressive passes per 90?', 'What are the latest results?'];
const ds_CB_EX = [
  { name: 'Passes by phase of play', spec: { table: 'passes', x: 'phase', y: '', agg: 'count', colour: 'team', type: 'bar' } },
  { name: 'Shot xG by kind of shot', spec: { table: 'shots', x: 'kind', y: 'xg', agg: 'sum', colour: '', type: 'bar' } },
  { name: 'Shot xG by team', spec: { table: 'shots', x: 'team', y: 'xg', agg: 'sum', colour: '', type: 'bar' } },
  { name: 'Shot map: xG by pitch zone', spec: { table: 'shots', x: 'x', y: 'xg', agg: 'sum', colour: '', type: 'heat' } },
  { name: 'Passes by kind and team', spec: { table: 'passes', x: 'kind', y: '', agg: 'count', colour: 'team', type: 'bar' } },
  { name: 'Shot xG by minute and team', spec: { table: 'shots', x: 'minute', y: 'xg', agg: 'sum', colour: 'team', type: 'line' } },
  { name: 'Players: goals against xG', spec: { table: 'players', x: 'xg', y: 'goals', agg: 'avg', colour: 'team', type: 'scatter' } },
  { name: 'Ball time in the right third, by match', spec: { table: 'frames_summary', x: 'match_id', y: 'ball_x70_pct', agg: 'avg', colour: '', type: 'line' } },
];
const ds_MX_EX = [
  { name: 'Progressive passes per 90', f: 'prog / mins * 90' },
  { name: 'Pressing intensity', f: '(tackles + hw) / mins * 90' },
  { name: 'Pass completion %', f: 'done / passes * 100' },
  { name: 'xG per 90', f: 'xg / mins * 90' },
];
// player fields for custom metrics: [key, short label, definition]
const ds_MF = [
  ['mins', 'Minutes', 'Minutes played: matches × 90.'],
  ['apps', 'Matches', 'Matches played.'],
  ['goals', 'Goals', 'Goals scored.'],
  ['xg', 'xG', 'Expected goals from the player’s shots.'],
  ['shots', 'Shots', 'Shots taken.'],
  ['passes', 'Passes', 'Passes attempted.'],
  ['done', 'Passes completed', 'Passes completed.'],
  ['passPct', 'Pass completion %', 'Completed passes as a share of attempts.'],
  ['prog', 'Progressive passes', 'Derived from event rows: passes of 15 m or more. The data has no end point, so direction is not checked.'],
  ['ftp', 'Final-third passes', 'Derived from event rows: passes started in the final third (x of 70 m or more).'],
  ['recv', 'Passes received', 'Passes received.'],
  ['wins', 'Ball wins', 'Turnovers won by the player.'],
  ['hw', 'Ball wins in the attacking half', 'Derived from event rows: turnovers won at x of 52.5 m or more.'],
  ['losses', 'Ball losses', 'Turnovers lost by the player.'],
  ['tackles', 'Tackles', 'Slide tackles.'],
  ['fouls', 'Fouls', 'Fouls committed.'],
  ['takeOns', 'Take-ons', 'Take-ons attempted.'],
  ['takeOnsWon', 'Take-ons won', 'Take-ons completed.'],
  ['touches', 'Touches', 'Touches of the ball, from tracking.'],
  ['km', 'Distance km', 'Distance covered in kilometres, season total.'],
  ['sprints', 'Sprints', 'Sprints, season total.'],
  ['top', 'Top speed', 'Top speed in km/h.'],
  ['rating', 'Average rating', 'Average match rating.'],
  ['abil', 'Ability', 'Ability rating from the squad list.'],
];
const ds_SCHED = [['weekly', 'Weekly, Monday 07:00'], ['daily', 'Daily, 07:00'], ['matchday', 'After each matchday']];
const ds_SRC = [
  { name: 'Season feed', kind: 'MatchCast season files: one JSON per match, plus league.json', status: 'Live in demo', schema: 'matches · events · passes · shots · players · frames_summary', note: 'Loaded into the in-browser tables when the console opens.' },
  { name: 'Watch dataset import', kind: 'Match JSON written by the Watch simulator', status: 'Live in demo', schema: 'match · events[] · frames[] (every 0.5 min) · roster · stats', note: 'Same files as the season feed. There is no upload yet.' },
  { name: 'CSV', kind: 'Flat file', status: 'Live in demo', schema: 'events: match_id, minute, type, team, player, x, y, xg, phase', note: 'Export only. CSV import is not built.', csv: true },
  { name: 'Parquet', kind: 'Columnar files', status: 'Planned (Parquet tables in OneLake, via Microsoft Fabric)', schema: 'The same six tables as the season feed', note: 'Not connected in this demo.' },
  { name: 'Live event stream', kind: 'Event messages during a match', status: 'Planned (Azure Event Hubs into OneLake)', schema: 'match_id, minute, type, team, player, x, y, xg, phase', note: 'Not connected in this demo.' },
];

// ---------------------------------------------------------------- small helpers
const ds_keyStr = (v) => (v == null ? '–' : String(v));
const ds_n = (v) => (v == null ? '–' : typeof v === 'number' ? (Number.isInteger(v) ? fmt(v) : fmt(v, Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 1 ? 2 : 3)) : esc(String(v)));
const ds_short = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const ds_when = (at) => (at ? new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const ds_fld = (label, inner) => '<label class="field"><span>' + label + '</span>' + inner + '</label>';
// one card: a failure inside the card shows in the card, the rest of the page still renders
function ds_try(title, sub, fn, acts) {
  let body;
  try { body = fn(); } catch (e) { console.error(e); body = '<div class="ds-err" role="alert">This card hit an error: ' + esc(e.message) + '</div>'; }
  return card(title, sub, body, acts || '');
}
// list of saved items: shows cached rows, loads them once, then calls redraw
function ds_list(col, el, redraw) {
  if (ds_S.cache[col]) return ds_S.cache[col];
  (ds_S.wait[col] = ds_S.wait[col] || []).push(() => { if (el.isConnected) redraw(); });
  if (!ds_S.busy[col]) {
    ds_S.busy[col] = true;
    ds_reload(col).then(() => { ds_S.busy[col] = false; const w = ds_S.wait[col] || []; ds_S.wait[col] = []; w.forEach((f) => f()); });
  }
  return [];
}
async function ds_reload(col) { const rows = await sList(col).catch(() => []); ds_S.cache[col] = rows || []; return ds_S.cache[col]; }
function ds_refocus(el, id) { if (!id) return; const n = el.querySelector('#' + id); if (n) n.focus(); }
function ds_segPress(el, id, v) { el.querySelectorAll('#' + id + ' button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v)))); }

// ---------------------------------------------------------------- season tables (built once from D)
const ds_SCHEMA_SRC = {
  events: 'match_id:s minute:n type:s team:s player:s x:n y:n xg:n phase:s',
  passes: 'match_id:s minute:n team:s player:s receiver:s kind:s phase:s distM:n quality:n x:n y:n',
  shots: 'match_id:s minute:n team:s player:s kind:s phase:s xg:n kmh:n x:n y:n',
  players: 'name:s team:s num:n pos:s grp:s abil:n apps:n mins:n rating:n goals:n xg:n shots:n passes:n done:n passPct:n recv:n wins:n losses:n takeOns:n takeOnsWon:n tackles:n fouls:n cards:n touches:n km:n sprints:n top:n prog:n ftp:n hw:n',
  matches: 'match_id:s date:s matchday:n home:s away:s hg:n ag:n goals:n stadium:s h_xg:n a_xg:n h_shots:n a_shots:n h_poss:n a_poss:n h_passes:n a_passes:n h_done:n a_done:n h_ppda:n a_ppda:n h_fouls:n a_fouls:n',
  frames_summary: 'match_id:s frames:n players:n last_minute:n ball_x_avg:n ball_y_avg:n ball_x70_pct:n',
};
const ds_SCHEMA = {};
for (const tname of Object.keys(ds_SCHEMA_SRC)) ds_SCHEMA[tname] = ds_SCHEMA_SRC[tname].split(' ').map((p) => { const bits = p.split(':'); return { n: bits[0], t: bits[1] }; });
const ds_colT = (table, c) => { const x = (ds_SCHEMA[table] || []).find((q) => q.n === c); return x ? x.t : null; };
let ds_TB = null;
function ds_T() {
  if (ds_TB) return ds_TB;
  if (!D.loaded) throw new Error('Season data is still loading.');
  const events = [], passes = [], shots = [], matches = [], fsum = [], der = {};
  const dv = (n) => der[n] || (der[n] = { prog: 0, ftp: 0, hw: 0 });
  for (const m of D.matches) {
    for (const e of m.events || []) {
      const x = e.ax ?? e.bx ?? null, y = e.ay ?? e.by ?? null;
      const row = { match_id: m.id, minute: e.minute ?? null, type: e.type, team: e.team ?? null, player: e.player ?? null, x, y, xg: e.type === 'shot' ? +(e.xg || 0) : null, phase: e.phase ?? null };
      events.push(row);
      if (e.type === 'pass') {
        passes.push({ match_id: m.id, minute: row.minute, team: row.team, player: row.player, receiver: e.to ?? null, kind: e.kind ?? null, phase: row.phase, distM: e.distM ?? null, quality: e.quality ?? null, x, y });
        if (e.player) { const d = dv(e.player); if ((e.distM || 0) >= 15) d.prog++; if ((x || 0) >= 70) d.ftp++; }
      } else if (e.type === 'shot') {
        shots.push({ match_id: m.id, minute: row.minute, team: row.team, player: row.player, kind: e.kind ?? null, phase: row.phase, xg: row.xg, kmh: e.kmh ?? null, x, y });
      } else if (e.type === 'turnover' && e.player && (x || 0) >= 52.5) dv(e.player).hw++;
    }
    const h = m.ts[m.home], a = m.ts[m.away];
    matches.push({ match_id: m.id, date: m.date, matchday: m.matchday, home: m.home, away: m.away, hg: m.score[0], ag: m.score[1], goals: m.score[0] + m.score[1], stadium: (m.setup || {}).stadium || null, h_xg: h.xg, a_xg: a.xg, h_shots: h.shots, a_shots: a.shots, h_poss: h.poss, a_poss: a.poss, h_passes: h.passes, a_passes: a.passes, h_done: h.done, a_done: a.done, h_ppda: h.ppda, a_ppda: a.ppda, h_fouls: h.fouls, a_fouls: a.fouls });
    const fr = m.frames || []; let sx = 0, sy = 0, nb = 0, hi = 0;
    for (const f of fr) { if (!f.b) continue; sx += f.b[0]; sy += f.b[1]; nb++; if (f.b[0] > 70) hi++; }
    fsum.push({ match_id: m.id, frames: fr.length, players: (m.pids || []).length, last_minute: fr.length ? fr[fr.length - 1].m : null, ball_x_avg: nb ? +(sx / nb).toFixed(2) : null, ball_y_avg: nb ? +(sy / nb).toFixed(2) : null, ball_x70_pct: nb ? +(100 * hi / nb).toFixed(1) : null });
  }
  const players = D.players.map((p) => {
    const d = der[p.name] || { prog: 0, ftp: 0, hw: 0 };
    return { name: p.name, team: p.team, num: p.num, pos: p.pos, grp: p.group, abil: p.abil, apps: p.apps, mins: p.apps * 90, rating: p.rating, goals: p.goals, xg: p.xg, shots: p.shots, passes: p.passes, done: p.done, passPct: p.passPct, recv: p.recv, wins: p.wins, losses: p.losses, takeOns: p.takeOns, takeOnsWon: p.takeOnsWon, tackles: p.tackles, fouls: p.fouls, cards: p.cards, touches: p.touches, km: p.km, sprints: p.sprints, top: p.top, prog: d.prog, ftp: d.ftp, hw: d.hw };
  });
  ds_TB = { events, passes, shots, players, matches, frames_summary: fsum };
  return ds_TB;
}

// ---------------------------------------------------------------- SQL subset: lexer, parser, executor
function ds_lex(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && s[i + 1] === '-') { while (i < s.length && s[i] !== '\n') i++; continue; }
    const p = i;
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      const w = s.slice(i, j), U = w.toUpperCase();
      out.push(ds_KW.includes(U) || ds_AGGS.includes(U) || U === 'ROUND' ? { t: 'kw', v: U, p } : { t: 'id', v: w, p });
      i = j; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const t = s.slice(i, j);
      if (!/^\d*\.?\d+$/.test(t)) throw new Error('“' + t + '” is not a valid number at position ' + (p + 1) + '.');
      out.push({ t: 'num', v: +t, p }); i = j; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1, v = '';
      for (;;) {
        if (j >= s.length) throw new Error('Unclosed text that starts at position ' + (p + 1) + '.');
        if (s[j] === c) { if (s[j + 1] === c) { v += c; j += 2; continue; } break; }
        v += s[j++];
      }
      out.push({ t: 'str', v, p }); i = j + 1; continue;
    }
    const two = s.substr(i, 2);
    if (two === '<=' || two === '>=' || two === '!=' || two === '<>') { out.push({ t: 'op', v: two === '<>' ? '!=' : two, p }); i += 2; continue; }
    if ('=<>+-*/(),.;'.includes(c)) { out.push({ t: 'op', v: c, p }); i++; continue; }
    throw new Error('Unexpected character “' + c + '” at position ' + (p + 1) + '.');
  }
  out.push({ t: 'eof', v: '', p: s.length });
  return out;
}
const ds_KW = ['SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'ORDER', 'LIMIT', 'JOIN', 'INNER', 'ON', 'AS', 'AND', 'OR', 'NOT', 'ASC', 'DESC', 'IS', 'NULL', 'LIKE', 'IN', 'DISTINCT', 'LEFT', 'RIGHT', 'OUTER', 'FULL'];
const ds_AGGS = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
function ds_kids(n) {
  switch (n.t) {
    case 'bin': return [n.a, n.b];
    case 'not': case 'isnull': return [n.a];
    case 'like': return [n.a, n.p];
    case 'in': return [n.a, ...n.items];
    case 'call': return n.args;
    default: return [];
  }
}
function ds_hasAgg(n) { if (!n) return false; if (n.t === 'call' && n.agg) return true; return ds_kids(n).some(ds_hasAgg); }
function ds_canon(n) {
  switch (n.t) {
    case 'lit': return typeof n.v === 'string' ? "'" + n.v + "'" : String(n.v);
    case 'col': return (n.alias || '?') + '.' + n.key;
    case 'bin': return '(' + ds_canon(n.a) + n.op + ds_canon(n.b) + ')';
    case 'call': return n.fn + '(' + (n.star ? '*' : (n.distinct ? 'DISTINCT ' : '') + n.args.map(ds_canon).join(',')) + ')';
    case 'not': return 'NOT ' + ds_canon(n.a);
    case 'isnull': return ds_canon(n.a) + (n.neg ? ' IS NOT NULL' : ' IS NULL');
    case 'like': return ds_canon(n.a) + (n.neg ? ' NOT' : '') + ' LIKE ' + ds_canon(n.p);
    case 'in': return ds_canon(n.a) + (n.neg ? ' NOT' : '') + ' IN(' + n.items.map(ds_canon).join(',') + ')';
    default: return '?';
  }
}
function ds_parse(src) {
  const T = ds_lex(src); let k = 0;
  const isKw = (v) => T[k].t === 'kw' && T[k].v === v;
  const isOp = (v) => T[k].t === 'op' && T[k].v === v;
  const where = () => (T[k].t === 'eof' ? 'at the end of the query' : 'near “' + T[k].v + '” (position ' + (T[k].p + 1) + ')');
  const fail = (m) => { throw new Error(m + ' ' + where() + '.'); };
  const kw = (v) => { if (!isKw(v)) fail('Expected ' + v); k++; };
  const ident = (what) => { if (T[k].t !== 'id') fail('Expected ' + (what || 'a name')); return T[k++].v; };
  const list = (f) => { const out = [f()]; while (isOp(',')) { k++; out.push(f()); } return out; };
  const orE = () => { let a = andE(); while (isKw('OR')) { k++; a = { t: 'bin', op: 'OR', a, b: andE() }; } return a; };
  const andE = () => { let a = notE(); while (isKw('AND')) { k++; a = { t: 'bin', op: 'AND', a, b: notE() }; } return a; };
  const notE = () => { if (isKw('NOT')) { k++; return { t: 'not', a: notE() }; } return cmpE(); };
  const cmpE = () => {
    const a = addE();
    if (T[k].t === 'op' && ['=', '!=', '<', '<=', '>', '>='].includes(T[k].v)) { const op = T[k++].v; return { t: 'bin', op, a, b: addE() }; }
    if (isKw('IS')) { k++; const neg = isKw('NOT'); if (neg) k++; kw('NULL'); return { t: 'isnull', a, neg }; }
    let neg = false; if (isKw('NOT')) { neg = true; k++; }
    if (isKw('LIKE')) { k++; return { t: 'like', a, p: addE(), neg }; }
    if (isKw('IN')) { k++; if (!isOp('(')) fail('Expected ( after IN'); k++; const items = list(addE); if (!isOp(')')) fail('Expected ) to close IN'); k++; return { t: 'in', a, items, neg }; }
    if (neg) fail('Expected LIKE or IN after NOT');
    return a;
  };
  const addE = () => { let a = mulE(); while (isOp('+') || isOp('-')) { const op = T[k++].v; a = { t: 'bin', op, a, b: mulE() }; } return a; };
  const mulE = () => { let a = prim(); while (isOp('*') || isOp('/')) { const op = T[k++].v; a = { t: 'bin', op, a, b: prim() }; } return a; };
  const prim = () => {
    const t = T[k];
    if (t.t === 'num' || t.t === 'str') { k++; return { t: 'lit', v: t.v }; }
    if (isKw('NULL')) { k++; return { t: 'lit', v: null }; }
    if (isOp('(')) { k++; const e = orE(); if (!isOp(')')) fail('Expected ) to close the bracket'); k++; return e; }
    if (isOp('-')) fail('Negative numbers and unary minus are not supported. Write 0 - value');
    if (t.t === 'kw' && (ds_AGGS.includes(t.v) || t.v === 'ROUND')) {
      const fn = t.v; k++;
      if (!isOp('(')) fail('Expected ( after ' + fn);
      k++;
      let distinct = false, star = false, args = [];
      if (isKw('DISTINCT')) { distinct = true; k++; }
      if (isOp('*')) { star = true; k++; } else if (!isOp(')')) args = list(orE);
      if (!isOp(')')) fail('Expected ) to close ' + fn + '(');
      k++;
      if (star && fn !== 'COUNT') fail('Only COUNT takes *');
      if (distinct && fn !== 'COUNT') fail('DISTINCT works only inside COUNT');
      if (!star && (fn === 'ROUND' ? (args.length < 1 || args.length > 2) : args.length !== 1)) fail(fn + ' takes ' + (fn === 'ROUND' ? '1 or 2 arguments' : '1 argument'));
      const isAgg = ds_AGGS.includes(fn);
      if (isAgg && args.some(ds_hasAgg)) fail('Aggregates cannot be nested');
      return { t: 'call', fn, args, star, distinct, agg: isAgg };
    }
    if (t.t === 'id') {
      k++;
      if (isOp('.')) { k++; const c = ident('a column name'); return { t: 'col', tbl: t.v, name: c }; }
      return { t: 'col', tbl: null, name: t.v };
    }
    return fail('Expected a value, a column or a function');
  };
  const tref = () => {
    const name = ident('a table name').toLowerCase(); let alias = name;
    if (isKw('AS')) { k++; alias = ident('an alias'); } else if (T[k].t === 'id') alias = T[k++].v;
    return { name, alias };
  };
  kw('SELECT');
  if (isKw('DISTINCT')) fail('DISTINCT is supported only inside COUNT()');
  const ast = { items: [], star: false, from: null, joins: [], where: null, groupBy: [], orderBy: [], limit: null };
  if (isOp('*')) { k++; ast.star = true; }
  else ast.items = list(() => { const e = orE(); let alias = null; if (isKw('AS')) { k++; alias = ident('an alias'); } else if (T[k].t === 'id') alias = T[k++].v; return { e, alias }; });
  kw('FROM');
  ast.from = tref();
  while (isKw('JOIN') || isKw('INNER')) { if (isKw('INNER')) k++; kw('JOIN'); const t = tref(); kw('ON'); ast.joins.push({ t, on: orE() }); }
  if (isKw('LEFT') || isKw('RIGHT') || isKw('OUTER') || isKw('FULL')) fail('Only INNER JOIN is supported');
  if (isKw('WHERE')) { k++; ast.where = orE(); }
  if (isKw('GROUP')) { k++; kw('BY'); ast.groupBy = list(orE); }
  if (isKw('ORDER')) {
    k++; kw('BY');
    ast.orderBy = list(() => { const e = orE(); let dir = 'ASC'; if (isKw('ASC')) k++; else if (isKw('DESC')) { dir = 'DESC'; k++; } return { e, dir }; });
  }
  if (isKw('LIMIT')) { k++; if (T[k].t !== 'num') fail('LIMIT needs a whole number'); ast.limit = Math.max(0, Math.floor(T[k++].v)); }
  if (isOp(';')) k++;
  if (T[k].t !== 'eof') fail('Unexpected text');
  return ast;
}
function ds_resolve(n, srcs) {
  if (!n) return;
  if (n.t === 'col') {
    const want = n.name.toLowerCase();
    if (n.tbl) {
      const si = srcs.findIndex((s) => s.alias.toLowerCase() === n.tbl.toLowerCase());
      if (si < 0) throw new Error('Unknown table or alias “' + n.tbl + '”. Use one of: ' + srcs.map((s) => s.alias).join(', ') + '.');
      const c = srcs[si].cols.find((x) => x.n.toLowerCase() === want);
      if (!c) throw new Error('Unknown column “' + n.tbl + '.' + n.name + '”. Check the schema list for ' + srcs[si].name + '.');
      Object.assign(n, { src: si, key: c.n, alias: srcs[si].alias, typ: c.t });
      return;
    }
    const hits = [];
    srcs.forEach((s, si) => { const c = s.cols.find((x) => x.n.toLowerCase() === want); if (c) hits.push({ si, c, s }); });
    if (!hits.length) throw new Error('Unknown column “' + n.name + '”. Check the schema list for the tables in FROM and JOIN.');
    if (hits.length > 1) throw new Error('Column “' + n.name + '” is in more than one table. Qualify it, for example ' + hits[0].s.alias + '.' + n.name + '.');
    Object.assign(n, { src: hits[0].si, key: hits[0].c.n, alias: hits[0].s.alias, typ: hits[0].c.t });
    return;
  }
  ds_kids(n).forEach((c) => ds_resolve(c, srcs));
}
function ds_cmp(a, b) { if (typeof a === 'number' && typeof b === 'number') return a - b; const x = String(a), y = String(b); return x < y ? -1 : x > y ? 1 : 0; }
function ds_truthy(v) { return v === true || (typeof v === 'number' && v !== 0); }
function ds_like(p) { return new RegExp('^' + String(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i'); }
function ds_ev(n, c, g) {
  switch (n.t) {
    case 'lit': return n.v;
    case 'col': { const r = c ? c[n.src] : null; const v = r ? r[n.key] : null; return v === undefined ? null : v; }
    case 'not': { const v = ds_ev(n.a, c, g); return v == null ? null : !ds_truthy(v); }
    case 'isnull': { const v = ds_ev(n.a, c, g); return n.neg ? v != null : v == null; }
    case 'like': { const v = ds_ev(n.a, c, g), p = ds_ev(n.p, c, g); if (v == null || p == null) return false; const r = ds_like(p).test(String(v)); return n.neg ? !r : r; }
    case 'in': {
      const v = ds_ev(n.a, c, g); if (v == null) return false;
      const hit = n.items.some((it) => { const w = ds_ev(it, c, g); return w != null && ds_cmp(v, w) === 0; });
      return n.neg ? !hit : hit;
    }
    case 'call': return ds_callEv(n, c, g);
    case 'bin': {
      if (n.op === 'AND') return ds_truthy(ds_ev(n.a, c, g)) && ds_truthy(ds_ev(n.b, c, g));
      if (n.op === 'OR') return ds_truthy(ds_ev(n.a, c, g)) || ds_truthy(ds_ev(n.b, c, g));
      const a = ds_ev(n.a, c, g), b = ds_ev(n.b, c, g);
      if (['=', '!=', '<', '<=', '>', '>='].includes(n.op)) {
        if (a == null || b == null) return false;
        const d = ds_cmp(a, b);
        return n.op === '=' ? d === 0 : n.op === '!=' ? d !== 0 : n.op === '<' ? d < 0 : n.op === '<=' ? d <= 0 : n.op === '>' ? d > 0 : d >= 0;
      }
      if (a == null || b == null) return null;
      const x = +a, y = +b;
      if (Number.isNaN(x) || Number.isNaN(y)) return null;
      if (n.op === '+') return x + y;
      if (n.op === '-') return x - y;
      if (n.op === '*') return x * y;
      return y === 0 ? null : x / y;
    }
    default: return null;
  }
}
function ds_callEv(n, c, g) {
  if (n.agg) { if (!g) throw new Error(n.fn + '() needs GROUP BY or aggregates in the query.'); return ds_agg(n, g); }
  const v = ds_ev(n.args[0], c, g);
  if (v == null || Number.isNaN(+v)) return null;
  const d = n.args[1] ? Math.max(0, Math.min(6, Math.floor(+ds_ev(n.args[1], c, g) || 0))) : 0;
  const p = Math.pow(10, d);
  return Math.round(+v * p) / p;
}
function ds_agg(n, g) {
  if (!g.memo) g.memo = new Map();
  if (g.memo.has(n)) return g.memo.get(n);
  let out = null;
  if (n.fn === 'COUNT' && n.star) out = g.rows.length;
  else {
    let vs = [];
    for (const c of g.rows) { const v = ds_ev(n.args[0], c, null); if (v != null) vs.push(v); }
    if (n.distinct) vs = [...new Set(vs)];
    if (n.fn === 'COUNT') out = vs.length;
    else if (n.fn === 'SUM' || n.fn === 'AVG') {
      if (vs.length) { let s = 0; for (const v of vs) s += +v; out = n.fn === 'SUM' ? s : s / vs.length; }
    } else if (vs.length) out = vs.reduce((a, b) => (n.fn === 'MIN' ? (ds_cmp(b, a) < 0 ? b : a) : (ds_cmp(b, a) > 0 ? b : a)));
  }
  g.memo.set(n, out);
  return out;
}
// runs one SELECT over the in-memory tables; returns {cols, rows (objects), total, ms, sql}
function ds_exec(sql) {
  const t0 = performance.now();
  const ast = ds_parse(sql), TB = ds_T();
  const srcs = [];
  const addSrc = (r) => {
    const cols = ds_SCHEMA[r.name];
    if (!cols) throw new Error('Unknown table “' + r.name + '”. Tables: ' + Object.keys(ds_SCHEMA).join(', ') + '.');
    if (srcs.some((s) => s.alias.toLowerCase() === r.alias.toLowerCase())) throw new Error('The name “' + r.alias + '” is used twice. Give one table another alias.');
    srcs.push({ name: r.name, alias: r.alias, cols });
  };
  addSrc(ast.from);
  for (const j of ast.joins) addSrc(j.t);
  const joinKeys = ast.joins.map((j, ji) => {
    const ni = ji + 1;
    ds_resolve(j.on, srcs);
    if (j.on.t !== 'bin' || j.on.op !== '=' || j.on.a.t !== 'col' || j.on.b.t !== 'col') throw new Error('JOIN ... ON must compare two columns with =, for example ON s.player = p.name.');
    const a = j.on.a, b = j.on.b;
    if (a.src === ni && b.src < ni) return { left: b, right: a };
    if (b.src === ni && a.src < ni) return { left: a, right: b };
    throw new Error('JOIN ... ON must link the joined table to a table named earlier in the query.');
  });
  let selItems;
  if (ast.star) {
    if (ast.groupBy.length) throw new Error('SELECT * cannot be used with GROUP BY. Name the columns.');
    selItems = [];
    srcs.forEach((s, si) => s.cols.forEach((c) => selItems.push({ e: { t: 'col', tbl: null, name: c.n, src: si, key: c.n, alias: s.alias, typ: c.t }, alias: srcs.length > 1 ? s.alias + '.' + c.n : null })));
  } else {
    selItems = ast.items;
    selItems.forEach((it) => ds_resolve(it.e, srcs));
  }
  const labels = [];
  selItems.forEach((it) => {
    const L = it.alias || (it.e.t === 'col' ? it.e.key : ds_canon(it.e));
    let u = L, q = 2;
    while (labels.includes(u)) u = L + '_' + q++;
    labels.push(u);
  });
  if (ast.where) {
    ds_resolve(ast.where, srcs);
    if (ds_hasAgg(ast.where)) throw new Error('Aggregates are not allowed in WHERE. Move them to GROUP BY or ORDER BY.');
  }
  const gbs = ast.groupBy.map((g) => {
    if (g.t === 'lit' && typeof g.v === 'number') {
      const it = selItems[g.v - 1];
      if (!it) throw new Error('GROUP BY ' + g.v + ' is not a SELECT column.');
      return it.e;
    }
    ds_resolve(g, srcs);
    if (ds_hasAgg(g)) throw new Error('GROUP BY cannot use aggregates.');
    return g;
  });
  const ords = ast.orderBy.map((o) => {
    if (o.e.t === 'lit' && typeof o.e.v === 'number') {
      const i = o.e.v - 1;
      if (i < 0 || i >= selItems.length) throw new Error('ORDER BY ' + o.e.v + ' is not a SELECT column.');
      return { idx: i, dir: o.dir };
    }
    if (o.e.t === 'col' && !o.e.tbl) {
      const i = labels.findIndex((l) => l.toLowerCase() === o.e.name.toLowerCase());
      if (i >= 0) return { idx: i, dir: o.dir };
    }
    ds_resolve(o.e, srcs);
    return { e: o.e, dir: o.dir };
  });
  const grouped = gbs.length > 0 || selItems.some((it) => ds_hasAgg(it.e)) || ords.some((o) => o.e && ds_hasAgg(o.e));
  if (grouped) {
    if (ast.star) throw new Error('SELECT * cannot be used with aggregates. Name the columns.');
    const gset = new Set(gbs.map(ds_canon));
    const chk = (n) => {
      if (gset.has(ds_canon(n))) return;
      if (n.t === 'call' && n.agg) return;
      if (n.t === 'lit') return;
      if (n.t === 'col') throw new Error('Column “' + ds_canon(n) + '” must appear in GROUP BY or inside an aggregate such as SUM().');
      ds_kids(n).forEach(chk);
    };
    selItems.forEach((it) => chk(it.e));
    ords.forEach((o) => { if (o.e) chk(o.e); });
  }
  // FROM and JOIN: nested rows, one row object per source
  let rows = TB[ast.from.name].map((r) => [r]);
  ast.joins.forEach((j, ji) => {
    const jk = joinKeys[ji], idx = new Map();
    for (const r of TB[j.t.name]) { const v = r[jk.right.key]; if (v == null) continue; const s = String(v); let arr = idx.get(s); if (!arr) idx.set(s, (arr = [])); arr.push(r); }
    const nxt = [];
    for (const c of rows) { const v = c[jk.left.src][jk.left.key]; if (v == null) continue; const m = idx.get(String(v)); if (m) for (const r of m) nxt.push(c.concat([r])); }
    rows = nxt;
  });
  if (ast.where) rows = rows.filter((c) => ds_truthy(ds_ev(ast.where, c, null)));
  const project = (c, g) => {
    const vals = selItems.map((it) => ds_ev(it.e, c, g));
    const keys = ords.map((o) => (o.idx != null ? vals[o.idx] : ds_ev(o.e, c, g)));
    return { v: vals, k: keys };
  };
  let out = [];
  if (grouped) {
    const groups = new Map();
    if (!gbs.length) groups.set('', { rows });
    else {
      for (const c of rows) {
        const key = JSON.stringify(gbs.map((e) => ds_ev(e, c, null)));
        let g = groups.get(key);
        if (!g) { g = { rows: [] }; groups.set(key, g); }
        g.rows.push(c);
      }
    }
    for (const g of groups.values()) out.push(project(g.rows[0] || null, g));
  } else {
    for (const c of rows) out.push(project(c, null));
  }
  if (ords.length) {
    out.sort((x, y) => {
      for (let i = 0; i < ords.length; i++) {
        const a = x.k[i], b = y.k[i];
        if (a == null || b == null) { if (a == null && b == null) continue; return a == null ? 1 : -1; }
        const d = ds_cmp(a, b);
        if (d) return ords[i].dir === 'DESC' ? -d : d;
      }
      return 0;
    });
  }
  const total = out.length;
  if (ast.limit != null) out = out.slice(0, ast.limit);
  const objs = out.map((o) => { const r = {}; labels.forEach((l, i) => { r[l] = o.v[i]; }); return r; });
  return { sql, cols: labels, rows: objs, total, ms: Math.round(performance.now() - t0) };
}

// ---------------------------------------------------------------- plain English: rules fallback (no AI)
function ds_rule(q) {
  const s = q.toLowerCase();
  const exq = (id) => ds_EX.find((e) => e.id === id).sql;
  const first = (rows) => rows[0];
  if (/goal/.test(s) && !/xg|expected/.test(s)) return { sql: 'SELECT name, team, goals, xg FROM players ORDER BY goals DESC LIMIT 10', say: (rows) => (first(rows) ? first(rows).name + ' (' + clubName(first(rows).team) + ') has the most goals: ' + first(rows).goals + ', from ' + first(rows).xg + ' xG.' : 'No players matched.') };
  if (/(team|club|side)/.test(s) && /(xg|shot|goal|attack|create)/.test(s)) return { sql: exq('xg-team'), say: (rows) => (first(rows) ? clubName(first(rows).team) + ' created the most xG: ' + first(rows).xg + ' from ' + first(rows).shots + ' shots.' : 'No shots matched.') };
  if (/(xg|shot|finish|shoot)/.test(s)) return { sql: exq('shooters'), say: (rows) => (first(rows) ? first(rows).name + ' (' + clubName(first(rows).team) + ') has the most xG among shooters: ' + first(rows).xg + ' from ' + first(rows).shots + ' shots.' : 'No shots matched.') };
  if (/progress|prog/.test(s)) return { sql: exq('prog90'), say: (rows) => (first(rows) ? first(rows).name + ' (' + clubName(first(rows).team) + ') makes the most progressive passes per 90: ' + first(rows).prog_p90 + '.' : 'No players matched.') };
  if (/pass/.test(s)) return { sql: 'SELECT name, team, passes, passPct FROM players ORDER BY passes DESC LIMIT 10', say: (rows) => (first(rows) ? first(rows).name + ' (' + clubName(first(rows).team) + ') attempts the most passes: ' + first(rows).passes + ', ' + first(rows).passPct + '% completed.' : 'No players matched.') };
  if (/press|turnover|tackl|ball win|regain|win.*ball|high/.test(s)) return { sql: exq('press'), say: (rows) => (first(rows) ? clubName(first(rows).team) + ' won the ball in the final third most often: ' + first(rows).wins_high + ' times.' : 'No turnovers matched.') };
  if (/ball|territory|possession|third/.test(s)) return { sql: exq('territory'), say: (rows) => (first(rows) ? 'Most ball time in the right third: ' + clubName(first(rows).home) + ' v ' + clubName(first(rows).away) + ' (' + first(rows).hg + '–' + first(rows).ag + '), ' + first(rows).ball_x70_pct + '% of frames.' : 'No matches matched.') };
  if (/result|score|match|game|latest|recent/.test(s)) return { sql: 'SELECT date, home, away, hg, ag FROM matches ORDER BY date DESC LIMIT 5', say: (rows) => (first(rows) ? 'Latest result: ' + clubName(first(rows).home) + ' ' + first(rows).hg + '–' + first(rows).ag + ' ' + clubName(first(rows).away) + ' on ' + first(rows).date + '.' : 'No matches matched.') };
  return null;
}
function ds_agentTools() {
  return [{
    name: 'run_sql',
    description: 'Run one read-only SELECT over the season tables (events, passes, shots, players, matches, frames_summary). Returns the columns, the row count and up to 20 rows.',
    inputSchema: { type: 'object', properties: { sql: { type: 'string', description: 'A SELECT statement' } }, required: ['sql'] },
    execute: (inp) => { try { const r = ds_exec(String((inp && inp.sql) || '')); return { columns: r.cols, rowCount: r.total, rows: r.rows.slice(0, 20) }; } catch (e) { return { error: e.message }; } },
  }];
}
function ds_agentCtx(q) {
  const TB = ds_T();
  return { question: q, season: { competition: D.league ? D.league.competition : '', matches: D.matches.length }, tables: Object.keys(ds_SCHEMA).map((t) => ({ table: t, rows: TB[t].length, columns: ds_SCHEMA[t].map((c) => c.n) })) };
}

// ---------------------------------------------------------------- results and tables
function ds_colsOf(res) {
  return res.cols.map((c) => ({ k: c, l: esc(c), r: ds_isNum(res.rows, c), f: (o) => ds_n(o[c]), v: (o) => (typeof o[c] === 'number' ? o[c] : String(o[c] == null ? '' : o[c])) }));
}
function ds_isNum(rows, c) { const r = rows.find((o) => o[c] != null); return !!r && typeof r[c] === 'number'; }
function ds_miniTbl(res) { return tbl(ds_colsOf(res), res.rows, { id: 'ds-mini', limit: 10 }); }

// ---------------------------------------------------------------- Query workbench
function ds_qResBody(S) {
  if (S.err) return '<div class="ds-err" role="alert">' + esc(S.err) + '</div>' + (S.ran ? '<pre class="ds-pre">' + esc(S.ran) + '</pre>' : '');
  if (!S.res) return '<div class="empty">Run a query or pick a saved example. The SQL that ran and the row count appear here.</div>';
  const r = S.res;
  const meta = '<div class="ds-meta">' + chip(fmt(r.total) + ' row' + (r.total === 1 ? '' : 's'), 'good') + chip(r.ms + ' ms', '') + (r.rows.length < r.total ? chip('Showing first ' + fmt(r.rows.length), 'warn') : '') + '</div>';
  return '<pre class="ds-pre">' + esc(r.sql) + '</pre>' + meta + tbl(ds_colsOf(r), r.rows, { id: 'ds-rt', sort: S.qsort, limit: 500, empty: 'The query ran and returned no rows.' }) + (r.total > 500 ? '<p class="ds-note">The table shows the first 500 rows. CSV export has all ' + fmt(r.rows.length) + '.</p>' : '');
}
function ds_askBody(S) {
  const A = S.ask;
  if (!A) return '<div class="ds-note">Ask a question about the season, or tap a suggestion. The SQL that answers it is shown under the answer.</div>';
  if (A.busy) return '<div class="ds-note">Working on it…</div>';
  const run = A.run;
  let h = '<div class="ds-q">Question: ' + esc(A.q) + '</div><div class="ds-ans">' + esc(run.text || '') + '</div>';
  h += '<div class="ds-meta">' + (run.src === 'ai' ? groundChip(run.ground) : chip('Rules, computed from SQL', 'info')) + (run.src === 'ai' ? chip('Claude', 'good') : chip('Claude not granted here', 'warn')) + (A.res ? chip(fmt(A.res.total) + ' rows', '') : '') + '</div>';
  if (run.src === 'ai' && run.steps && run.steps.length) h += '<div class="steps">' + run.steps.map((s) => '<div>' + esc(s) + '</div>').join('') + '</div>';
  if (run.src !== 'ai' && A.sql) h += '<pre class="ds-pre">' + esc(A.sql) + '</pre>' + (A.res ? ds_miniTbl(A.res) : '');
  if (A.err) h += '<div class="ds-err">The SQL for this question failed: ' + esc(A.err) + '</div>';
  return h;
}
function ds_qRun(el) {
  const S = ds_S.q;
  const ta = el.querySelector('#ds-sql'); if (ta) S.sql = ta.value;
  S.ran = S.sql;
  try { S.res = ds_exec(S.sql); S.err = null; } catch (e) { S.res = null; S.err = e.message; }
  S.qsort = { k: null, dir: 'desc' };
  audit('ds.query', 'Query workbench', ds_short(S.sql, 140) + (S.res ? ' · ' + fmt(S.res.total) + ' rows' : ' · error: ' + S.err), S.err ? 'error' : 'ok');
  if (S.res) sAdd('ds_qhist', { sql: S.sql, rows: S.res.total, ms: S.res.ms, by: me().name }).then(() => ds_reload('ds_qhist')).then(() => { if (el.isConnected) ds_qRender(el); }).catch(() => {});
  ds_qRender(el);
}
async function ds_qAsk(el, q) {
  const S = ds_S.q;
  q = String(q || '').trim();
  if (!q) { toast('Type a question first.'); return; }
  if (!gate('ask', 'ask the Data Scientist agent')) return;
  S.q = q; S.ask = { q, busy: true }; ds_qRender(el);
  const rr = ds_rule(q); let res = null, rerr = null;
  if (rr) { try { res = ds_exec(rr.sql); } catch (e) { rerr = e.message; } }
  const fallback = rr && res ? rr.say(res.rows) : 'No rule covers that question yet. Try an example question, or write the SQL on the left. The rules cover goals, shots and xG, progressive passes, passes, ball wins high up, ball territory and results.';
  const run = await askAgent({ agent: 'Data Scientist', q, ctx: ds_agentCtx(q), tools: ds_agentTools(), rules: () => fallback });
  if (!el.isConnected) return;
  S.ask = { q, run, sql: rr && res ? rr.sql : null, res: rr && res ? res : null, err: rerr };
  ds_qRender(el);
}
function ds_qRender(el) {
  const S = ds_S.q, TB = ds_T();
  if (!S.sql) S.sql = ds_EX[0].sql;
  if (!S.res && !S.err && !S.auto) {
    // first open: run the first example so the page shows a result, not an empty card
    S.auto = true; S.ran = S.sql;
    try { S.res = ds_exec(S.sql); } catch (e) { S.err = e.message; }
  }
  const hist = ds_list('ds_qhist', el, () => ds_qRender(el));
  const exOpts = '<option value="">Saved examples…</option>' + ds_EX.map((e) => '<option value="' + e.id + '">' + esc(e.name) + '</option>').join('');
  const kp = '<div class="kpis">' + kpi('Matches', fmt(D.matches.length), esc(D.league ? D.league.competition : '')) + kpi('Events', fmt(TB.events.length), 'Event rows, all matches') + kpi('Passes', fmt(TB.passes.length), 'Pass events') + kpi('Shots', fmt(TB.shots.length), 'Shot events') + '</div>';
  const sqlBody = '<div class="filters" style="margin-bottom:10px">' + ds_fld('Saved example', '<select id="ds-ex">' + exOpts + '</select>') + '<button class="btn pri" id="ds-run">Run query</button></div>' +
    '<textarea id="ds-sql" class="ds-sql" spellcheck="false" aria-label="SQL">' + esc(S.sql) + '</textarea>' +
    '<p class="ds-src">Runs in your browser. Production: Microsoft Fabric Lakehouse SQL endpoint. Ctrl+Enter runs the query.</p>' +
    '<div style="margin-top:12px">' + ds_qResBody(S) + '</div>';
  const csvBtn = '<button class="btn" id="ds-csv"' + (S.res && S.res.rows.length ? '' : ' disabled') + '>Export CSV' + lockBtn('export') + '</button>';
  const tabBody = Object.keys(ds_SCHEMA).map((t) => '<div class="ds-li"><div><div class="t ds-mono">' + t + '</div><div class="s">' + ds_SCHEMA[t].map((c) => c.n).join(', ') + '</div></div><div class="acts">' + chip(fmt(TB[t].length) + ' rows', '') + '</div></div>').join('');
  const askBody = '<div class="filters" style="margin-bottom:6px">' + ds_fld('Question', '<input id="ds-q" class="inp" value="' + esc(S.q) + '" placeholder="e.g. Who has the most xG?" maxlength="200">') + '<button class="btn pri" id="ds-ask">Ask' + lockBtn('ask') + '</button></div>' +
    '<div class="ds-chips">' + ds_QSUG.map((s) => '<button class="btn sm" data-ds-sug="' + esc(s) + '">' + esc(s) + '</button>').join('') + '</div>' +
    '<div id="ds-askout">' + ds_askBody(S) + '</div>';
  const histBody = hist.length ? hist.slice(0, 8).map((h, i) => '<div class="ds-li"><div><div class="t ds-mono">' + esc(ds_short(h.sql, 80)) + '</div><div class="s">' + fmt(h.rows || 0) + ' rows · ' + esc(h.by || '') + ' · ' + esc(ds_when(h.at)) + '</div></div><div class="acts"><button class="btn sm" data-ds-act="load" data-ds-i="' + i + '">Load</button></div></div>').join('') : (ds_S.cache.ds_qhist ? '<div class="empty">Queries you run appear here.</div>' : '<div class="empty">Loading history…</div>');
  el.innerHTML = pgHead('Query workbench', 'Numbers come from the season feed in this browser: ' + D.matches.length + ' matches, built into six tables when the console opens. Results and CSV exports come from these tables.', chip('Runs in your browser', 'info')) + kp +
    '<div class="grid"><div class="s8">' + ds_try('SQL', 'Select, filter, group, sort and join. Only SELECT runs here, so the tables cannot be changed.', () => sqlBody, csvBtn) + '</div>' +
    '<div class="s4">' + ds_try('Tables', 'Built from the season feed. Row counts are live.', () => tabBody) + '</div>' +
    '<div class="s6">' + ds_try('Ask in plain English', 'Claude writes the SQL when it is granted. Otherwise rules map common questions to queries, and the SQL is shown.', () => askBody) + '</div>' +
    '<div class="s6">' + ds_try('Query history', 'Saved in this browser’s store. Load a query to run it again.', () => histBody) + '</div></div>';
  const ta = el.querySelector('#ds-sql');
  ta.oninput = () => { S.sql = ta.value; };
  ta.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); ds_qRun(el); } };
  el.querySelector('#ds-run').onclick = () => ds_qRun(el);
  el.querySelector('#ds-ex').onchange = (e) => { const ex = ds_EX.find((x) => x.id === e.target.value); if (ex) { S.sql = ex.sql; ds_qRun(el); } };
  const csv = el.querySelector('#ds-csv');
  if (csv && !csv.disabled) csv.onclick = () => { if (S.res) exportFile('ds-query-result.csv', toCSV(S.res.rows), 'text/csv', 'Query result, ' + fmt(S.res.rows.length) + ' rows'); };
  bindTbl(el, 'ds-rt', S.qsort, () => ds_qRender(el));
  el.querySelectorAll('[data-ds-act="load"]').forEach((b) => { b.onclick = () => { const h = hist[+b.dataset.dsI]; if (h) { S.sql = h.sql; ds_qRun(el); } }; });
  el.querySelectorAll('[data-ds-sug]').forEach((b) => { b.onclick = () => ds_qAsk(el, b.dataset.dsSug); });
  const qi = el.querySelector('#ds-q');
  qi.oninput = () => { S.q = qi.value; };
  qi.onkeydown = (e) => { if (e.key === 'Enter') ds_qAsk(el, qi.value); };
  el.querySelector('#ds-ask').onclick = () => ds_qAsk(el, qi.value);
}

// ---------------------------------------------------------------- chart building (shared by the builder and dashboards)
function ds_label(r) { return r.name || r.player || r.match_id || r.team || ''; }
function ds_topKeys(list, col, n) {
  const c = new Map();
  for (const r of list) { const k = ds_keyStr(r[col]); c.set(k, (c.get(k) || 0) + 1); }
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0]);
}
function ds_serCol(col, key, keys) {
  if (!col) return ds_PAL[0];
  if (col === 'team') return ccol(key);
  const i = keys.indexOf(key);
  return i < 0 ? '#8A948F' : ds_PAL[i % ds_PAL.length];
}
function ds_legendOf(col, keys) { return keys.length ? legend(keys.map((k) => [col === 'team' ? clubName(k) : k, ds_serCol(col, k, keys)])) : ''; }
// one chart from a spec {table, x, y, agg, colour, type, fCol, fVal}. Returns html; throws a readable error when the spec cannot be drawn
function ds_build(sp) {
  const TB = ds_T(), base = TB[sp.table];
  if (!base) throw new Error('Pick a source table.');
  const tcol = (c) => ds_colT(sp.table, c);
  let rows = base;
  if (sp.fCol && sp.fVal !== '' && sp.fVal != null) rows = rows.filter((r) => ds_keyStr(r[sp.fCol]) === String(sp.fVal));
  const useY = !!sp.y && sp.agg !== 'count' && tcol(sp.y) === 'n';
  const agg = useY ? sp.agg : 'count';
  const meas = (list) => {
    if (agg === 'count') return list.length;
    let s = 0, n = 0;
    for (const r of list) { const v = r[sp.y]; if (v != null) { s += +v; n++; } }
    return n ? (agg === 'avg' ? s / n : s) : 0;
  };
  const mLabel = agg === 'count' ? 'rows' : (agg === 'avg' ? 'average ' : 'sum of ') + sp.y;
  const note = '<div class="ds-note">' + esc(fmt(rows.length) + ' rows from ' + sp.table + (sp.fCol && sp.fVal !== '' ? ', where ' + sp.fCol + ' = ' + sp.fVal : '') + '. Measure: ' + mLabel + '.') + '</div>';
  if (sp.type === 'heat') {
    if (!ds_colT(sp.table, 'x') || !ds_colT(sp.table, 'y')) throw new Error('Pitch heat needs x and y positions. Use events, passes or shots.');
    const NX = 15, NY = 10, cw = 105 / NX, chh = 68 / NY;
    const cells = new Array(NX * NY).fill(null).map(() => []);
    for (const r of rows) {
      if (r.x == null || r.y == null) continue;
      const i = clamp(Math.floor(r.x / cw), 0, NX - 1), j = clamp(Math.floor(r.y / chh), 0, NY - 1);
      cells[j * NX + i].push(r);
    }
    const vals = cells.map((c) => (c.length ? meas(c) : 0));
    const mx = Math.max(...vals, 1e-9);
    let inner = '';
    vals.forEach((v, k) => {
      if (!v) return;
      const i = k % NX, j = Math.floor(k / NX);
      inner += '<rect x="' + (i * cw).toFixed(2) + '" y="' + (j * chh).toFixed(2) + '" width="' + cw.toFixed(2) + '" height="' + chh.toFixed(2) + '" style="fill:var(--accent);fill-opacity:' + (0.12 + (0.88 * v) / mx).toFixed(2) + '"><title>' + esc(fmt(v, 2) + ' ' + mLabel) + '</title></rect>';
    });
    return note + pitch(inner, { title: 'Pitch heat, ' + mLabel }) + '<div class="legend"><span><i style="background:var(--accent);opacity:.2"></i>Less</span><span><i style="background:var(--accent)"></i>More ' + esc(mLabel) + '</span><span>Attacks to the right. Team events are normalised to the acting side.</span></div>';
  }
  if (sp.type === 'scatter') {
    if (tcol(sp.x) !== 'n' || !sp.y || tcol(sp.y) !== 'n') throw new Error('Scatter needs a numeric X and a numeric Y. Pick them, or choose another chart type.');
    const pts0 = rows.filter((r) => r[sp.x] != null && r[sp.y] != null);
    const pts = pts0.slice(0, 1500);
    const keys = sp.colour ? ds_topKeys(pts, sp.colour, 8) : [];
    const pl = pts.map((r) => {
      const colr = sp.colour ? ds_serCol(sp.colour, ds_keyStr(r[sp.colour]), keys) : ds_PAL[0];
      return { x: +r[sp.x], y: +r[sp.y], color: colr, r: 4, title: ds_label(r) + ' · ' + sp.x + ' ' + fmt(r[sp.x], 2) + ' · ' + sp.y + ' ' + fmt(r[sp.y], 2) };
    });
    return note + scatter({ pts: pl, w: 640, h: 300, xLabel: sp.x, yLabel: sp.y }) + ds_legendOf(sp.colour, keys) + (pts0.length > pts.length ? '<p class="ds-note">Showing the first 1,500 of ' + fmt(pts0.length) + ' points.</p>' : '');
  }
  // bar and line: group by X (binned when X is numeric with many values), split by colour
  if (!sp.x || !tcol(sp.x)) throw new Error('Pick an X field.');
  const xNum = tcol(sp.x) === 'n';
  let bins = null;
  if (xNum) {
    const vs = rows.map((r) => r[sp.x]).filter((v) => v != null);
    if (new Set(vs).size > 20 && vs.length) {
      let lo = Infinity, hi = -Infinity;
      for (const v of vs) { if (v < lo) lo = v; if (v > hi) hi = v; }
      const w = (hi - lo) / 10 || 1;
      bins = { lo, w, labels: [] };
      for (let b = 0; b < 10; b++) bins.labels.push(fmt(lo + b * w, 1) + '–' + fmt(lo + (b + 1) * w, 1));
    }
  }
  const keyOf = (r) => {
    const v = r[sp.x];
    if (v == null) return null;
    if (bins) return Math.min(9, Math.max(0, Math.floor((v - bins.lo) / bins.w)));
    return v;
  };
  const sers = sp.colour ? ds_topKeys(rows, sp.colour, 8) : [''];
  const cells = new Map();
  for (const r of rows) {
    const k = keyOf(r); if (k == null) continue;
    const s = sp.colour ? ds_keyStr(r[sp.colour]) : '';
    if (!sers.includes(s)) continue;
    let m = cells.get(k); if (!m) cells.set(k, (m = new Map()));
    let a = m.get(s); if (!a) m.set(s, (a = []));
    a.push(r);
  }
  const totals = (k) => { let t = 0; for (const a of cells.get(k).values()) t += meas(a); return t; };
  let xKeys = [...cells.keys()];
  if (xNum) xKeys.sort((a, b) => a - b);
  else { xKeys.sort((a, b) => totals(b) - totals(a)); xKeys = xKeys.slice(0, 24); }
  const labelOf = (k) => (bins ? bins.labels[k] : xNum ? fmt(k, Number.isInteger(k) ? 0 : 2) : ds_keyStr(k));
  const serLabel = (s) => (sp.colour === 'team' ? clubName(s) : s);
  const colOf = (s) => ds_serCol(sp.colour, s, sers);
  const legendHtml = sp.colour ? legend(sers.map((s) => [serLabel(s), colOf(s)])) : '';
  if (sp.type === 'line') {
    const xp = xNum ? (k) => k : (k) => xKeys.indexOf(k);
    const xMin = xNum ? Math.min(...xKeys) : 0, xMax = xNum ? Math.max(...xKeys) : Math.max(0, xKeys.length - 1);
    const series = sers.map((s) => ({ name: serLabel(s), color: colOf(s), pts: xKeys.map((k) => { const a = cells.get(k).get(s); return a ? [xp(k), meas(a)] : null; }).filter(Boolean) }));
    const step = Math.ceil(xKeys.length / 6) || 1;
    const ticks = xKeys.map((k) => xp(k)).filter((_, i) => i % step === 0);
    const xFmt = bins ? (v) => bins.labels[Math.round(v)] || '' : xNum ? (v) => fmt(v, Number.isInteger(v) ? 0 : 1) : (v) => labelOf(xKeys[Math.round(v)]) || '';
    return note + lineChart({ series, w: 640, h: 240, xMin, xMax, xTicks: ticks, xFmt }) + legendHtml;
  }
  const groups = xKeys.map((k) => ({
    label: labelOf(k),
    vals: sers.map((s) => { const a = cells.get(k).get(s) || []; const v = a.length ? meas(a) : 0; return { v, color: colOf(s), title: labelOf(k) + (sp.colour ? ' · ' + serLabel(s) : '') + ': ' + fmt(v, 2) }; }),
  }));
  return note + barChart({ groups, w: 640, h: 260 }) + legendHtml;
}
function ds_safeBuild(sp) {
  try { return ds_build(sp); } catch (e) { return '<div class="ds-err">' + esc(e.message) + '</div>'; }
}
function ds_specOf(S) { return { table: S.table, x: S.x, y: S.y, agg: S.agg, colour: S.colour, type: S.type, fCol: S.fCol, fVal: S.fVal, name: S.name }; }
function ds_specDesc(sp) {
  const m = !sp.y || sp.agg === 'count' ? 'Rows' : (sp.agg === 'avg' ? 'Average' : 'Sum') + ' of ' + sp.y;
  return m + ' by ' + (sp.x || '–') + (sp.colour ? ', coloured by ' + sp.colour : '') + (sp.fCol && sp.fVal !== '' ? ', filtered ' + sp.fCol + ' = ' + sp.fVal : '');
}
const ds_PICK = ['table', 'x', 'y', 'agg', 'colour', 'type', 'fCol', 'fVal', 'name'];
function ds_pick(o) { const r = {}; ds_PICK.forEach((k) => { r[k] = o[k] == null ? '' : o[k]; }); return r; }

// ---------------------------------------------------------------- Chart builder
function ds_cbPrev(el) {
  const box = el.querySelector('#ds-cb-prev');
  if (box) box.innerHTML = ds_safeBuild(ds_specOf(ds_S.cb));
}
function ds_cbRender(el, focus) {
  const S = ds_S.cb, TB = ds_T();
  const cols = ds_SCHEMA[S.table] || [];
  const numC = cols.filter((c) => c.t === 'n'), strC = cols.filter((c) => c.t === 's');
  const opt = (v, l, cur) => '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(l) + '</option>';
  const tOpts = Object.keys(ds_SCHEMA).map((t) => opt(t, t + ' (' + fmt(TB[t].length) + ' rows)', S.table)).join('');
  const xOpts = cols.map((c) => opt(c.n, c.n + (c.t === 'n' ? ' · number' : ' · text'), S.x)).join('');
  const yOpts = opt('', 'Rows (count)', S.y) + numC.map((c) => opt(c.n, c.n, S.y)).join('');
  const cOpts = opt('', 'None', S.colour) + strC.map((c) => opt(c.n, c.n, S.colour)).join('');
  const fOpts = opt('', 'No filter', S.fCol) + cols.map((c) => opt(c.n, c.n, S.fCol)).join('');
  const ctrl = '<div class="filters">' + ds_fld('Source table', '<select id="ds-cb-t">' + tOpts + '</select>') + ds_fld('X: group or position', '<select id="ds-cb-x">' + xOpts + '</select>') + ds_fld('Y: measure', '<select id="ds-cb-y">' + yOpts + '</select>') + ds_fld('Colour: series', '<select id="ds-cb-c">' + cOpts + '</select>') + ds_fld('Filter field', '<select id="ds-cb-f">' + fOpts + '</select>') + ds_fld('Filter value', '<input id="ds-cb-fv" class="inp" value="' + esc(S.fVal) + '" placeholder="e.g. HAR" maxlength="60">') + '</div>' +
    '<div class="filters"><div class="field"><span>Measure</span>' + seg('ds-cb-agg', [['count', 'Count'], ['sum', 'Sum'], ['avg', 'Average']], S.agg) + '</div><div class="field"><span>Chart type</span>' + seg('ds-cb-type', [['bar', 'Bar'], ['line', 'Line'], ['scatter', 'Scatter'], ['heat', 'Pitch heat']], S.type) + '</div>' + ds_fld('Chart name', '<input id="ds-cb-name" class="inp" value="' + esc(S.name) + '" maxlength="60" placeholder="Name this chart">') + '</div>' +
    '<div class="ds-chips" style="margin-top:4px">' + ds_CB_EX.map((x, i) => '<button class="btn sm" data-ds-act="ex" data-ds-i="' + i + '">' + esc(x.name) + '</button>').join('') + '</div>';
  const saved = ds_list('ds_charts', el, () => ds_cbRender(el));
  const savedBody = saved.length ? saved.map((c, i) => '<div class="ds-li"><div><div class="t">' + esc(c.name || 'Untitled') + '</div><div class="s">' + esc(c.type) + ' · ' + esc(ds_specDesc(c)) + '</div></div><div class="acts"><button class="btn sm" data-ds-act="open" data-ds-i="' + i + '">Open</button> <button class="btn sm danger" data-ds-act="del" data-ds-i="' + i + '">Delete' + lockBtn('author') + '</button></div></div>').join('') : (ds_S.cache.ds_charts ? '<div class="empty">No saved charts yet. Build one, then save it.</div>' : '<div class="empty">Loading saved charts…</div>');
  el.innerHTML = pgHead('Chart builder', 'Source: the in-browser season tables (see Query workbench). Saved charts go to the dashboards store for this browser. Production: Power BI embed.', '<button class="btn pri" id="ds-cb-save">Save chart' + lockBtn('author') + '</button>') +
    '<div class="grid"><div class="s12">' + ds_try('Build a chart', 'Pick the source, the fields and the chart type. Heat maps need x and y positions (events, passes or shots).', () => ctrl) + '</div>' +
    '<div class="s8">' + ds_try(S.name ? esc(S.name) : 'Preview', ds_specDesc(ds_specOf(S)), () => '<div id="ds-cb-prev"></div>') + '</div>' +
    '<div class="s4">' + ds_try('Saved charts', 'Open one to edit it here, or delete it.', () => savedBody) + '</div></div>';
  ds_cbPrev(el);
  const bindSel = (id, fn) => { const n = el.querySelector('#' + id); if (n) n.onchange = () => { fn(n.value); ds_cbRender(el, id); }; };
  bindSel('ds-cb-t', (v) => Object.assign(S, { table: v, x: ds_SCHEMA[v][0].n, y: '', colour: '', fCol: '', fVal: '', agg: 'count' }));
  bindSel('ds-cb-x', (v) => { S.x = v; });
  bindSel('ds-cb-y', (v) => { S.y = v; if (!v) S.agg = 'count'; });
  bindSel('ds-cb-c', (v) => { S.colour = v; });
  bindSel('ds-cb-f', (v) => { S.fCol = v; });
  const fv = el.querySelector('#ds-cb-fv');
  fv.oninput = () => { S.fVal = fv.value; ds_cbPrev(el); };
  const nm = el.querySelector('#ds-cb-name');
  nm.oninput = () => { S.name = nm.value; };
  bindSeg(el, 'ds-cb-agg', (v) => { S.agg = v; ds_segPress(el, 'ds-cb-agg', v); ds_cbPrev(el); });
  bindSeg(el, 'ds-cb-type', (v) => { S.type = v; ds_segPress(el, 'ds-cb-type', v); ds_cbPrev(el); });
  el.querySelectorAll('[data-ds-act]').forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.dsI, a = b.dataset.dsAct;
      if (a === 'ex') { Object.assign(S, { agg: 'count', colour: '', fCol: '', fVal: '' }, ds_CB_EX[i].spec, { name: ds_CB_EX[i].name }); ds_cbRender(el); }
      if (a === 'open') { const c = saved[i]; if (c) { Object.assign(S, ds_pick(c)); ds_cbRender(el); } }
      if (a === 'del') ds_cbDelete(el, saved[i]);
    };
  });
  el.querySelector('#ds-cb-save').onclick = () => ds_cbSave(el);
  ds_refocus(el, focus);
}
async function ds_cbSave(el) {
  const S = ds_S.cb;
  if (!gate('author', 'save a chart')) return;
  const spec = ds_specOf(S);
  spec.name = (S.name || '').trim() || (spec.table + ' by ' + spec.x);
  try { ds_build(spec); } catch (e) { toast('This chart can’t be drawn yet: ' + e.message); return; }
  await sAdd('ds_charts', Object.assign({}, ds_pick(spec), { by: me().name, role: ROLE }));
  audit('ds.chart.save', spec.name, spec.type + ' · ' + spec.table + ' · ' + ds_specDesc(spec));
  await ds_reload('ds_charts');
  toast('Saved “' + spec.name + '” to dashboards.');
  ds_cbRender(el);
}
async function ds_cbDelete(el, c) {
  if (!c || !gate('author', 'delete a chart')) return;
  await sDel('ds_charts', c.id);
  audit('ds.chart.delete', c.name || 'chart', c.type + ' · ' + c.table);
  await ds_reload('ds_charts');
  toast('Deleted “' + (c.name || 'chart') + '”.');
  ds_cbRender(el);
}

// ---------------------------------------------------------------- Dashboards
function ds_bdReset() { Object.assign(ds_S.bd, { id: null, name: 'Untitled board', items: [] }); }
function ds_bdAct(el, a, i, charts, boards) {
  const B = ds_S.bd, n = B.items.length;
  if (a === 'add') { const c = charts[i]; if (c) B.items.push(ds_pick(c)); }
  if (a === 'up' && i > 0) { const t = B.items[i]; B.items[i] = B.items[i - 1]; B.items[i - 1] = t; }
  if (a === 'dn' && i < n - 1) { const t = B.items[i]; B.items[i] = B.items[i + 1]; B.items[i + 1] = t; }
  if (a === 'rm') B.items.splice(i, 1);
  if (a === 'open') { const b = boards[i]; if (b) Object.assign(B, { id: b.id, name: b.name, items: JSON.parse(JSON.stringify(b.items || [])) }); }
  if (a === 'new') ds_bdReset();
  ds_bdRender(el);
}
async function ds_bdSave(el) {
  const B = ds_S.bd;
  if (!gate('author', 'save a board')) return;
  if (!B.items.length) { toast('Add at least one chart before saving.'); return; }
  const obj = { name: (B.name || '').trim() || 'Untitled board', items: JSON.parse(JSON.stringify(B.items)), charts: B.items.length, by: me().name, role: ROLE, at: new Date().toISOString() };
  B.name = obj.name;
  if (B.id) await sSet('ds_boards', B.id, obj);
  else { const r = await sAdd('ds_boards', obj); B.id = r.id; }
  audit('ds.board.save', obj.name, obj.charts + ' charts');
  await ds_reload('ds_boards');
  toast('Saved board “' + obj.name + '”.');
  ds_bdRender(el);
}
function ds_bdShare() {
  const B = ds_S.bd;
  if (!B.items.length) { toast('Add charts to the board before sharing.'); return; }
  const doc = { board: B.name, exportedAt: new Date().toISOString(), exportedBy: me().name, source: 'Season feed loaded in this browser: ' + D.matches.length + ' matches', note: 'Chart specifications only. MatchCast rebuilds each chart from the season tables when the file is opened.', charts: B.items };
  const slug = (B.name || 'board').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'board';
  exportFile(slug + '.json', JSON.stringify(doc, null, 2), 'application/json', 'Board “' + (B.name || 'board') + '” (JSON)');
}
function ds_bdSchedule(el) {
  const B = ds_S.bd;
  if (!gate('author', 'set a scheduled report')) return;
  const f = ds_SCHED.find((x) => x[0] === B.schedF) || ds_SCHED[0];
  B.sched = { freq: f[1], to: (B.schedTo || '').trim() || 'Performance analysis channel' };
  audit('ds.schedule', B.name, f[1] + ' → ' + B.sched.to + ' · simulated, not sent');
  toast('Simulated in demo. Nothing was sent. Production: Fabric scheduled refresh and Teams delivery.');
  ds_bdRender(el);
}
function ds_bdRender(el) {
  const B = ds_S.bd; ds_T();
  const charts = ds_list('ds_charts', el, () => ds_bdRender(el));
  const boards = ds_list('ds_boards', el, () => ds_bdRender(el));
  const n = B.items.length;
  const addBody = ds_S.cache.ds_charts
    ? (charts.length ? charts.map((c, i) => '<div class="ds-li"><div><div class="t">' + esc(c.name || 'Untitled') + '</div><div class="s">' + esc(c.type) + ' · ' + esc(ds_specDesc(c)) + '</div></div><div class="acts"><button class="btn sm" data-ds-act="add" data-ds-i="' + i + '">Add</button></div></div>').join('') : '<div class="empty">No saved charts yet. Save one in the Chart builder.</div>')
    : '<div class="empty">Loading saved charts…</div>';
  const boardList = ds_S.cache.ds_boards
    ? (boards.length ? boards.map((b, i) => '<div class="ds-li"><div><div class="t">' + esc(b.name) + '</div><div class="s">' + (b.items || []).length + ' charts · ' + esc(b.by || '') + ' · ' + esc(ds_when(b.at)) + '</div></div><div class="acts"><button class="btn sm" data-ds-act="open" data-ds-i="' + i + '">Open</button></div></div>').join('') : '<div class="empty">No saved boards yet.</div>')
    : '<div class="empty">Loading saved boards…</div>';
  const tiles = n
    ? '<div class="ds-tiles">' + B.items.map((sp, i) => '<div class="ds-tile"><div class="ds-tile-h"><b title="' + esc(sp.name) + '">' + esc(sp.name || 'Chart') + '</b><div class="acts"><button class="btn sm" data-ds-act="up" data-ds-i="' + i + '"' + (i ? '' : ' disabled') + ' aria-label="Move up">↑</button> <button class="btn sm" data-ds-act="dn" data-ds-i="' + i + '"' + (i < n - 1 ? '' : ' disabled') + ' aria-label="Move down">↓</button> <button class="btn sm danger" data-ds-act="rm" data-ds-i="' + i + '">Remove</button></div></div>' + ds_safeBuild(sp) + '</div>').join('') + '</div>'
    : '<div class="empty">This board is empty. Add saved charts from the list.</div>';
  const boardBody = '<div class="filters" style="margin-bottom:10px"><label class="field" style="flex:1 1 240px"><span>Board name</span><input id="ds-bd-name" class="inp" value="' + esc(B.name) + '" maxlength="80"></label></div>' + tiles;
  const sched = '<div class="ds-sim">Simulated in demo. Production: Fabric scheduled refresh and Teams delivery.</div>' +
    '<div class="filters"><label class="field"><span>Frequency</span><select id="ds-sc-f">' + ds_SCHED.map((f) => '<option value="' + f[0] + '"' + (f[0] === B.schedF ? ' selected' : '') + '>' + esc(f[1]) + '</option>').join('') + '</select></label>' +
    '<label class="field" style="flex:1 1 200px"><span>Deliver to</span><input id="ds-sc-to" class="inp" value="' + esc(B.schedTo) + '" maxlength="80"></label></div>' +
    '<div class="filters" style="margin-bottom:6px"><button class="btn" id="ds-sc-go">Set schedule' + lockBtn('author') + '</button></div>' +
    (B.sched ? '<p class="ds-note">' + chip('Simulated', 'warn') + ' ' + esc(B.sched.freq) + ' to ' + esc(B.sched.to) + '. Nothing was sent.</p>' : '<p class="ds-note">No schedule set for this board.</p>');
  el.innerHTML = pgHead('Dashboards', 'Charts are rebuilt from the season tables on each view. Boards are saved to this browser’s store and shared as JSON files. Scheduled delivery is simulated.',
    '<button class="btn" id="ds-bd-new">New board</button> <button class="btn" id="ds-bd-share"' + (n ? '' : ' disabled') + '>Share as JSON' + lockBtn('export') + '</button> <button class="btn pri" id="ds-bd-save">Save board' + lockBtn('author') + '</button>') +
    '<div class="grid"><div class="s8">' + ds_try('Board', 'Top to bottom is the order in the shared file.', () => boardBody) + '</div>' +
    '<div class="s4">' + ds_try('Saved charts', 'Add a chart to the board.', () => addBody) + '</div>' +
    '<div class="s6">' + ds_try('Scheduled report', 'Simulated in demo', () => sched) + '</div>' +
    '<div class="s6">' + ds_try('Saved boards', 'Open a board to edit it.', () => boardList) + '</div></div>';
  const nm = el.querySelector('#ds-bd-name');
  nm.oninput = () => { B.name = nm.value; };
  el.querySelectorAll('[data-ds-act]').forEach((b) => { b.onclick = () => ds_bdAct(el, b.dataset.dsAct, +b.dataset.dsI, charts, boards); });
  el.querySelector('#ds-bd-new').onclick = () => ds_bdAct(el, 'new', 0, charts, boards);
  el.querySelector('#ds-bd-save').onclick = () => ds_bdSave(el);
  const sh = el.querySelector('#ds-bd-share'); if (sh && !sh.disabled) sh.onclick = () => ds_bdShare();
  el.querySelector('#ds-sc-f').onchange = (e) => { B.schedF = e.target.value; };
  el.querySelector('#ds-sc-to').oninput = (e) => { B.schedTo = e.target.value; };
  el.querySelector('#ds-sc-go').onclick = () => ds_bdSchedule(el);
}

// ---------------------------------------------------------------- Custom metrics
// formula parser: numbers, field names, + - * / and brackets. Errors name the problem and where it is.
function ds_fxParse(src) {
  const s = String(src || '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').trim();
  if (!s) throw new Error('Write a formula, for example prog / mins * 90.');
  const T = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const t = s.slice(i, j);
      if (!/^\d+(\.\d+)?$/.test(t)) throw new Error('“' + t + '” is not a number (position ' + (i + 1) + ').');
      T.push({ t: 'n', v: +t, p: i }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      T.push({ t: 'f', v: s.slice(i, j), p: i }); i = j; continue;
    }
    if ('+-*/()'.includes(c)) { T.push({ t: 'op', v: c, p: i }); i++; continue; }
    throw new Error('“' + c + '” is not allowed in a formula (position ' + (i + 1) + '). Use field names, numbers, + − × ÷ and brackets.');
  }
  let k = 0;
  const used = new Set();
  const at = () => T[k];
  const endDesc = () => (k >= T.length ? 'the end of the formula' : '“' + T[k].v + '” at position ' + (T[k].p + 1));
  const expr = () => { let a = term(); while (at() && at().t === 'op' && (at().v === '+' || at().v === '-')) { const op = T[k++].v; a = { t: 'b', op, a, b: term() }; } return a; };
  const term = () => { let a = factor(); while (at() && at().t === 'op' && (at().v === '*' || at().v === '/')) { const op = T[k++].v; a = { t: 'b', op, a, b: factor() }; } return a; };
  const factor = () => {
    const t = at();
    if (!t) throw new Error('The formula ends early. Add a field or a number after the last operator.');
    if (t.t === 'n') { k++; return { t: 'num', v: t.v }; }
    if (t.t === 'f') {
      if (!ds_MF.some((x) => x[0] === t.v)) throw new Error('Unknown field “' + t.v + '” at position ' + (t.p + 1) + '. Fields: ' + ds_MF.map((x) => x[0]).join(', ') + '.');
      k++; used.add(t.v); return { t: 'f', v: t.v };
    }
    if (t.t === 'op' && t.v === '(') {
      k++;
      const e = expr();
      const c = at();
      if (!c || c.v !== ')') throw new Error('Missing “)” for the bracket at position ' + (t.p + 1) + '.');
      k++; return e;
    }
    if (t.t === 'op' && t.v === '-') throw new Error('A formula can’t start with a minus sign, or put one in front of a bracket. Write 0 - value instead.');
    throw new Error('Expected a field or a number at ' + endDesc() + '.');
  };
  const ast = expr();
  if (k < T.length) {
    if (T[k].v === ')') throw new Error('Unexpected “)” at position ' + (T[k].p + 1) + '. Check the brackets.');
    throw new Error('Unexpected ' + endDesc() + '. Put + − × ÷ between values.');
  }
  return { ast, fields: [...used], src: s };
}
function ds_fxEval(n, p) {
  if (n.t === 'num') return n.v;
  if (n.t === 'f') return +p[n.v] || 0;
  const a = ds_fxEval(n.a, p), b = ds_fxEval(n.b, p);
  if (a == null || b == null) return null;
  if (n.op === '+') return a + b;
  if (n.op === '-') return a - b;
  if (n.op === '*') return a * b;
  return b === 0 ? null : a / b;
}
function ds_fxWords(n) {
  if (n.t === 'num') return String(n.v);
  if (n.t === 'f') return (ds_MF.find((x) => x[0] === n.v) || [n.v, n.v])[1].toLowerCase();
  const op = { '+': 'plus', '-': 'minus', '*': 'times', '/': 'divided by' }[n.op];
  return '(' + ds_fxWords(n.a) + ' ' + op + ' ' + ds_fxWords(n.b) + ')';
}
// words for the whole formula, without the outer brackets
function ds_fxSentence(ast) { const w = ds_fxWords(ast); return ast.t === 'b' ? w.slice(1, -1) : w; }
function ds_fxSymbols(s) { return s.replace(/\*/g, ' × ').replace(/\//g, ' ÷ ').replace(/\+/g, ' + ').replace(/ - /g, ' − ').replace(/\s+/g, ' ').trim(); }
function ds_mxRank(p, grp, minApps) {
  return ds_T().players
    .filter((x) => x.apps >= minApps && x.mins > 0 && (!grp || x.grp === grp))
    .map((x) => ({ name: x.name, team: x.team, pos: x.pos, apps: x.apps, v: ds_fxEval(p.ast, x) }))
    .sort((a, b) => { if (a.v == null || b.v == null) return (a.v == null) - (b.v == null); return b.v - a.v; })
    .map((r, i) => Object.assign(r, { rank: i + 1 }));
}
function ds_mxRender(el, focus) {
  const S = ds_S.mx;
  let parsed = null, perr = null;
  try { parsed = ds_fxParse(S.f); } catch (e) { perr = e.message; }
  const saved = ds_list('ds_metrics', el, () => ds_mxRender(el));
  const defBody = () => {
    if (!parsed) return '<div class="ds-note">Fix the formula to see what it means. ' + esc(perr || '') + '</div>';
    return '<div class="ds-fx">' + esc(ds_fxSymbols(parsed.src)) + '</div>' +
      '<p class="ds-note">Reads as: ' + esc(ds_fxSentence(parsed.ast)) + '.</p>' +
      '<p class="ds-note">Players with at least one minute. Fields used:</p>' +
      '<dl class="ds-kv">' + parsed.fields.map((k) => { const f = ds_MF.find((x) => x[0] === k); return '<dt>' + esc(k) + '</dt><dd>' + esc(f[1] + '. ' + f[2]) + '</dd>'; }).join('') + '</dl>';
  };
  const rankBody = () => {
    if (!parsed) return '<div class="ds-note">Fix the formula to rank players. ' + esc(perr || '') + '</div>';
    const rows = ds_mxRank(parsed, S.grp, S.minApps);
    const mx = Math.max(...rows.slice(0, 25).map((r) => Math.abs(r.v || 0)), 1e-9);
    const cols = [
      { k: 'rank', l: '#', r: true, f: (r) => r.rank },
      { k: 'name', l: 'Player', f: (r) => esc(r.name) },
      { k: 'team', l: 'Club', f: (r) => clubTag(r.team) },
      { k: 'pos', l: 'Pos', f: (r) => esc(r.pos) },
      { k: 'apps', l: 'Matches', r: true, f: (r) => fmt(r.apps) },
      { k: 'v', l: esc(S.name || 'Metric'), r: true, f: (r) => '<div class="ds-cell-bar"><span class="num">' + (r.v == null ? '–' : fmt(r.v, 2)) + '</span><div class="bar"><i style="width:' + (r.v == null ? 0 : (100 * Math.max(0, r.v) / mx)).toFixed(1) + '%"></i></div></div>' },
    ];
    return '<div class="filters" style="margin-bottom:10px">' + '<div class="field"><span>Position group</span>' + seg('ds-mx-grp', [['', 'All'], ['DEF', 'Defenders'], ['MID', 'Midfield'], ['ATT', 'Attack'], ['GK', 'Keepers']], S.grp) + '</div>' +
      ds_fld('Matches played', '<select id="ds-mx-min">' + [[1, '1 or more'], [3, '3 or more'], [5, '5 or more']].map(([v, l]) => '<option value="' + v + '"' + (+S.minApps === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>') + '</div>' +
      tbl(cols, rows, { id: 'ds-mx-t', limit: 25, empty: 'No players match these filters.' }) +
      '<p class="ds-note" style="margin-top:8px">Ranked by ' + esc(S.name || 'the formula') + '. ' + fmt(rows.length) + ' players qualify. Top 25 shown.</p>';
  };
  const savedBody = saved.length ? saved.map((m, i) => '<div class="ds-li"><div><div class="t">' + esc(m.name) + '</div><div class="s ds-mono">' + esc(m.formula) + '</div><div class="s">' + esc(m.by || '') + ' · ' + esc(ds_when(m.at)) + '</div></div><div class="acts"><button class="btn sm" data-ds-act="use" data-ds-i="' + i + '">Use</button> <button class="btn sm danger" data-ds-act="del" data-ds-i="' + i + '">Delete' + lockBtn('author') + '</button></div></div>').join('') : (ds_S.cache.ds_metrics ? '<div class="empty">No saved metrics yet.</div>' : '<div class="empty">Loading saved metrics…</div>');
  const defineBody = '<label class="field" style="margin-bottom:8px"><span>Metric name</span><input id="ds-mx-name" class="inp" value="' + esc(S.name) + '" maxlength="60" placeholder="e.g. Pressing intensity"></label>' +
    '<label class="field"><span>Formula</span><input id="ds-mx-f" class="inp ds-mono" value="' + esc(S.f) + '" spellcheck="false" placeholder="prog / mins * 90" maxlength="200" aria-describedby="ds-mx-msg" style="width:100%"></label>' +
    '<div class="filters" style="margin:8px 0 6px"><button class="btn" id="ds-mx-check">Check formula</button></div>' +
    '<div class="ds-note" style="margin:0 0 4px">Fields (tap to add)</div><div class="ds-fields">' + ds_MF.map((f) => '<button type="button" data-ds-fx="' + f[0] + '" title="' + esc(f[2]) + '">' + esc(f[0]) + '</button>').join('') + '</div>' +
    '<div class="ds-note" style="margin:0 0 4px">Examples</div><div class="ds-chips">' + ds_MX_EX.map((x, i) => '<button class="btn sm" data-ds-act="ex" data-ds-i="' + i + '">' + esc(x.name) + '</button>').join('') + '</div>' +
    '<div id="ds-mx-msg" role="status">' + (S.msg ? (S.ok ? '<p class="ds-ok">' + esc(S.msg) + '</p>' : '<div class="ds-err">' + esc(S.msg) + '</div>') : '') + '</div>' +
    '<div class="filters" style="margin-top:6px"><button class="btn pri" id="ds-mx-save">Save metric' + lockBtn('author') + '</button></div>';
  el.innerHTML = pgHead('Custom metrics', 'Player values come from the season feed: season totals from D.players, and three fields (prog, ftp, hw) counted from the event rows. Saved metrics go to this browser’s store.') +
    '<div class="grid"><div class="s7">' + ds_try('Define a metric', 'A formula over player fields. Use + − × ÷ and brackets. Numbers are allowed.', () => defineBody) + '</div>' +
    '<div class="s5">' + ds_try('What the formula is', 'Symbols, words and each field’s definition', defBody) + '</div>' +
    '<div class="s8">' + ds_try('Ranked players', 'Each player’s value from the formula, computed from the season feed', rankBody) + '</div>' +
    '<div class="s4">' + ds_try('Saved metrics', 'Use one to load its formula.', () => savedBody) + '</div></div>';
  const fi = el.querySelector('#ds-mx-f'), ni = el.querySelector('#ds-mx-name');
  fi.oninput = () => { S.f = fi.value; S.msg = null; };
  ni.oninput = () => { S.name = ni.value; };
  el.querySelector('#ds-mx-check').onclick = () => { S.f = fi.value; try { const p = ds_fxParse(S.f); S.ok = true; S.msg = 'Valid. Uses ' + p.fields.length + ' field' + (p.fields.length === 1 ? '' : 's') + ': ' + p.fields.join(', ') + '.'; } catch (e) { S.ok = false; S.msg = e.message; } ds_mxRender(el, 'ds-mx-f'); };
  el.querySelectorAll('[data-ds-fx]').forEach((b) => { b.onclick = () => { S.f = (S.f && !/\s$/.test(S.f) ? S.f + ' ' : S.f) + b.dataset.dsFx; ds_mxRender(el, 'ds-mx-f'); }; });
  el.querySelectorAll('[data-ds-act]').forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.dsI, a = b.dataset.dsAct;
      if (a === 'ex') { S.f = ds_MX_EX[i].f; S.name = ds_MX_EX[i].name; S.msg = null; ds_mxRender(el); }
      if (a === 'use' && saved[i]) { S.f = saved[i].formula; S.name = saved[i].name; S.msg = null; ds_mxRender(el); }
      if (a === 'del') ds_mxDelete(el, saved[i]);
    };
  });
  bindSeg(el, 'ds-mx-grp', (v) => { S.grp = v; ds_mxRender(el); });
  const mi = el.querySelector('#ds-mx-min');
  if (mi) mi.onchange = () => { S.minApps = +mi.value; ds_mxRender(el, 'ds-mx-min'); };
  el.querySelector('#ds-mx-save').onclick = () => ds_mxSave(el);
  ds_refocus(el, focus);
}
async function ds_mxSave(el) {
  const S = ds_S.mx;
  if (!gate('author', 'save a metric')) return;
  const fi = el.querySelector('#ds-mx-f'), ni = el.querySelector('#ds-mx-name');
  S.f = fi ? fi.value : S.f; S.name = ni ? ni.value : S.name;
  let p;
  try { p = ds_fxParse(S.f); } catch (e) { S.ok = false; S.msg = e.message; ds_mxRender(el, 'ds-mx-f'); return; }
  const name = (S.name || '').trim() || 'Custom metric';
  await sAdd('ds_metrics', { name, formula: p.src, entity: 'player', fields: p.fields, by: me().name, role: ROLE });
  audit('ds.metric.save', name, p.src);
  await ds_reload('ds_metrics');
  S.ok = true; S.msg = 'Saved “' + name + '”.';
  toast('Saved metric “' + name + '”.');
  ds_mxRender(el);
}
async function ds_mxDelete(el, m) {
  if (!m || !gate('author', 'delete a metric')) return;
  await sDel('ds_metrics', m.id);
  audit('ds.metric.delete', m.name || 'metric', m.formula || '');
  await ds_reload('ds_metrics');
  ds_mxRender(el);
}

// ---------------------------------------------------------------- Data connectors
function ds_cnRender(el) {
  const TB = ds_T();
  const cols = [
    { k: 'name', l: 'Source', f: (r) => '<b>' + esc(r.name) + '</b><div class="sub">' + esc(r.note) + '</div>', cls: 'wrap' },
    { k: 'kind', l: 'Kind', f: (r) => esc(r.kind), cls: 'wrap' },
    { k: 'status', l: 'Status', f: (r) => '<span class="chip ds-chipw ' + (r.status.indexOf('Live') === 0 ? 'good' : '') + '">' + esc(r.status) + '</span>', cls: 'wrap' },
    { k: 'schema', l: 'Schema', f: (r) => '<span class="ds-mono">' + esc(r.schema) + '</span>', cls: 'wrap' },
    { k: 'act', l: 'Action', f: (r) => (r.csv ? '<button class="btn sm" id="ds-csv">Export events CSV' + lockBtn('export') + '</button>' : '') },
  ];
  const tabRows = Object.keys(ds_SCHEMA).map((t) => ({ table: t, rows: TB[t].length, cols: ds_SCHEMA[t].map((c) => c.n + (c.t === 'n' ? ' (number)' : '')).join(', ') }));
  const tabCols = [
    { k: 'table', l: 'Table', f: (r) => '<span class="ds-mono">' + esc(r.table) + '</span>' },
    { k: 'rows', l: 'Rows', r: true, f: (r) => fmt(r.rows) },
    { k: 'cols', l: 'Columns', cls: 'wrap', f: (r) => '<span class="sub">' + esc(r.cols) + '</span>' },
  ];
  el.innerHTML = pgHead('Data connectors', 'Where the numbers in this console come from. Counts come from the season feed loaded in this browser. Planned connectors are labelled and not connected.', chip('Season feed: ' + D.matches.length + ' matches', 'good')) +
    '<div class="grid"><div class="s12">' + ds_try('Sources', 'Lineage: season feed → Fabric Lakehouse (planned) → Power BI (planned). Exports are hashed and logged.', () => tbl(cols, ds_SRC, { id: 'ds-src-t' })) + '</div>' +
    '<div class="s12">' + ds_try('Season tables', 'The six tables the query and chart pages read, with live row counts', () => tbl(tabCols, tabRows, { id: 'ds-tab-t' })) + '</div></div>';
  const btn = el.querySelector('#ds-csv');
  if (btn) btn.onclick = () => {
    if (!gate('export', 'export the events table')) return;
    const rows = ds_T().events;
    exportFile('matchcast-events.csv', toCSV(rows), 'text/csv', 'Events table (' + fmt(rows.length) + ' rows, CSV)');
  };
}

// ---------------------------------------------------------------- pages
page({ id: 'ds-query', title: 'Query workbench', group: 'Data science', render: (el) => ds_qRender(el) });
page({ id: 'ds-charts', title: 'Chart builder', group: 'Data science', render: (el) => ds_cbRender(el) });
page({ id: 'ds-boards', title: 'Dashboards', group: 'Data science', render: (el) => ds_bdRender(el) });
page({ id: 'ds-metrics', title: 'Custom metrics', group: 'Data science', render: (el) => ds_mxRender(el) });
page({ id: 'ds-connect', title: 'Data connectors', group: 'Data science', render: (el) => ds_cnRender(el) });
