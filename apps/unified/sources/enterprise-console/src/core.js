// ===================================================================================================
// MatchCast Enterprise: core. Data store, derived metrics, UI kit, charts, roles, audit, exports,
// shared store, AI agents with grounding, router and shell. Pages register themselves with page({...}).
//
// API for page modules (all globals in one script scope):
//   D                      season data: D.league, D.clubs[], D.club(key), D.matches[] (by date), D.match(id),
//                          D.players[] (season aggregates), D.player(name), D.table[] (league table)
//   match fields           m.id m.date m.matchday m.home m.away m.score[h,a] m.setup m.sum m.stats m.events[]
//                          m.frames[] m.pids[] m.roster m.verifier  + derived m.ts[key] (team stats), m.pm[name]
//                          (player match lines), m.title, m.imported
//   page({id,title,group,icon,render(el,arg)})   register; group in NAV order; render fills el (a .pg div)
//   go(id, arg)            navigate (#id or #id.arg)
//   esc fmt pct sum avg by clamp col(key) ccol(key) pairCols(homeKey, awayKey) -> [hc, ac] clubName(key)
//   UI: pgHead(title, sub, actsHtml, crumbs) card(title, sub, body, acts, cls) kpi(k, v, d, tone) chip(t, tone)
//       tbl(cols, rows, {id, sort, click, sel}) -> html; bindTbl(el, id, state, rerender)   seg(id, opts, cur)
//       svg charts: lineChart barChart hbars pitch radar scatter  legend(items)
//   Roles: ROLE, USERS, can(perm), deny(perm, what), need(perm); perms: view ask export approve admin audit keys
//   audit(action, target, detail, outcome)  verifyChain()  AUD (session chain)
//   exportFile(name, text, mime, label)  toCSV(rows)
//   store: await sList(col) / sAdd(col, obj) / sSet(col, id, obj) / sDel(col, id); shared via db when available
//   AI: askAgent({agent, q, ctx, tools, sys}) -> {text, src, ground, steps}; ground(text, ctx); AI.on
//   toast(msg) modal(html) closeModal()
// ===================================================================================================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => (n == null || isNaN(n) ? '–' : (+n).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const sum = (a, f = (x) => x) => a.reduce((s, x) => s + (+f(x) || 0), 0);
const avg = (a, f = (x) => x) => (a.length ? sum(a, f) / a.length : 0);
const by = (f, dir = -1) => (a, b) => { const x = f(a), y = f(b); return x === y ? 0 : (x > y ? 1 : -1) * -dir; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateLbl = (d) => { const x = new Date(d + 'T12:00:00Z'); return x.getUTCDate() + ' ' + MONTHS[x.getUTCMonth()] + ' ' + x.getUTCFullYear(); };

// ---------------------------------------------------------------- data
const D = { league: null, clubs: [], matches: [], players: [], table: [], loaded: false, version: 'season-2026-27.v1' };
D.club = (k) => D.clubs.find((c) => c.key === k) || { key: k, club: k, color: '#888', city: '' };
D.match = (id) => D.matches.find((m) => m.id === id);
D.player = (n) => D.players.find((p) => p.name === n);
const col = (k) => D.club(k).color;
const clubName = (k) => D.club(k).club;
// a club colour that reads on the surface in both themes (very dark kits get a lifted tone)
const ccol = (k) => { const c = col(k); const v = parseInt(c.slice(1), 16); const l = ((v >> 16) * 0.299 + ((v >> 8) & 255) * 0.587 + (v & 255) * 0.114); return l < 45 ? '#6B7C74' : c; };

// two club colours for one match that stay distinguishable (similar kits: the away side gets a contrasting tone)
const rgb = (c) => { const v = parseInt(c.slice(1), 16); return [v >> 16, (v >> 8) & 255, v & 255]; };
function pairCols(h, a) {
  const ch = ccol(h), ca = ccol(a); const x = rgb(ch), y = rgb(ca); const d = Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  if (d >= 110) return [ch, ca]; const alt = ['#E8833A', '#8B5CF6', '#14B8A6'].find((c) => { const z = rgb(c); return Math.hypot(x[0] - z[0], x[1] - z[1], x[2] - z[2]) >= 140; }) || '#E8833A'; return [ch, alt];
}
// match rating, shown on the scouting and match pages so the number is explainable
const RATING_FORMULA = '5.9 + 0.012·passes completed − 0.04·passes failed + 1.0·goals + 1.2·xG + 0.1·tackles + 0.05·ball wins − 0.04·ball losses + 0.1·take-ons won − 0.15·fouls, clamped 3–10';
function derive(m) {
  const H = m.home, A = m.away, ev = m.events || [];
  m.title = clubName(H) + ' ' + m.score[0] + '–' + m.score[1] + ' ' + clubName(A);
  const team = { [H]: 0, [A]: 1 }; const st = m.stats || {}; const sm = m.sum || {};
  const cnt = (t, k, f) => ev.filter((e) => e.type === t && e.team === k && (!f || f(e))).length;
  m.ts = {};
  for (const k of [H, A]) {
    const i = team[k], o = 1 - i, ok = i ? H : A;
    const passes = ev.filter((e) => e.type === 'pass' && e.team === k);
    const ft = passes.filter((e) => (e.ax ?? 0) > 70).length;
    const shots = ev.filter((e) => e.type === 'shot' && e.team === k);
    const oppPassesOwnHalf = ev.filter((e) => e.type === 'pass' && e.team === ok && (e.ax ?? 0) < 63).length;
    const defActs = ev.filter((e) => (e.type === 'turnover' || e.type === 'slide_tackle' || e.type === 'foul') && e.team === k && (e.type !== 'turnover' || (e.ax ?? 0) > 42)).length;
    m.ts[k] = {
      goals: m.score[i], against: m.score[o], xg: +(st.xg ? st.xg[i] : 0).toFixed(2), xga: +(st.xg ? st.xg[o] : 0).toFixed(2),
      shots: st.shots ? st.shots[i] : shots.length, onTarget: st.onTarget ? st.onTarget[i] : 0, passes: st.passes ? st.passes[i] : passes.length, done: st.done ? st.done[i] : 0,
      poss: sm.possessionPct ? sm.possessionPct[i] : 50, fouls: st.fouls ? st.fouls[i] : 0, yellows: st.yellows ? st.yellows[i] : 0, reds: st.reds ? st.reds[i] : 0, offsides: st.offsides ? st.offsides[i] : 0,
      corners: cnt('corner', k), freekicks: cnt('freekick', k), throwins: cnt('throw_in', k), wins: cnt('turnover', k), highWins: cnt('turnover', k, (e) => (e.ax ?? 0) > 70),
      takeOns: cnt('take_on', k), takeOnsWon: cnt('take_on', k, (e) => e.success), tackles: cnt('slide_tackle', k), aerials: cnt('aerial_duel', k),
      finalThird: ft, ppda: defActs ? +(oppPassesOwnHalf / defActs).toFixed(1) : null, form: sm.formations ? sm.formations[i] : '', style: sm.styles ? sm.styles[i] : '',
      result: m.score[i] > m.score[o] ? 'W' : m.score[i] < m.score[o] ? 'L' : 'D',
    };
  }
  // player match lines: tracking from the engine's summary plus event counts
  m.pm = {};
  const trk = Object.fromEntries(((sm.playerTracking) || []).map((t) => [t.name, t]));
  for (const p of m.pids || []) {
    const t = trk[p.name] || {}; const r = (m.roster || {})[p.name] || {};
    const goals = ev.filter((e) => e.type === 'goal' && e.player === p.name && !e.ownGoal).length;
    const wins = ev.filter((e) => e.type === 'turnover' && e.player === p.name).length;
    const losses = ev.filter((e) => e.type === 'turnover' && e.from === p.name).length;
    const tko = ev.filter((e) => e.type === 'take_on' && e.player === p.name); const tkw = tko.filter((e) => e.success).length;
    const fouls = ev.filter((e) => e.type === 'foul' && e.player === p.name).length;
    const cards = ev.filter((e) => (e.type === 'yellow_card' || e.type === 'red_card' || (e.type === 'foul' && e.card)) && e.player === p.name).length;
    const shotsL = ev.filter((e) => e.type === 'shot' && e.player === p.name);
    const xg = shotsL.reduce((s, e) => s + (e.xg || 0), 0);
    const pc = t.passesCompleted || 0, pa = t.passesAttempted || 0, tk = t.tackles || 0;
    const recv = ev.filter((e) => e.type === 'pass' && e.to === p.name).length;
    const rating = clamp(5.9 + 0.012 * pc - 0.04 * (pa - pc) + 1.0 * goals + 1.2 * xg + 0.1 * tk + 0.05 * wins - 0.04 * losses + 0.1 * tkw - 0.15 * fouls, 3, 10);
    m.pm[p.name] = { name: p.name, team: p.team, num: p.num, pos: r.pos || '', rating: +rating.toFixed(1), abil: r.rating || 0, goals, xg: +xg.toFixed(2), shots: shotsL.length, passes: pa, done: pc, recv, wins, losses, takeOns: tko.length, takeOnsWon: tkw, tackles: tk, fouls, cards,
      touches: t.touches || 0, km: t.distanceKm || 0, per90: t.per90Km || 0, top: t.topSpeedKmh || 0, sprints: t.sprints || 0, stamina: t.staminaPct ?? null };
  }
  return m;
}
function buildSeason() {
  D.matches.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  const T = {}; for (const c of D.clubs) T[c.key] = { key: c.key, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, xg: 0, xga: 0, pts: 0, form: [] };
  for (const m of D.matches) { if (m.imported) continue; for (const k of [m.home, m.away]) { const t = T[k], s = m.ts[k]; if (!t) continue; t.p++; t.gf += s.goals; t.ga += s.against; t.xg += s.xg; t.xga += s.xga; if (s.result === 'W') { t.w++; t.pts += 3; } else if (s.result === 'D') { t.d++; t.pts++; } else t.l++; t.form.push(s.result); } }
  D.table = Object.values(T).map((t) => Object.assign(t, { gd: t.gf - t.ga, xg: +t.xg.toFixed(2), xga: +t.xga.toFixed(2), xgd: +(t.xg - t.xga).toFixed(2) })).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || b.xgd - a.xgd);
  D.table.forEach((t, i) => { t.pos = i + 1; });
  const P = {};
  for (const m of D.matches) for (const n in m.pm) {
    const x = m.pm[n]; const p = P[n] || (P[n] = { name: n, team: x.team, num: x.num, pos: x.pos, abil: x.abil, apps: 0, ratingSum: 0, goals: 0, xg: 0, shots: 0, passes: 0, done: 0, recv: 0, wins: 0, losses: 0, takeOns: 0, takeOnsWon: 0, tackles: 0, fouls: 0, cards: 0, touches: 0, km: 0, per90: 0, top: 0, sprints: 0, games: [] });
    p.apps++; p.ratingSum += x.rating; for (const k of ['goals', 'xg', 'shots', 'passes', 'done', 'recv', 'wins', 'losses', 'takeOns', 'takeOnsWon', 'tackles', 'fouls', 'cards', 'touches', 'km', 'sprints']) p[k] += x[k] || 0;
    p.per90 += x.per90; p.top = Math.max(p.top, x.top); p.games.push({ id: m.id, rating: x.rating, opp: m.home === x.team ? m.away : m.home, date: m.date });
  }
  D.players = Object.values(P).map((p) => Object.assign(p, { rating: +(p.ratingSum / p.apps).toFixed(2), xg: +p.xg.toFixed(2), km: +p.km.toFixed(1), per90: +(p.per90 / p.apps).toFixed(1), passPct: pct(p.done, p.passes) }));
  // percentiles among outfield players at the same position group
  const grp = (pos) => (pos === 'GK' ? 'GK' : /B$/.test(pos) ? 'DEF' : /M$/.test(pos) ? 'MID' : 'ATT');
  for (const p of D.players) p.group = grp(p.pos);
  D.loaded = true;
}
async function loadData() {
  const L = await (await fetch('data/league.json')).json(); D.league = L; D.clubs = L.clubs;
  const ids = L.fixtures.map((f, k) => 'M' + String(k + 1).padStart(3, '0'));
  const got = await Promise.all(ids.map((id) => fetch('data/' + id + '.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)));
  D.matches = got.filter(Boolean).map(derive);
  buildSeason();
}

// ---------------------------------------------------------------- roles & permissions (simulated Entra ID groups)
const USERS = {
  viewer: { name: 'Jordan Ellis', title: 'Coaching staff (read only)', group: 'MC-Viewers' },
  analyst: { name: 'Priya Raman', title: 'Lead performance analyst', group: 'MC-Analysts' },
  scout: { name: 'Tomás Herrera', title: 'Senior scout', group: 'MC-Scouts' },
  manager: { name: 'Elena Marsh', title: 'Head coach (approver)', group: 'MC-Approvers' },
  admin: { name: 'Alex Chen', title: 'Platform admin', group: 'MC-Admins' },
};
const PERMS = {
  view: ['viewer', 'analyst', 'scout', 'manager', 'admin'],
  ask: ['analyst', 'scout', 'manager', 'admin'],
  export: ['analyst', 'scout', 'manager', 'admin'],
  author: ['analyst', 'scout', 'admin'],
  approve: ['manager', 'admin'],
  audit: ['manager', 'admin'],
  admin: ['admin'],
  keys: ['admin'],
};
const PERM_LBL = { view: 'View dashboards and data', ask: 'Ask Copilot agents', export: 'Export data and reports', author: 'Create reports and saved queries', approve: 'Approve reports for release', audit: 'Read the organisation audit log', admin: 'Manage users, roles and settings', keys: 'Create API keys and webhooks' };
let ROLE = 'analyst';
try { const r = localStorage.getItem('mce.role'); if (r && USERS[r]) ROLE = r; } catch (e) {}
const can = (p) => (PERMS[p] || []).includes(ROLE);
const need = (p) => { const r = (PERMS[p] || ['admin']).find((x) => x !== 'viewer') || 'admin'; return r[0].toUpperCase() + r.slice(1); };
const me = () => USERS[ROLE];
function deny(p, what) { audit('access.denied', what, 'Needs ' + need(p) + ' role', 'denied'); toast('🔒 Your role (' + me().title + ') can’t ' + PERM_LBL[p].toLowerCase() + '. Ask for the ' + need(p) + ' role.'); return false; }
const gate = (p, what) => (can(p) ? true : deny(p, what));
const lockBtn = (p) => (can(p) ? '' : ' <span class="lk" title="Needs ' + need(p) + ' role">🔒</span>');

// ---------------------------------------------------------------- SHA-256 and the tamper-evident audit chain
async function sha(text) {
  try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
  catch (e) { let h = 0x811c9dc5, o = ''; for (let k = 0; k < 8; k++) { for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i) + k; h = Math.imul(h, 16777619) >>> 0; } o += h.toString(16).padStart(8, '0'); } return o; }
}
const AUD = { log: [], head: '0'.repeat(64), q: Promise.resolve(), chain: null, session: Math.random().toString(36).slice(2, 8).toUpperCase() };
const canon = (e) => [e.seq, e.at, e.actor, e.role, e.action, e.target, e.detail, e.outcome].join('|');
function audit(action, target, detail, outcome) {
  const e = { seq: AUD.log.length + 1, at: new Date().toISOString(), actor: me().name, role: ROLE, action, target: String(target || ''), detail: String(detail || ''), outcome: outcome || 'ok', prev: '', hash: '', session: AUD.session };
  AUD.log.push(e); AUD.chain = null;
  AUD.q = AUD.q.then(async () => { e.prev = AUD.head; e.hash = await sha(e.prev + '|' + canon(e)); AUD.head = e.hash; sAdd('audit', Object.assign({}, e)).catch(() => {}); });
  if (typeof onAudit === 'function') onAudit(e);
  return e;
}
let onAudit = null;
async function verifyChain() {
  await AUD.q; let prev = '0'.repeat(64);
  for (const e of AUD.log) { const h = await sha(prev + '|' + canon(e)); if (e.prev !== prev || h !== e.hash) return (AUD.chain = { ok: false, at: e.seq, n: AUD.log.length }); prev = e.hash; }
  return (AUD.chain = { ok: true, n: AUD.log.length, head: prev });
}

// ---------------------------------------------------------------- shared store: claude db when granted, else this browser
const STORE = { db: null, mode: 'local', mem: {} };
const lsKey = (c) => 'mce.store.' + c;
function lsGet(c) { if (STORE.mem[c]) return STORE.mem[c]; let v = []; try { v = JSON.parse(localStorage.getItem(lsKey(c)) || '[]'); } catch (e) {} return (STORE.mem[c] = v); }
function lsPut(c) { try { localStorage.setItem(lsKey(c), JSON.stringify(STORE.mem[c].slice(-400))); } catch (e) {} }
async function sList(c) {
  if (STORE.db) { try { const s = await STORE.db.collection(c).orderBy('at', 'desc').limit(200).get(); return s.docs.map((d) => Object.assign({ id: d.id }, d.data())); } catch (e) { STORE.db = null; STORE.mode = 'local'; } }
  return lsGet(c).slice().sort((a, b) => (a.at < b.at ? 1 : -1));
}
async function sAdd(c, o) {
  o = Object.assign({ at: new Date().toISOString() }, o);
  if (STORE.db) { try { const r = await STORE.db.collection(c).add(o); return Object.assign({ id: r.id }, o); } catch (e) { STORE.db = null; STORE.mode = 'local'; } }
  o.id = o.id || c.slice(0, 2) + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); lsGet(c).push(o); lsPut(c); return o;
}
async function sSet(c, id, o) {
  if (STORE.db) { try { await STORE.db.collection(c).doc(id).set(o); return; } catch (e) { STORE.db = null; STORE.mode = 'local'; } }
  const a = lsGet(c); const i = a.findIndex((x) => x.id === id); if (i >= 0) a[i] = Object.assign({ id }, o); else a.push(Object.assign({ id }, o)); lsPut(c);
}
async function sDel(c, id) {
  if (STORE.db) { try { await STORE.db.collection(c).doc(id).delete(); return; } catch (e) { STORE.db = null; STORE.mode = 'local'; } }
  STORE.mem[c] = lsGet(c).filter((x) => x.id !== id); lsPut(c);
}

// ---------------------------------------------------------------- exports (role-gated, hashed, audited)
const EXPORTS = [];
let DL = null;
function toCSV(rows) { if (!rows.length) return ''; const ks = Object.keys(rows[0]); const q = (v) => { v = Array.isArray(v) ? v.join('-') : v; v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }; return ks.join(',') + '\n' + rows.map((r) => ks.map((k) => q(r[k])).join(',')).join('\n'); }
async function exportFile(name, text, mime, label) {
  if (!gate('export', label)) return;
  const h = await sha(text); EXPORTS.unshift({ name, label, sha: h, kb: +(text.length / 1024).toFixed(1), at: new Date().toISOString(), user: me().name });
  audit('data.export', name, label + ' · ' + (text.length / 1024).toFixed(1) + ' KB · sha256 ' + h.slice(0, 16) + '…');
  if (DL) { try { await DL.save({ filename: name, data: new Blob([text], { type: mime }) }); toast('⬇ ' + label + ' saved · sha256 ' + h.slice(0, 10) + '…'); } catch (e) { toast(e && e.code === 'declined' ? 'Download cancelled.' : 'Downloads aren’t available in this view.'); } return; }
  if (!window.claude) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; a.click(); toast('⬇ ' + label + ' · sha256 ' + h.slice(0, 10) + '…'); return; }
  toast('Downloads aren’t available in this view. The export was hashed and logged.');
}

// ---------------------------------------------------------------- AI agents (Claude via the sample capability), grounded
const AI = { sample: null, on: false, runs: [] };
const AGENTS = {
  analyst: { name: 'Analyst', icon: '📊', role: 'Answers questions from the season data with tool calls', color: '#2458C6' },
  scout: { name: 'Scout', icon: '🔭', role: 'Finds and compares players', color: '#0C7A53' },
  writer: { name: 'Report writer', icon: '✍️', role: 'Drafts reports from approved numbers', color: '#8A4FBF' },
  verifier: { name: 'Verifier', icon: '✓', role: 'Checks every number against the data before release', color: '#A8650F' },
};
// every number in the answer must exist in the data the agent was given or fetched
function ground(text, ctx) {
  const nums = [...new Set((String(text || '').match(/-?\d+(?:\.\d+)?/g) || []).map(Number))];
  const pool = new Set([0, 1, 2, 3, 90, 45, 100, 2026, 2027]);
  const walk = (o, d) => { if (o == null || d > 7) return; if (typeof o === 'number') { pool.add(o); pool.add(+o.toFixed(2)); pool.add(+o.toFixed(1)); pool.add(Math.round(o)); pool.add(Math.round(o * 100)); pool.add(+(o * 100).toFixed(1)); }
    else if (typeof o === 'string') { for (const x of o.match(/-?\d+(?:\.\d+)?/g) || []) pool.add(+x); } else if (Array.isArray(o)) { o.forEach((x) => walk(x, d + 1)); pool.add(o.length); } else if (typeof o === 'object') for (const k in o) walk(o[k], d + 1); };
  walk(ctx, 0);
  const bad = nums.filter((n) => !pool.has(n) && !pool.has(Math.abs(n)));
  return { n: nums.length, ok: nums.length - bad.length, bad, pass: bad.length === 0 };
}
const groundChip = (g) => (!g ? '' : g.pass ? '<span class="chip good" title="Every number in this answer appears in the data the agent used">✓ Grounded · ' + g.ok + '/' + g.n + ' numbers</span>' : '<span class="chip bad" title="Numbers not found in the data: ' + esc(g.bad.join(', ')) + '">⚠ ' + g.bad.length + ' unverified number' + (g.bad.length > 1 ? 's' : '') + '</span>');
async function askAgent({ agent = 'analyst', q, ctx, tools, sys, onText, rules }) {
  const run = { id: 'run-' + (AI.runs.length + 1), agent, q, at: new Date().toISOString(), steps: [], user: me().name, src: 'rules', ms: 0 };
  const t0 = performance.now(); AI.runs.unshift(run);
  const fetched = [];
  if (AI.sample) {
    try {
      const wrapped = (tools || []).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, execute: (inp) => { const out = t.execute(inp); run.steps.push(t.name + '(' + JSON.stringify(inp) + ')'); fetched.push(out); if (onText) onText(null, run.steps); return out; } }));
      const prompt = (sys || 'You are the ' + AGENTS[agent].name + ' agent in MatchCast Enterprise, a football analysis platform for a club analysis department. All data is synthetic and from the MatchCast simulator.') +
        '\nRules: answer in at most 6 short sentences or a short list, plain text, no markdown headings. Cite numbers exactly as they appear in the data. Use only facts from the JSON below or from your tools. If the data cannot answer, say so.' +
        '\n\nQuestion: ' + q + '\n\nData (JSON):\n' + JSON.stringify(ctx);
      const r = await AI.sample(prompt, { modelTier: 'default', cache: false, tools: wrapped.length ? wrapped : undefined, onText: onText ? ({ text }) => onText(text, run.steps) : undefined });
      run.text = r.text; run.src = 'ai';
    } catch (e) { run.err = e && e.code; }
  }
  if (run.src !== 'ai') { run.text = rules ? rules() : 'Copilot is running on rules in this view, and no rule covers that question yet.'; run.src = 'rules'; }
  run.ground = run.src === 'ai' ? ground(run.text, [ctx, fetched]) : { n: 0, ok: 0, bad: [], pass: true, rule: true };
  run.ms = Math.round(performance.now() - t0);
  audit('agent.run', AGENTS[agent].name, (run.src === 'ai' ? 'Claude' : 'rules') + ' · ' + q.slice(0, 80) + (run.src === 'ai' ? ' · grounded ' + run.ground.ok + '/' + run.ground.n : ''), run.src === 'ai' && !run.ground.pass ? 'flagged' : 'ok');
  return run;
}

// ---------------------------------------------------------------- UI kit
const toast = (t) => { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => { el.hidden = true; }, 4200); };
function modal(html) { closeModal(); const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.id = 'modal'; bg.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + '</div>'; bg.onclick = (e) => { if (e.target === bg) closeModal(); }; document.body.appendChild(bg); const f = bg.querySelector('input,select,textarea,button'); if (f) f.focus(); return bg; }
function closeModal() { const m = $('#modal'); if (m) m.remove(); }
const chip = (t, tone) => '<span class="chip ' + (tone || '') + '">' + t + '</span>';
const kpi = (k, v, d, tone) => '<div class="kpi ' + (tone || '') + '"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (d ? '<div class="d">' + d + '</div>' : '') + '</div>';
const card = (title, sub, body, acts, cls) => '<section class="card ' + (cls || '') + '">' + (title ? '<div class="card-h"><div><h3>' + title + '</h3>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' + (acts ? '<div class="acts">' + acts + '</div>' : '') + '</div>' : '') + body + '</section>';
const pgHead = (title, sub, acts, crumbs) => (crumbs ? '<div class="crumb">' + crumbs.map((c) => (c[1] ? '<button data-go="' + c[1] + '">' + esc(c[0]) + '</button>' : '<span>' + esc(c[0]) + '</span>')).join('<span>/</span>') + '</div>' : '') + '<div class="pg-h"><div><h1>' + title + '</h1>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' + (acts ? '<div class="acts">' + acts + '</div>' : '') + '</div>';
const seg = (id, opts, cur) => '<div class="seg" id="' + id + '" role="group">' + opts.map(([v, l]) => '<button data-v="' + v + '" aria-pressed="' + (String(v) === String(cur)) + '">' + l + '</button>').join('') + '</div>';
const bindSeg = (root, id, f) => { const s = root.querySelector('#' + id); if (s) s.onclick = (e) => { const b = e.target.closest('button'); if (b) f(b.dataset.v); }; };
const legend = (items) => '<div class="legend">' + items.map(([l, c, dash]) => '<span><i style="background:' + c + (dash ? ';opacity:.5' : '') + '"></i>' + esc(l) + '</span>').join('') + '</div>';
const clubTag = (k) => '<span class="dot" style="background:' + ccol(k) + '"></span>' + esc(clubName(k));
const resChip = (r) => chip(r, r === 'W' ? 'good' : r === 'L' ? 'bad' : '');
// sortable table: cols [{k, l, r (right align), f (cell html), v (sort value)}]
function tbl(cols, rows, o = {}) {
  const st = o.sort || {}; let rs = rows.slice();
  if (st.k) { const c = cols.find((x) => x.k === st.k); const v = (c && c.v) || ((r) => r[st.k]); rs.sort((a, b) => { const x = v(a), y = v(b); return (x === y ? 0 : x > y ? 1 : -1) * (st.dir === 'asc' ? 1 : -1); }); }
  if (o.limit) rs = rs.slice(0, o.limit);
  return '<div class="tw"><table class="tbl" id="' + (o.id || '') + '"><thead><tr>' + cols.map((c) => '<th' + (c.r ? ' class="r"' : '') + (o.sort !== undefined && c.sort !== false ? ' data-k="' + c.k + '"' : '') + (st.k === c.k ? ' aria-sort="' + (st.dir === 'asc' ? 'ascending' : 'descending') + '"' : '') + (c.t ? ' title="' + esc(c.t) + '"' : '') + '>' + c.l + '</th>').join('') + '</tr></thead><tbody>' +
    (rs.length ? rs.map((r, i) => '<tr' + (o.click ? ' class="click' + (o.sel && o.sel(r) ? ' sel' : '') + '" data-i="' + esc(o.key ? o.key(r) : i) + '" tabindex="0"' : '') + '>' + cols.map((c) => '<td class="' + (c.r ? 'r ' : '') + (c.cls || '') + '">' + (c.f ? c.f(r, i) : esc(r[c.k])) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + cols.length + '"><div class="empty">' + (o.empty || 'Nothing matches these filters.') + '</div></td></tr>') + '</tbody></table></div>';
}
function bindTbl(root, id, state, rerender, onClick) {
  const t = root.querySelector('#' + id); if (!t) return;
  t.querySelectorAll('th[data-k]').forEach((th) => { th.onclick = () => { const k = th.dataset.k; state.dir = state.k === k && state.dir !== 'asc' ? 'asc' : 'desc'; state.k = k; rerender(); }; });
  if (onClick) t.querySelectorAll('tr.click').forEach((tr) => { tr.onclick = () => onClick(tr.dataset.i); tr.onkeydown = (e) => { if (e.key === 'Enter') onClick(tr.dataset.i); }; });
}

// ---------------------------------------------------------------- charts (SVG, theme tokens, drawn to scale)
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
const tickFmt = (v) => (Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(Math.abs(v) < 1 ? 2 : 1));
// line chart: series [{name, color, pts:[[x,y],...], dash, step, area}]
function lineChart({ series, w = 640, h = 220, xMin, xMax, yMin = 0, yMax, xTicks, yFmt = tickFmt, xFmt = (v) => String(v), marks = [], yLabel = '' }) {
  const all = series.flatMap((s) => s.pts); if (!all.length) return '<div class="empty">No data yet.</div>';
  xMin = xMin ?? Math.min(...all.map((p) => p[0])); xMax = xMax ?? Math.max(...all.map((p) => p[0])); yMax = yMax ?? niceMax(Math.max(...all.map((p) => p[1])) * 1.05);
  const L = 40, R = 12, T = 10, B = 24, X = (x) => L + ((x - xMin) / ((xMax - xMin) || 1)) * (w - L - R), Y = (y) => T + (1 - (y - yMin) / ((yMax - yMin) || 1)) * (h - T - B);
  let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" role="img" style="height:auto;display:block">';
  for (let i = 0; i <= 4; i++) { const v = yMin + ((yMax - yMin) * i) / 4; s += '<line class="gl" x1="' + L + '" x2="' + (w - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="ax" x="' + (L - 6) + '" y="' + (Y(v) + 3) + '" text-anchor="end">' + yFmt(v) + '</text>'; }
  const xt = xTicks || [xMin, xMin + (xMax - xMin) / 2, xMax]; for (const v of xt) s += '<text class="ax" x="' + X(v) + '" y="' + (h - 6) + '" text-anchor="middle">' + xFmt(v) + '</text>';
  if (yLabel) s += '<text class="ax" x="' + L + '" y="' + (T - 1) + '">' + esc(yLabel) + '</text>';
  for (const sr of series) {
    if (!sr.pts.length) continue; let d = '';
    sr.pts.forEach((p, i) => { if (i && sr.step) d += 'L' + X(p[0]).toFixed(1) + ',' + Y(sr.pts[i - 1][1]).toFixed(1); d += (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); });
    if (sr.area) s += '<path d="' + d + 'L' + X(sr.pts[sr.pts.length - 1][0]).toFixed(1) + ',' + Y(yMin) + 'L' + X(sr.pts[0][0]).toFixed(1) + ',' + Y(yMin) + 'Z" fill="' + sr.color + '" fill-opacity=".12"/>';
    s += '<path d="' + d + '" fill="none" stroke="' + sr.color + '" stroke-width="2"' + (sr.dash ? ' stroke-dasharray="4 3"' : '') + ' vector-effect="non-scaling-stroke"/>';
    const lp = sr.pts[sr.pts.length - 1]; s += '<circle cx="' + X(lp[0]) + '" cy="' + Y(lp[1]) + '" r="3" fill="' + sr.color + '"/>';
  }
  for (const m of marks) s += '<circle cx="' + X(m.x) + '" cy="' + Y(m.y) + '" r="' + (m.r || 4.5) + '" fill="' + m.color + '" stroke="var(--surface)" stroke-width="1.5"><title>' + esc(m.title || '') + '</title></circle>';
  return s + '</svg>';
}
// vertical bars: groups [{label, vals:[{v, color, title}]}]
function barChart({ groups, w = 640, h = 200, yMax, yFmt = tickFmt, stacked = false }) {
  if (!groups.length) return '<div class="empty">No data yet.</div>';
  const mx = yMax ?? niceMax(Math.max(...groups.map((g) => (stacked ? sum(g.vals, (x) => x.v) : Math.max(...g.vals.map((x) => x.v))))) * 1.05);
  const L = 36, R = 8, T = 10, B = 26, gw = (w - L - R) / groups.length, Y = (v) => T + (1 - v / mx) * (h - T - B);
  let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" role="img" style="height:auto;display:block">';
  for (let i = 0; i <= 4; i++) { const v = (mx * i) / 4; s += '<line class="gl" x1="' + L + '" x2="' + (w - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="ax" x="' + (L - 5) + '" y="' + (Y(v) + 3) + '" text-anchor="end">' + yFmt(v) + '</text>'; }
  groups.forEach((g, gi) => {
    const x0 = L + gi * gw + gw * 0.15, bw = (gw * 0.7) / (stacked ? 1 : g.vals.length); let acc = 0;
    g.vals.forEach((b, bi) => { const y1 = stacked ? Y(acc + b.v) : Y(b.v), y0 = stacked ? Y(acc) : Y(0); acc += b.v; s += '<rect x="' + (x0 + (stacked ? 0 : bi * bw)).toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + Math.max(1, bw - 2).toFixed(1) + '" height="' + Math.max(0, y0 - y1).toFixed(1) + '" rx="2" fill="' + b.color + '"><title>' + esc(b.title || g.label + ': ' + b.v) + '</title></rect>'; });
    s += '<text class="ax" x="' + (L + gi * gw + gw / 2) + '" y="' + (h - 8) + '" text-anchor="middle">' + esc(g.label) + '</text>';
  });
  return s + '</svg>';
}
// horizontal bars as HTML rows: [{label, v, color, sub}]
function hbars(rows, { max, fmt: f = (v) => fmt(v, 2) } = {}) {
  const mx = max ?? Math.max(...rows.map((r) => r.v), 0.0001);
  return '<div class="list">' + rows.map((r) => '<div style="display:grid;grid-template-columns:minmax(0,9rem) minmax(0,1fr) 3.6rem;gap:10px;align-items:center;padding:4px 0;font-size:13px"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(r.label) + '">' + (r.labelHtml || esc(r.label)) + '</span><div class="bar"><i style="width:' + (100 * Math.max(0, r.v) / mx).toFixed(1) + '%;background:' + (r.color || 'var(--accent)') + '"></i></div><span class="num" style="text-align:right">' + f(r.v) + '</span></div>').join('') + '</div>';
}
// pitch in its own frame: x 0..105 (attacking →), y 0..68
function pitch(inner, { half = false, title = '', h } = {}) {
  const vb = half ? '50 -2 57 72' : '-2 -2 109 72';
  return '<svg viewBox="' + vb + '" width="100%" role="img" aria-label="' + esc(title) + '" style="display:block;height:auto' + (h ? ';max-height:' + h : '') + '"><rect class="pitch-bg" x="-2" y="-2" width="109" height="72" rx="1"/>' +
    '<g class="pitch-ln"><rect x="0" y="0" width="105" height="68"/><line x1="52.5" y1="0" x2="52.5" y2="68"/><circle cx="52.5" cy="34" r="9.15"/><rect x="0" y="13.84" width="16.5" height="40.32"/><rect x="88.5" y="13.84" width="16.5" height="40.32"/><rect x="0" y="24.84" width="5.5" height="18.32"/><rect x="99.5" y="24.84" width="5.5" height="18.32"/><path d="M16.5 26.7 A9.15 9.15 0 0 1 16.5 41.3"/><path d="M88.5 26.7 A9.15 9.15 0 0 0 88.5 41.3"/><rect x="105" y="30.34" width="1.5" height="7.32"/><rect x="-1.5" y="30.34" width="1.5" height="7.32"/></g>' + inner + '</svg>';
}
// radar: axes [{l}], sets [{name, color, vals 0..1, dash}]
function radar(axes, sets, size = 260) {
  const c = size / 2, r = c - 44, n = axes.length, P = (i, v) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [c + Math.cos(a) * r * v, c + Math.sin(a) * r * v]; };
  let s = '<svg viewBox="0 0 ' + size + ' ' + size + '" width="100%" style="max-width:' + (size + 40) + 'px;display:block;margin:0 auto;height:auto" role="img">';
  for (const g of [0.25, 0.5, 0.75, 1]) s += '<polygon points="' + axes.map((_, i) => P(i, g).join(',')).join(' ') + '" fill="none" class="gl"/>';
  axes.forEach((a, i) => { const [x, y] = P(i, 1); const [lx, ly] = P(i, 1.2); s += '<line x1="' + c + '" y1="' + c + '" x2="' + x + '" y2="' + y + '" class="gl"/><text class="ax" x="' + lx + '" y="' + (ly + 3) + '" text-anchor="' + (Math.abs(lx - c) < 8 ? 'middle' : lx > c ? 'start' : 'end') + '">' + esc(a.l) + '</text>'; });
  for (const st of sets) s += '<polygon points="' + st.vals.map((v, i) => P(i, clamp(v, 0.02, 1)).join(',')).join(' ') + '" fill="' + st.color + '" fill-opacity="' + (st.dash ? 0 : 0.18) + '" stroke="' + st.color + '" stroke-width="2"' + (st.dash ? ' stroke-dasharray="4 3"' : '') + '/>';
  return s + '</svg>';
}
// scatter: pts [{x, y, color, r, title, id}]
function scatter({ pts, w = 640, h = 300, xLabel = '', yLabel = '', xMax, yMax, xFmt = tickFmt, yFmt = tickFmt, avgLines = true }) {
  if (!pts.length) return '<div class="empty">No players match.</div>';
  xMax = xMax ?? niceMax(Math.max(...pts.map((p) => p.x)) * 1.05); yMax = yMax ?? niceMax(Math.max(...pts.map((p) => p.y)) * 1.05);
  const L = 44, R = 12, T = 12, B = 34, X = (x) => L + (x / xMax) * (w - L - R), Y = (y) => T + (1 - y / yMax) * (h - T - B);
  let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" role="img" style="height:auto;display:block">';
  for (let i = 0; i <= 4; i++) { const v = (yMax * i) / 4, u = (xMax * i) / 4; s += '<line class="gl" x1="' + L + '" x2="' + (w - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="ax" x="' + (L - 5) + '" y="' + (Y(v) + 3) + '" text-anchor="end">' + yFmt(v) + '</text><text class="ax" x="' + X(u) + '" y="' + (h - 18) + '" text-anchor="middle">' + xFmt(u) + '</text>'; }
  s += '<text class="ax" x="' + ((L + w - R) / 2) + '" y="' + (h - 3) + '" text-anchor="middle">' + esc(xLabel) + '</text><text class="ax" x="' + L + '" y="' + (T - 2) + '">' + esc(yLabel) + '</text>';
  if (avgLines) { const ax = avg(pts, (p) => p.x), ay = avg(pts, (p) => p.y); s += '<line x1="' + X(ax) + '" x2="' + X(ax) + '" y1="' + T + '" y2="' + (h - B) + '" stroke="var(--line-2)" stroke-dasharray="3 3"/><line x1="' + L + '" x2="' + (w - R) + '" y1="' + Y(ay) + '" y2="' + Y(ay) + '" stroke="var(--line-2)" stroke-dasharray="3 3"/>'; }
  for (const p of pts) s += '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="' + (p.r || 5) + '" fill="' + p.color + '" fill-opacity=".85" stroke="var(--surface)" stroke-width="1"' + (p.id ? ' data-id="' + esc(p.id) + '" style="cursor:pointer"' : '') + '><title>' + esc(p.title || '') + '</title></circle>' + (p.label ? '<text x="' + (X(p.x) + 7).toFixed(1) + '" y="' + (Y(p.y) + 3).toFixed(1) + '" style="font-size:10px;fill:var(--ink-2)">' + esc(p.label) + '</text>' : '');
  return s + '</svg>';
}

// ---------------------------------------------------------------- router, nav and shell
const PAGES = {};
const NAV = [
  ['Workspace', ['home', 'library', 'match']],
  ['Analysis tools', ['explorer', 'scouting', 'opposition', 'setpieces', 'board']],
  ['Data science', ['ds-query', 'ds-charts', 'ds-boards', 'ds-notebooks', 'ds-model', 'ds-similar', 'ds-metrics', 'ds-tracking', 'ds-connect']],
  ['AI agents', ['agents', 'ds-agent']],
  ['Governance', ['reports', 'audit', 'catalogue', 'access']],
  ['Platform', ['api', 'usage', 'status', 'settings']],
];
const ICONS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', library: 'M4 4h6v16H4zM14 4h6v16h-6zM10 8h4', match: 'M3 5h18v14H3zM12 5v14M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6',
  explorer: 'M4 20V10M10 20V4M16 20v-7M22 20H2', scouting: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14M21 21l-5-5', opposition: 'M5 3h10l4 4v14H5zM9 12h6M9 16h6M9 8h3',
  setpieces: 'M5 21V4l12 4-12 4', board: 'M3 4h18v16H3zM7 15l3-3 3 2 4-5', agents: 'M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z',
  reports: 'M6 3h9l4 4v14H6zM9 13l2 2 4-4', audit: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4', catalogue: 'M4 6c0-2 16-2 16 0v12c0 2-16 2-16 0zM4 6c0 2 16 2 16 0M4 12c0 2 16 2 16 0',
  access: 'M9 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8M2 21c0-4 3-6 7-6s7 2 7 6M17 8h5M19.5 5.5v5', api: 'M8 6l-6 6 6 6M16 6l6 6-6 6M14 4l-4 16', usage: 'M3 20h18M6 16v-5M11 16V7M16 16v-8M21 16v-3',
  status: 'M3 12h4l3-7 4 14 3-7h4', settings: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6M19 12l2-1-1-3-2 .2-1.3-1.6.4-2-3-1-1 1.8h-2L9.1 2.6l-3 1 .4 2L5.2 7.2 3 7l-1 3 2 1v2l-2 1 1 3 2.2-.2 1.3 1.6-.4 2 3 1 1-1.8h2l1 1.8 3-1-.4-2 1.3-1.6 2.2.2 1-3-2-1z',
};
const icon = (k) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (ICONS[k] || ICONS.home) + '"/></svg>';
const R = { page: 'home', arg: null, state: {} };
function page(p) { PAGES[p.id] = p; }
function go(id, arg) { const h = id + (arg ? '.' + arg : ''); if (location.hash.slice(1) !== h) { try { history.pushState(null, '', '#' + h); } catch (e) {} } route(id, arg); }
function route(id, arg) {
  if (!PAGES[id]) id = 'home';
  R.page = id; R.arg = arg || null; drawNav();
  const main = $('#main'); main.innerHTML = '<div class="pg" id="pg"></div>'; main.scrollTop = 0;
  const el = $('#pg');
  try { PAGES[id].render(el, R.arg); } catch (e) { console.error(e); el.innerHTML = pgHead('Something went wrong', 'This page hit an error: ' + esc(e.message)); }
  el.querySelectorAll('[data-go]').forEach((b) => { if (!b.onclick) b.onclick = () => { const [p, a] = b.dataset.go.split('.'); go(p, a); }; });
  document.body.classList.remove('nav-open'); $('#menu').setAttribute('aria-expanded', 'false');
  document.title = (PAGES[id].title || 'MatchCast') + ' · MatchCast Enterprise';
}
function rerender() { route(R.page, R.arg); }
const NAVCNT = {};
function drawNav() {
  const cur = R.page;
  $('#nav').innerHTML = NAV.map(([g, ids]) => { const items = ids.filter((i) => PAGES[i]); if (!items.length) return ''; return '<div class="ng">' + g + '</div>' + items.map((i) => { const P = PAGES[i]; const locked = P.perm && !can(P.perm); return '<button class="ni" data-p="' + i + '"' + (cur === i ? ' aria-current="page"' : '') + '>' + icon(i) + '<span>' + P.title + '</span>' + (locked ? '<span class="lockic" title="Needs ' + need(P.perm) + ' role">🔒</span>' : NAVCNT[i] ? '<span class="cnt' + (NAVCNT[i].hot ? ' hot' : '') + '">' + NAVCNT[i].n + '</span>' : '') + '</button>'; }).join(''); }).join('') +
    '<div class="ng">Data</div><div class="note" style="padding:2px 10px 0;line-height:1.5">' + esc(D.league ? D.league.competition + ' · ' + D.league.season : '') + '<br>' + D.matches.length + ' matches · ' + D.players.length + ' players<br>Store: ' + (STORE.mode === 'db' ? 'shared team store' : 'this browser') + '<br>AI: ' + (AI.on ? 'Claude via Foundry-ready agents' : 'rules (Claude not granted here)') + '</div>';
  $$('#nav .ni').forEach((b) => { b.onclick = () => go(b.dataset.p, b.dataset.p === 'match' ? (R.lastMatch || (D.matches[D.matches.length - 1] || {}).id) : null); });
}
function drawWho() {
  const sel = $('#role'); sel.innerHTML = Object.entries(USERS).map(([k, u]) => '<option value="' + k + '"' + (k === ROLE ? ' selected' : '') + '>' + esc(u.name) + ' · ' + esc(u.title.split(' (')[0]) + '</option>').join('');
  $('#who-av').textContent = me().name.split(' ').map((x) => x[0]).join('');
  sel.onchange = () => { const was = ROLE; ROLE = sel.value; try { localStorage.setItem('mce.role', ROLE); } catch (e) {} audit('auth.switch_user', me().name, 'Demo sign-in switch from ' + USERS[was].name + ' (' + USERS[was].group + ' → ' + me().group + ')'); drawWho(); rerender(); toast('Signed in as ' + me().name + ' · ' + me().title); };
}

// ---------------------------------------------------------------- global search
function searchIndex(q) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const out = [];
  for (const c of D.clubs) if ((c.club + ' ' + c.key + ' ' + c.city).toLowerCase().includes(q)) out.push({ t: 'Club', l: c.club, s: c.city, go: ['scouting', 'club-' + c.key] });
  for (const p of D.players) if (p.name.toLowerCase().includes(q)) out.push({ t: 'Player', l: p.name, s: p.pos + ' · ' + clubName(p.team), go: ['scouting', 'p-' + p.name.replace(/[^A-Za-z0-9]/g, '_')] });
  for (const m of D.matches) if ((m.title + ' ' + m.id + ' ' + m.setup.stadium + ' ' + m.date).toLowerCase().includes(q)) out.push({ t: 'Match', l: m.title, s: dateLbl(m.date) + ' · ' + m.setup.stadium, go: ['match', m.id] });
  for (const id in PAGES) if (PAGES[id].title.toLowerCase().includes(q)) out.push({ t: 'Page', l: PAGES[id].title, s: '', go: [id] });
  return out.slice(0, 12);
}
function bindSearch() {
  const inp = $('#q'); let box = null;
  const close = () => { if (box) { box.remove(); box = null; } };
  inp.oninput = () => {
    const res = searchIndex(inp.value); close(); if (!res.length) return;
    box = document.createElement('div'); box.className = 'card'; Object.assign(box.style, { position: 'fixed', top: 'calc(50px + env(safe-area-inset-top,0px))', left: inp.closest('#search').getBoundingClientRect().left + 'px', width: '380px', maxWidth: 'calc(100% - 32px)', zIndex: 40, padding: '6px' });
    box.innerHTML = res.map((r, i) => '<button class="ni" data-i="' + i + '"><span class="chip">' + r.t + '</span><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.l) + ' <span class="note">' + esc(r.s) + '</span></span></button>').join('');
    box.onclick = (e) => { const b = e.target.closest('[data-i]'); if (!b) return; const r = res[+b.dataset.i]; close(); inp.value = ''; go(r.go[0], r.go[1]); };
    document.body.appendChild(box);
  };
  inp.onkeydown = (e) => { if (e.key === 'Escape') { close(); inp.blur(); } if (e.key === 'Enter' && box) { const b = box.querySelector('[data-i]'); if (b) b.click(); } };
  inp.onblur = () => setTimeout(close, 200);
  document.addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); inp.focus(); } });
}

// ---------------------------------------------------------------- boot
async function boot() {
  drawWho(); bindSearch();
  $('#menu').onclick = () => { const o = document.body.classList.toggle('nav-open'); $('#menu').setAttribute('aria-expanded', String(o)); };
  $('#scrim').onclick = () => { document.body.classList.remove('nav-open'); };
  try { await loadData(); } catch (e) { $('#load').textContent = 'Could not load the season data: ' + e.message; return; }
  $('#load').hidden = true;
  audit('auth.sign_in', me().name, 'Demo tenant sign-in (' + me().group + ')');
  const h = location.hash.slice(1).split('.'); route(h[0] || 'home', h.slice(1).join('.') || null);
  window.addEventListener('popstate', () => { const x = location.hash.slice(1).split('.'); route(x[0] || 'home', x.slice(1).join('.') || null); });
  if (typeof copInit === 'function') copInit();
  // capabilities light up when the viewer grants them; the console works without any of them
  if (window.claude && window.claude.use) {
    window.claude.use('sample').then((s) => { if (s) { AI.sample = s; AI.on = true; $('#cop-mode').textContent = 'Claude'; drawNav(); } }).catch(() => {});
    window.claude.use('downloads').then((d) => { DL = d; }).catch(() => {});
    window.claude.use('db').then((db) => { if (db) { STORE.db = db; STORE.mode = 'db'; drawNav(); } }).catch(() => {});
  }
}
