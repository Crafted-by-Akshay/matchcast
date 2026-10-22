// ===================================================================================================
// 30_gov.js: AI agents and Governance pages: agents (Agent operations), reports (Reports & approvals),
// audit (Audit log), catalogue (Data catalogue). Prefix gv_.
// ===================================================================================================
const gv_S = {
  ag: { sel: 'c-verifier', mid: null, pipe: null, runSort: {} },
  rp: { tab: 'library', status: 'all', sort: { k: 'at', dir: 'desc' }, edit: false, cache: null, sch: null },
  au: { tab: 'session', act: '', out: '', actor: '', verify: null, tamper: null, sel: null, org: null },
  ct: { ds: 'matches' },
};
const gv_el = {};
const gv_sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gv_t = (iso) => { if (!iso) return '–'; const d = new Date(iso); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const gv_ts = (iso) => { if (!iso) return '–'; const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0'); };
const gv_safe = (title, f) => { try { return f(); } catch (e) { console.error(e); return card(title, '', '<div class="empty">This panel could not be drawn: ' + esc(e.message) + '</div>'); } };
const gv_bindGo = (root) => root.querySelectorAll('[data-go]').forEach((b) => { if (!b.onclick) b.onclick = () => { const [p, a] = b.dataset.go.split('.'); go(p, a); }; });
const gv_lastMatch = () => D.matches.filter((m) => !m.imported).slice(-1)[0] || D.matches[D.matches.length - 1];
const gv_ourMatch = () => D.matches.filter((m) => m.home === 'HAR' || m.away === 'HAR').slice(-1)[0] || gv_lastMatch();

(function gv_css() {
  const s = document.createElement('style');
  s.textContent = `
.gv-lane{margin-bottom:14px}.gv-lane:last-child{margin-bottom:0}
.gv-lane-h{display:flex;align-items:center;gap:8px;font:600 10.5px var(--f-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.gv-flow{display:flex;align-items:stretch;gap:0}
.gv-node{flex:1 1 0;min-width:0;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:9px 10px;text-align:left;display:flex;flex-direction:column;gap:3px}
.gv-node.ag{background:var(--surface);border-color:var(--line-2);cursor:pointer}
.gv-node.ag:hover{border-color:var(--accent)}
.gv-node.sel{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft);background:var(--accent-soft)}
.gv-node .n{font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px}
.gv-node .n i{width:8px;height:8px;border-radius:50%;flex:none}
.gv-node .r{font-size:11.5px;color:var(--muted);line-height:1.35}
.gv-node .m{font:600 11px var(--f-mono);color:var(--ink-2);margin-top:auto}
.gv-node.ep{border-style:dashed}
.gv-arr{flex:none;width:22px;display:grid;place-items:center;color:var(--muted);font-size:14px}
.gv-par{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:6px}
.gv-par .gv-node{flex:1}
@media (max-width:760px){.gv-flow{flex-direction:column}.gv-arr{width:auto;height:18px}.gv-arr span{display:inline-block;transform:rotate(90deg)}.gv-par{flex-direction:row}}
.gv-steps{display:flex;flex-direction:column;gap:10px}
.gv-step{border:1px solid var(--line);border-radius:8px;padding:10px 12px;background:var(--surface)}
.gv-step.run{border-color:var(--info)}
.gv-step-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.gv-step-h b{font-size:13.5px}
.gv-step-h .ms{margin-left:auto;font:500 11.5px var(--f-mono);color:var(--muted)}
.gv-num{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--surface-3);font:600 11px var(--f-mono);flex:none}
.gv-step.done .gv-num{background:var(--good-soft);color:var(--good)}
.gv-step.run .gv-num{background:var(--info-soft);color:var(--info)}
.gv-find{border-top:1px solid var(--line);padding:8px 0 2px;margin-top:8px;font-size:13px}
.gv-find:first-of-type{margin-top:6px}
.gv-chk{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr) auto;gap:2px 10px;font:12px/1.5 var(--f-mono);margin-top:6px;color:var(--ink-2)}
.gv-chk>div{min-width:0;overflow-wrap:anywhere}
.gv-cmp{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 12px;font:12px/1.5 var(--f-mono);margin-top:6px;color:var(--ink-2)}.gv-cmp>div{min-width:0;overflow-wrap:anywhere}.gv-cmp .h{color:var(--muted);font-size:10.5px;text-transform:uppercase;letter-spacing:.06em}
.gv-chk .h{color:var(--muted);font-size:10.5px;text-transform:uppercase;letter-spacing:.06em}
.gv-para{background:var(--surface-2);border-radius:6px;padding:10px 12px;font-size:13.5px;line-height:1.55;margin-top:8px}
.gv-banner{display:flex;gap:10px;align-items:flex-start;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:12px}
.gv-banner.ok{background:var(--good-soft);color:var(--good)}.gv-banner.bad{background:var(--bad-soft);color:var(--bad)}.gv-banner.info{background:var(--info-soft);color:var(--info)}.gv-banner.warn{background:var(--warn-soft);color:var(--warn)}
.gv-banner b{color:inherit}.gv-banner .note{color:inherit;opacity:.85}
.gv-hash{font:500 11.5px var(--f-mono);color:var(--muted)}
.gv-md{font-size:14px;line-height:1.6;color:var(--ink);max-width:78ch;overflow-wrap:anywhere}
.gv-md h1{font:700 26px/1.15 var(--f-disp);margin:0 0 8px;letter-spacing:.01em}
.gv-md h2{font:600 16px/1.3 var(--f-body);margin:20px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--line)}
.gv-md h3{font:600 14px/1.3 var(--f-body);margin:14px 0 4px}
.gv-md p{margin:6px 0}.gv-md ul,.gv-md ol{margin:6px 0;padding-left:22px}.gv-md li{margin:2px 0}
.gv-md code{font:12.5px var(--f-mono);background:var(--surface-2);padding:1px 5px;border-radius:4px}
.gv-md blockquote{margin:8px 0;padding:6px 12px;border-left:3px solid var(--accent);background:var(--surface-2);color:var(--ink-2);border-radius:0 6px 6px 0}
.gv-md hr{border:0;border-top:1px solid var(--line);margin:14px 0}
.gv-md table{border-collapse:collapse;font-size:13px;margin:8px 0;font-variant-numeric:tabular-nums;width:auto;max-width:100%}
.gv-md th,.gv-md td{border-bottom:1px solid var(--line);padding:5px 10px;text-align:left}
.gv-md th{font:600 10.5px var(--f-mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);border-bottom-color:var(--line-2)}
.gv-md .mdt{overflow-x:auto;max-width:100%}
.gv-prov{margin-top:18px;border-top:1px dashed var(--line-2);padding-top:10px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 14px;font-size:12px;color:var(--muted)}
.gv-prov dd{margin:0;color:var(--ink-2);font-family:var(--f-mono);overflow-wrap:anywhere}
.gv-hist{display:flex;flex-direction:column;gap:0}
.gv-hist .e{display:grid;grid-template-columns:12px minmax(0,1fr);gap:10px;padding:6px 0;font-size:12.5px}
.gv-hist .e i{width:10px;height:10px;border-radius:50%;background:var(--line-2);margin-top:4px}
.gv-hist .e.good i{background:var(--good)}.gv-hist .e.bad i{background:var(--bad)}.gv-hist .e.info i{background:var(--info)}
.gv-hist .e .s{color:var(--muted);font-size:11.5px}
.gv-tpl{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.gv-tpl .card{display:flex;flex-direction:column;gap:6px}
.gv-tpl ul{margin:0;padding-left:18px;font-size:12px;color:var(--muted)}
.gv-ds{display:flex;flex-direction:column;gap:4px}
.gv-ds button{display:flex;justify-content:space-between;gap:8px;align-items:center;text-align:left;background:none;border:1px solid transparent;border-radius:6px;padding:8px 10px;font-size:13px;color:var(--ink-2)}
.gv-ds button:hover{background:var(--surface-2)}
.gv-ds button[aria-pressed="true"]{background:var(--accent-soft);border-color:var(--accent);color:var(--ink);font-weight:600}
.gv-ds .c{font:500 11.5px var(--f-mono);color:var(--muted)}
.gv-q{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--line);font-size:13px}
.gv-q:first-child{border-top:0}
.gv-q .d{font-size:12px;color:var(--muted)}
.gv-lin{min-width:640px}
.gv-lin .nd rect{fill:var(--surface);stroke:var(--line-2)}
.gv-lin .nd.hi rect{fill:var(--accent-soft);stroke:var(--accent)}
.gv-lin .nd.pl rect{fill:var(--surface-2);stroke:var(--line-2);stroke-dasharray:4 3}
.gv-lin text{font-family:var(--f-body);font-size:12px;fill:var(--ink)}
.gv-lin text.s{font-size:10px;fill:var(--muted)}
.gv-lin text.lane{font:600 10px var(--f-mono);letter-spacing:.1em;fill:var(--muted)}
.gv-lin .ar{stroke:var(--muted);stroke-width:1.4;fill:none}
.gv-lin .ar.pl{stroke-dasharray:4 3}
.gv-lin .ah{fill:var(--muted)}
.gv-rel .dg{stroke:var(--line-2);stroke-dasharray:4 3}
.gv-rel .pt{fill:var(--accent);fill-opacity:.75;stroke:var(--surface);stroke-width:1.5}
.gv-rel .ln{stroke:var(--accent);stroke-width:1.5;fill:none}
.gv-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.gv-kpis3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:10px}
.gv-kpis3 .kpi .v{font-size:24px}
.gv-actrow{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.gv-mute{color:var(--muted)}
.gv-s3{grid-column:span 3;min-width:0}.gv-s9{grid-column:span 9;min-width:0}@media (max-width:1100px){.gv-s3,.gv-s9{grid-column:span 12}.gv-ds{flex-direction:row;flex-wrap:wrap}}
.gv-trunc{max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:640px){.gv-kpis3{grid-template-columns:minmax(0,1fr)}.gv-chk{grid-template-columns:minmax(0,1fr) 4.2rem 4.2rem 1rem;font-size:11.5px}}
`;
  document.head.appendChild(s);
})();

// ===================================================================================================
// AGENT OPERATIONS
// ===================================================================================================
const gv_RT_C = 'Demo: Claude via artifact sampling when granted, rules otherwise · Production: Azure AI Foundry Agent Service';
const gv_RT_M = 'Runs inside the MatchCast simulator';
const gv_AGS = [
  { id: 'm-narrator', lane: 'match', name: 'Narrator', ins: 'Narrator', color: 'var(--info)', role: 'Calls key moments as they happen: goals, pressing spells and momentum swings.',
    inputs: 'Live event stream (passes, turnovers, shots, goals) in a rolling window', outputs: '“insight” events (kind moment) for the broadcast feed',
    tools: 'Event window, momentum model, phrase templates', guard: 'Speaks only about events present in the stream. Every line gets a Verifier verdict before it reaches the feed.',
    hitl: 'Lines marked review or rejected are held back from the feed and listed for the analyst after the match.' },
  { id: 'm-analyst', lane: 'match', name: 'Analyst', ins: 'Analyst', color: 'var(--accent)', role: 'Explains tactical patterns in-match: shape changes, overloads and pressing triggers.',
    inputs: 'Formations, tracking frames, team metrics (PPDA, high regains, final-third entries)', outputs: '“insight” events (kind tactical) with a verdict',
    tools: 'Team metrics window, formation detector', guard: 'Claims must reference a metric that moved in the last 10 minutes; Verifier rejects anything it cannot recompute.',
    hitl: 'Analysts can promote a review insight into a report after the match.' },
  { id: 'm-predictor', lane: 'match', name: 'Predictor', ins: 'Predictor', color: 'var(--warn)', role: 'Makes short-horizon, probabilistic calls (next goal, danger zone, key player, card, substitution, tactical change) and settles each one.',
    inputs: 'Match state, xG flow, stamina, formations, discipline', outputs: '“prediction” events {p, horizon} and “prediction_result” events {happened}',
    tools: 'Hazard model, horizon timer, settlement rules', guard: 'Every call carries a probability and a horizon, is settled automatically and is scored (Brier). No call is shown without a probability.',
    hitl: 'Calibration is reviewed on this page; an admin can switch off a prediction kind that drifts.' },
  { id: 'm-verifier', lane: 'match', name: 'Verifier', ins: 'Verifier', color: 'var(--good)', role: 'Checks the simulation and every agent output against the laws of the game and physics.',
    inputs: 'Tracking frames, events, agent insights and predictions', outputs: 'Per-match check counts (m.verifier), “verifier_flag” events, insight verdicts',
    tools: '14 rule checks: restarts, ball out, throw placement, players on the pitch, motion limits, referee position, prediction settlement…', guard: 'A match below a 99% pass rate is quarantined from reports and agents.',
    hitl: 'Each flag is listed in the Data catalogue for a human to inspect.' },
  { id: 'c-analyst', lane: 'console', key: 'analyst', name: 'Analyst', role: AGENTS.analyst.role + '.',
    inputs: 'An analyst’s question plus season JSON (table, team and player stats)', outputs: 'A short grounded answer with its tool-call trace',
    tools: 'season_table, team_stats, player_stats, match_events (page tools exposed to the model)', guard: 'Every number in an answer must appear in the data it used (grounding check). Rules answer when Claude is not granted.',
    hitl: 'Answers are advisory. Anything shared outside the department goes through Reports & approvals.' },
  { id: 'c-scout', lane: 'console', key: 'scout', name: 'Scout', role: AGENTS.scout.role + ' against position-group percentiles.',
    inputs: 'Player criteria (position, metrics, club)', outputs: 'Shortlists and side-by-side comparisons',
    tools: 'player_search, compare_players, percentile ranks', guard: 'Only players in the tenant dataset; numbers grounded against the season aggregates.',
    hitl: 'A scout saves the shortlist; the head coach signs off any approach.' },
  { id: 'c-writer', lane: 'console', key: 'writer', name: 'Report writer', role: AGENTS.writer.role + '.',
    inputs: 'Verified findings and approved numbers', outputs: 'Report drafts in markdown',
    tools: 'Report templates, approved-number store', guard: 'Writes only from verified findings. Claims the Verifier sent to review are held back and named.',
    hitl: 'Every draft needs approval from someone other than its author (separation of duties).' },
  { id: 'c-verifier', lane: 'console', key: 'verifier', name: 'Verifier', role: AGENTS.verifier.role + '.',
    inputs: 'Agent drafts and the raw match events', outputs: 'A pass or review verdict per claim, with the check it ran',
    tools: 'ground() number check, independent recount from raw events, rating formula', guard: 'Blocks release of any claim it cannot reproduce from raw data.',
    hitl: 'Review verdicts go to the analyst; nothing is auto-published.' },
];
const gv_CHK = { ko: 'Kick-off restarts', half: 'Half-time handling', out: 'Ball out of play', throw: 'Throw-in placement', restart: 'Restart legality', goal: 'Goal validation', foul: 'Foul consistency', offside: 'Offside calls', refpos: 'Referee positioning', motion: 'Player motion limits', bodies: 'Body overlap', onpitch: 'Players on the pitch', vision: 'Player vision cone', pred: 'Prediction settlement' };
const gv_VCOL = { verified: 'var(--good)', review: 'var(--warn)', rejected: 'var(--bad)' };

let gv_agCache = null;
function gv_agStats() {
  if (gv_agCache && gv_agCache.n === D.matches.length) return gv_agCache;
  const ins = [], prr = [], perMatch = [], checks = {}, flags = {};
  for (const m of D.matches) {
    for (const e of m.events || []) {
      if (e.type === 'insight') ins.push(Object.assign({ match: m.id }, e));
      else if (e.type === 'prediction_result') prr.push(Object.assign({ match: m.id }, e));
      else if (e.type === 'verifier_flag') flags[e.check] = (flags[e.check] || 0) + 1;
    }
    const v = m.verifier || {}; let p = 0, f = 0;
    for (const c of v.checks || []) { const a = checks[c.id] || (checks[c.id] = { id: c.id, passed: 0, failed: 0 }); a.passed += c.passed; a.failed += c.failed; p += c.passed; f += c.failed; }
    perMatch.push({ id: m.id, md: m.matchday, title: m.title, rate: v.passRatePct ?? (p + f ? (100 * p) / (p + f) : 100), passed: p, failed: f });
  }
  const agents = ['Narrator', 'Analyst', 'Predictor']; for (const e of ins) if (e.agent && !agents.includes(e.agent)) agents.push(e.agent);
  const byAg = agents.map((a) => { const l = ins.filter((e) => e.agent === a); return { agent: a, n: l.length, verified: l.filter((e) => e.status === 'verified').length, review: l.filter((e) => e.status === 'review').length, rejected: l.filter((e) => e.status === 'rejected').length }; });
  // calibration on settled predictions
  const pts = prr.filter((e) => typeof e.p === 'number').map((e) => ({ p: e.p, y: e.happened ? 1 : 0, kind: e.kind }));
  const brier = pts.length ? avg(pts, (x) => (x.p - x.y) ** 2) : null;
  const base = pts.length ? avg(pts, (x) => x.y) : 0;
  const ref = base * (1 - base);
  const bins = []; for (let i = 0; i < 10; i++) { const l = pts.filter((x) => (x.p >= i / 10 && x.p < (i + 1) / 10) || (i === 9 && x.p === 1)); if (l.length) bins.push({ lo: i / 10, hi: (i + 1) / 10, n: l.length, mp: avg(l, (x) => x.p), obs: avg(l, (x) => x.y) }); }
  const kinds = [...new Set(pts.map((x) => x.kind))].map((k) => { const l = pts.filter((x) => x.kind === k); return { kind: k, n: l.length, mp: avg(l, (x) => x.p), obs: avg(l, (x) => x.y), brier: avg(l, (x) => (x.p - x.y) ** 2) }; }).sort((a, b) => b.n - a.n);
  const totP = sum(Object.values(checks), (c) => c.passed), totF = sum(Object.values(checks), (c) => c.failed);
  return (gv_agCache = { n: D.matches.length, ins, byAg, prr, pts, brier, base, ref, bss: ref ? 1 - brier / ref : null, bins, kinds, perMatch, checks: Object.values(checks), flags, totP, totF, nPred: sum(D.matches, (m) => (m.events || []).filter((e) => e.type === 'prediction').length) });
}
function gv_agMetric(a, st) {
  if (a.lane === 'match') {
    if (a.ins === 'Verifier') return fmt((100 * st.totP) / Math.max(1, st.totP + st.totF), 2) + '% checks pass';
    if (a.ins === 'Predictor') return fmt(st.nPred) + ' calls · Brier ' + (st.brier == null ? '–' : fmt(st.brier, 3));
    const b = st.byAg.find((x) => x.agent === a.ins); return b && b.n ? fmt(b.n) + ' insights · ' + pct(b.verified, b.n) + '% verified' : 'No insights in this data version';
  }
  const r = AI.runs.filter((x) => x.agent === a.key); return r.length ? r.length + ' run' + (r.length > 1 ? 's' : '') + ' this session' : 'No runs yet this session';
}
function gv_runStats() {
  const runs = AI.runs; const ai = runs.filter((r) => r.src === 'ai'); const ms = runs.map((r) => r.ms || 0).sort((a, b) => a - b);
  return { n: runs.length, ai: ai.length, rules: runs.length - ai.length, grounded: ai.filter((r) => r.ground && r.ground.pass).length, avgMs: ms.length ? avg(ms) : 0, p95: ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.95))] : 0 };
}
function gv_node(a, st) {
  return '<button class="gv-node ag' + (gv_S.ag.sel === a.id ? ' sel' : '') + '" data-ag="' + a.id + '" aria-pressed="' + (gv_S.ag.sel === a.id) + '"><span class="n"><i style="background:' + (a.color || (a.key ? AGENTS[a.key].color : 'var(--accent)')) + '"></i>' + esc(a.name) + '</span><span class="r">' + esc(a.role.split(':')[0].split('.')[0]) + '</span><span class="m">' + esc(gv_agMetric(a, st)) + '</span></button>';
}
const gv_ep = (t, s) => '<div class="gv-node ep"><span class="n">' + esc(t) + '</span><span class="r">' + esc(s) + '</span></div>';
const gv_arr = '<div class="gv-arr" aria-hidden="true"><span>→</span></div>';
function gv_flow(st) {
  const A = Object.fromEntries(gv_AGS.map((a) => [a.id, a]));
  const lane1 = '<div class="gv-lane"><div class="gv-lane-h">' + chip('In-match', 'info') + ' Runs inside the MatchCast simulator, every 0.5 match minutes</div><div class="gv-flow">' +
    gv_ep('Event stream', 'Events + tracking frames') + gv_arr + '<div class="gv-par">' + gv_node(A['m-narrator'], st) + gv_node(A['m-analyst'], st) + '</div>' + gv_arr + gv_node(A['m-predictor'], st) + gv_arr + gv_node(A['m-verifier'], st) + gv_arr + gv_ep('Insight feed', 'Watch app + match data') + '</div></div>';
  const lane2 = '<div class="gv-lane"><div class="gv-lane-h">' + chip('Console', 'acc') + ' Runs in this console on request · production target Azure AI Foundry</div><div class="gv-flow">' +
    gv_ep('Analyst request', 'Copilot, pages, schedules') + gv_arr + '<div class="gv-par">' + gv_node(A['c-analyst'], st) + gv_node(A['c-scout'], st) + '</div>' + gv_arr + gv_node(A['c-verifier'], st) + gv_arr + gv_node(A['c-writer'], st) + gv_arr + gv_ep('Human approval', 'Reports & approvals, then publish') + '</div></div>';
  return lane1 + lane2;
}
function gv_agDetail(st) {
  const a = gv_AGS.find((x) => x.id === gv_S.ag.sel) || gv_AGS[0];
  const kv = [['Role', esc(a.role)], ['Inputs', esc(a.inputs)], ['Outputs', esc(a.outputs)], ['Tools', esc(a.tools)], ['Guardrails', esc(a.guard)], ['Human in the loop', esc(a.hitl)], ['Runtime', esc(a.lane === 'match' ? gv_RT_M : gv_RT_C)], ['Live metric', '<b>' + esc(gv_agMetric(a, st)) + '</b>']];
  return card(esc(a.name) + ' ' + chip(a.lane === 'match' ? 'In-match agent' : 'Console agent', a.lane === 'match' ? 'info' : 'acc'), 'Select any agent in the pipeline to see its contract.',
    '<dl class="kv">' + kv.map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('') + '</dl>');
}
function gv_roster(st) {
  const rows = gv_AGS.map((a) => ({ a, name: a.name, lane: a.lane, metric: gv_agMetric(a, st) }));
  return card('Agent roster', 'Eight agents in two lanes. Click a row to open its contract.', tbl([
    { k: 'name', l: 'Agent', f: (r) => '<b>' + esc(r.name) + '</b>' },
    { k: 'lane', l: 'Lane', f: (r) => chip(r.lane === 'match' ? 'In-match' : 'Console', r.lane === 'match' ? 'info' : 'acc') },
    { k: 'hitl', l: 'Human checkpoint', cls: 'wrap', f: (r) => '<span class="sub">' + esc(r.a.hitl.split('.')[0]) + '</span>' },
    { k: 'metric', l: 'Live metric', f: (r) => '<span class="num">' + esc(r.metric) + '</span>' },
  ], rows, { id: 'gv-roster', click: true, key: (r) => r.a.id, sel: (r) => r.a.id === gv_S.ag.sel }));
}
function gv_relChart(st) {
  const W = 340, H = 280, L = 40, R = 12, T = 12, B = 34, X = (v) => L + v * (W - L - R), Y = (v) => T + (1 - v) * (H - T - B);
  let s = '<svg class="gv-rel" viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:420px;display:block;height:auto;margin:0 auto" role="img" aria-label="Reliability diagram">';
  for (let i = 0; i <= 4; i++) { const v = i / 4; s += '<line class="gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="ax" x="' + (L - 5) + '" y="' + (Y(v) + 3) + '" text-anchor="end">' + v.toFixed(2) + '</text><text class="ax" x="' + X(v) + '" y="' + (H - 18) + '" text-anchor="middle">' + v.toFixed(2) + '</text>'; }
  s += '<line class="dg" x1="' + X(0) + '" y1="' + Y(0) + '" x2="' + X(1) + '" y2="' + Y(1) + '"/>';
  s += '<text class="ax" x="' + ((L + W - R) / 2) + '" y="' + (H - 3) + '" text-anchor="middle">Predicted probability</text><text class="ax" x="' + L + '" y="' + (T - 2) + '">Observed frequency</text>';
  if (st.bins.length > 1) s += '<path class="ln" d="' + st.bins.map((b, i) => (i ? 'L' : 'M') + X(b.mp).toFixed(1) + ',' + Y(b.obs).toFixed(1)).join('') + '"/>';
  const mx = Math.max(1, ...st.bins.map((b) => b.n));
  for (const b of st.bins) s += '<circle class="pt" cx="' + X(b.mp).toFixed(1) + '" cy="' + Y(b.obs).toFixed(1) + '" r="' + (3 + 9 * Math.sqrt(b.n / mx)).toFixed(1) + '"><title>p ' + b.lo.toFixed(1) + '–' + b.hi.toFixed(1) + ': ' + b.n + ' calls, mean predicted ' + (b.mp * 100).toFixed(1) + '%, happened ' + (b.obs * 100).toFixed(1) + '%</title></circle>';
  return s + '</svg>';
}
// ---- the pipeline demo: Analyst drafts → Verifier recomputes from raw events → Writer composes
function gv_findings(m) {
  const H = m.home, A = m.away, th = m.ts[H], ta = m.ts[A];
  const lines = Object.values(m.pm).sort((a, b) => b.rating - a.rating || b.done - a.done);
  const top = lines[0];
  const ph = pct(th.done, th.passes), pa = pct(ta.done, ta.passes); const ctl = ph >= pa ? H : A, oth = ctl === H ? A : H; const tc = m.ts[ctl], to = m.ts[oth];
  const res = m.score[0] > m.score[1] ? clubName(H) + ' beat ' + clubName(A) + ' ' + m.score[0] + '–' + m.score[1] : m.score[0] < m.score[1] ? clubName(A) + ' won ' + m.score[1] + '–' + m.score[0] + ' at ' + clubName(H) : clubName(H) + ' and ' + clubName(A) + ' drew ' + m.score[0] + '–' + m.score[1];
  return [
    { id: 'F1', title: 'Result against chances', text: res + ', with expected goals of ' + fmt(th.xg, 2) + ' to ' + fmt(ta.xg, 2) + '.', claim: { goals: [th.goals, ta.goals], xg: [th.xg, ta.xg] }, src: 'm.ts (engine stats)' },
    top ? { id: 'F2', title: 'Top performer', text: top.name + ' (' + clubName(top.team) + ') had the best match rating, ' + fmt(top.rating, 1) + ': ' + top.done + '/' + top.passes + ' passes, ' + top.goals + ' goal' + (top.goals === 1 ? '' : 's') + ', ' + fmt(top.xg, 2) + ' xG, ' + top.wins + ' ball wins.', claim: { name: top.name, rating: top.rating, goals: top.goals }, src: 'm.pm (player lines)' } : null,
    { id: 'F3', title: 'Control and press', text: clubName(ctl) + ' kept the ball better: ' + pct(tc.done, tc.passes) + '% pass completion (' + tc.done + '/' + tc.passes + ') against ' + pct(to.done, to.passes) + '%, and won ' + tc.highWins + ' high turnovers to ' + to.highWins + '.', claim: { team: ctl, other: oth, passes: tc.passes, done: tc.done, pcO: pct(to.done, to.passes), high: [tc.highWins, to.highWins] }, src: 'm.ts (derived team stats)' },
  ].filter(Boolean);
}
function gv_verify(m, f) {
  const ev = m.events || []; const rows = []; let ok = true;
  const row = (what, claimed, found, pass) => { rows.push({ what, claimed, found, pass }); if (!pass) ok = false; };
  if (f.id === 'F1') {
    [m.home, m.away].forEach((k, i) => { const g = ev.filter((e) => e.type === 'goal' && e.team === k).length; row('Goals ' + k + ' (count goal events)', f.claim.goals[i], g, g === f.claim.goals[i]); });
    [m.home, m.away].forEach((k, i) => { const x = +sum(ev.filter((e) => e.type === 'shot' && e.team === k), (e) => e.xg).toFixed(2); const tol = Math.max(0.1, 0.1 * f.claim.xg[i]); row('xG ' + k + ' (sum shot.xg, ±' + tol.toFixed(2) + ')', fmt(f.claim.xg[i], 2), fmt(x, 2), Math.abs(x - f.claim.xg[i]) <= tol); });
    return { ok, rows, method: 'Recount goals and re-sum shot xG from the raw event stream, independent of the engine totals.' };
  }
  if (f.id === 'F2') {
    const n = f.claim.name; const t = ((m.sum || {}).playerTracking || []).find((x) => x.name === n) || {};
    const goals = ev.filter((e) => e.type === 'goal' && e.player === n && !e.ownGoal).length; const xg = sum(ev.filter((e) => e.type === 'shot' && e.player === n), (e) => e.xg);
    const wins = ev.filter((e) => e.type === 'turnover' && e.player === n).length; const tkw = ev.filter((e) => e.type === 'take_on' && e.player === n && e.success).length; const fouls = ev.filter((e) => e.type === 'foul' && e.player === n).length;
    const pc = t.passesCompleted || 0, pa = t.passesAttempted || 0;
    const r = +clamp(6 + 0.03 * pc - 0.05 * (pa - pc) + 1.1 * goals + 1.6 * xg + 0.25 * (t.tackles || 0) + 0.12 * wins + 0.15 * tkw - 0.1 * fouls, 3, 10).toFixed(1);
    row('Rating (formula on raw events + tracking)', fmt(f.claim.rating, 1), fmt(r, 1), Math.abs(r - f.claim.rating) < 0.05);
    row('Goals (goal events, own goals excluded)', f.claim.goals, goals, goals === f.claim.goals);
    const best = Math.max(...Object.values(m.pm).map((x) => x.rating)); row('Highest rating in the match', fmt(f.claim.rating, 1), fmt(best, 1), best === f.claim.rating);
    return { ok, rows, method: 'Recompute the rating with the published formula from raw events and tracking, and confirm no player rated higher.' };
  }
  const k = f.claim.team; const att = ev.filter((e) => e.type === 'pass' && e.team === k).length;
  const done = sum(((m.sum || {}).playerTracking || []).filter((t) => t.team === k), (t) => t.passesCompleted);
  const pcr = att ? (100 * done) / att : 0; const pcc = (100 * f.claim.done) / Math.max(1, f.claim.passes);
  row('Passes attempted (count pass events)', f.claim.passes, att, att === f.claim.passes);
  row('Completion % (tracking, ±1 pt)', fmt(pcc, 1) + '%', fmt(pcr, 1) + '%', Math.abs(pcr - pcc) <= 1);
  const hw = [k, f.claim.other].map((t) => ev.filter((e) => e.type === 'turnover' && e.team === t && (e.ax ?? 0) > 70).length);
  row('High turnovers (turnover, ax > 70)', f.claim.high.join('–'), hw.join('–'), hw[0] === f.claim.high[0] && hw[1] === f.claim.high[1]);
  return { ok, rows, method: 'Recount pass and turnover events and re-sum completed passes from player tracking.' };
}
async function gv_runPipe(root) {
  if (!gate('ask', 'Run agent pipeline')) return;
  const m = D.match(gv_S.ag.mid) || gv_lastMatch(); if (!m) return;
  const P = (gv_S.ag.pipe = { mid: m.id, title: m.title, steps: [], running: true, t0: performance.now() });
  const draw = () => { const box = root.querySelector('#gv-pipe-out'); if (box) box.innerHTML = gv_pipeHtml(); const b = root.querySelector('#gv-pipe-save'); if (b) b.onclick = () => gv_pipeSave(); };
  audit('agent.pipeline', m.id, 'Pipeline started on ' + m.title + ' (Analyst → Verifier → Report writer)');
  // 1 Analyst
  P.steps.push({ n: 1, agent: 'Analyst', title: 'Drafts three findings from derived metrics', state: 'run' }); draw(); await gv_sleep(380);
  let t = performance.now(); const fs = gv_findings(m); const ms1 = performance.now() - t;
  Object.assign(P.steps[0], { state: 'done', ms: ms1, finds: fs });
  const r1 = { id: 'run-' + (AI.runs.length + 1), agent: 'analyst', q: 'Pipeline · draft 3 findings for ' + m.id, at: new Date().toISOString(), steps: ['team_stats(' + m.id + ')', 'player_lines(' + m.id + ')'], user: me().name, src: 'rules', ms: Math.max(1, Math.round(ms1)), ground: { n: 0, ok: 0, bad: [], pass: true, rule: true }, text: fs.map((f) => f.text).join(' ') };
  AI.runs.unshift(r1); audit('agent.run', 'Analyst', 'rules · pipeline findings drafted for ' + m.id + ' (' + fs.length + ')');
  draw(); await gv_sleep(380);
  // 2 Verifier
  P.steps.push({ n: 2, agent: 'Verifier', title: 'Recomputes every claim from the raw event stream', state: 'run' }); draw(); await gv_sleep(420);
  t = performance.now(); const vs = fs.map((f) => Object.assign({ f }, gv_verify(m, f))); const ms2 = performance.now() - t;
  const okN = vs.filter((v) => v.ok).length;
  Object.assign(P.steps[1], { state: 'done', ms: ms2, ver: vs });
  AI.runs.unshift({ id: 'run-' + (AI.runs.length + 1), agent: 'verifier', q: 'Pipeline · verify ' + fs.length + ' findings for ' + m.id, at: new Date().toISOString(), steps: vs.map((v) => 'recount(' + v.f.id + ')'), user: me().name, src: 'rules', ms: Math.max(1, Math.round(ms2)), ground: { n: fs.length, ok: okN, bad: vs.filter((v) => !v.ok).map((v) => v.f.id), pass: okN === fs.length, rule: true }, text: okN + '/' + fs.length + ' passed' });
  audit('agent.verify', m.id, okN + '/' + fs.length + ' findings reproduced from raw events' + (okN < fs.length ? ' · ' + vs.filter((v) => !v.ok).map((v) => v.f.id).join(', ') + ' sent to review' : ''), okN === fs.length ? 'ok' : 'flagged');
  draw(); await gv_sleep(380);
  // 3 Writer (Claude when granted, rules otherwise)
  P.steps.push({ n: 3, agent: 'Report writer', title: 'Composes a paragraph from verified findings only', state: 'run' }); draw();
  const ver = vs.filter((v) => v.ok).map((v) => v.f), held = vs.filter((v) => !v.ok).map((v) => v.f);
  const rules = () => (ver.length ? ver.map((f) => f.text).join(' ') : 'No finding could be reproduced from the raw events, so there is nothing to publish yet.') + (held.length ? ' ' + held.length + ' further claim' + (held.length > 1 ? 's are' : ' is') + ' held for analyst review (' + held.map((f) => f.title.toLowerCase()).join(', ') + ').' : '');
  const run = await askAgent({ agent: 'writer', q: 'Write one post-match paragraph for ' + m.title + ' using only the verified findings.', ctx: { match: { id: m.id, home: clubName(m.home), away: clubName(m.away), score: m.score, date: m.date }, verified: ver.map((f) => ({ title: f.title, text: f.text, claim: f.claim })), heldForReview: held.map((f) => f.title) }, rules });
  Object.assign(P.steps[2], { state: 'done', ms: run.ms, run });
  P.running = false; P.total = performance.now() - P.t0; P.ok = okN; P.n = fs.length; P.para = run.text;
  draw();
}
function gv_pipeHtml() {
  const P = gv_S.ag.pipe; if (!P) return '<div class="empty">Pick a match and run the pipeline. Each agent’s output, checks and timings appear here, and every step is written to the audit log.</div>';
  const st = P.steps.map((s) => {
    let body = '';
    if (s.finds) body = s.finds.map((f) => '<div class="gv-find"><div class="gv-row">' + chip(f.id) + '<b>' + esc(f.title) + '</b><span class="note">from ' + esc(f.src) + '</span></div><div style="margin-top:4px">' + esc(f.text) + '</div></div>').join('');
    if (s.ver) body = s.ver.map((v) => '<div class="gv-find"><div class="gv-row">' + chip(v.f.id) + '<b>' + esc(v.f.title) + '</b>' + (v.ok ? chip('✓ Reproduced', 'good') : chip('Sent to review', 'warn')) + '</div><div class="note" style="margin-top:3px">' + esc(v.method) + '</div><div class="gv-chk"><div class="h">Check</div><div class="h">Claim</div><div class="h">Recount</div><div class="h"></div>' +
      v.rows.map((r) => '<div>' + esc(r.what) + '</div><div>' + esc(r.claimed) + '</div><div>' + esc(r.found) + '</div><div>' + (r.pass ? '<span style="color:var(--good)">✓</span>' : '<span style="color:var(--warn)">≠</span>') + '</div>').join('') + '</div></div>').join('');
    if (s.run) body = '<div class="gv-para">' + esc(s.run.text) + '</div><div class="gv-row" style="margin-top:6px">' + chip(s.run.src === 'ai' ? 'Claude' : 'Rules', s.run.src === 'ai' ? 'acc' : '') + (s.run.ground && s.run.ground.rule ? chip('✓ Verified sentences only', 'good') + '<span class="note">Rules output reuses the reproduced findings word for word.</span>' : groundChip(s.run.ground)) + '</div>';
    return '<div class="gv-step ' + s.state + '"><div class="gv-step-h"><span class="gv-num">' + s.n + '</span><b>' + esc(s.agent) + '</b><span class="note">' + esc(s.title) + '</span><span class="ms">' + (s.state === 'run' ? 'running…' : fmt(s.ms, s.ms < 10 ? 1 : 0) + ' ms') + '</span></div>' + body + '</div>';
  }).join('');
  const done = !P.running && P.steps.length === 3;
  const foot = done ? '<div class="gv-step done"><div class="gv-step-h"><span class="gv-num">4</span><b>Human in the loop</b><span class="note">Nothing is published by an agent. Save the result as a draft; an approver who did not author it signs it off.</span><span class="ms">total ' + fmt(P.total) + ' ms</span></div><div class="gv-actrow"><button class="btn pri" id="gv-pipe-save">Save as draft report' + lockBtn('author') + '</button><button class="btn" data-go="reports">Open Reports & approvals</button><span class="note">' + P.ok + '/' + P.n + ' findings reproduced · logged in the audit chain</span></div></div>' : '';
  return '<div class="gv-steps">' + st + foot + '</div>';
}
async function gv_pipeSave() {
  if (!gate('author', 'Save pipeline output as report')) return;
  const P = gv_S.ag.pipe; const m = D.match(P.mid); if (!m) return;
  const vs = P.steps[1].ver || [];
  const extra = '\n## Agent pipeline findings\n\n' + vs.map((v) => '- **' + v.f.title + '** (' + (v.ok ? 'reproduced by Verifier' : 'held for review') + '): ' + v.f.text).join('\n') + '\n\n> ' + P.para + '\n';
  const r = await gv_saveReport(Object.assign(gv_genPost(m), { bodyExtra: extra, via: 'Agent pipeline (Analyst → Verifier → Report writer)' }));
  if (r) { toast('Draft saved: ' + r.title); go('reports', r.id); }
}
function gv_agRender(el) {
  gv_el.ag = el; const st = gv_agStats(); const rs = gv_runStats();
  if (!gv_S.ag.mid) gv_S.ag.mid = (gv_ourMatch() || {}).id;
  const insN = st.ins.length, insV = st.ins.filter((e) => e.status === 'verified').length;
  const vr = (100 * st.totP) / Math.max(1, st.totP + st.totF);
  const minRate = st.perMatch.length ? Math.min(...st.perMatch.map((x) => x.rate)) : 100;
  let h = pgHead('Agent operations', 'Eight agents in two lanes: four run inside the simulator during every match, four run in this console on request. Every output is verified against the data, every run is audited, and a human approves anything that leaves the department.',
    '<button class="btn pri" id="gv-jump">Run the pipeline on a match</button><button class="btn" id="gv-runcsv">Export run log' + lockBtn('export') + '</button>');
  h += '<div class="kpis">' + kpi('In-match insights', fmt(insN), insN ? pct(insV, insN) + '% verified by the Verifier' : 'none in this data version') + kpi('Verifier pass rate', fmt(vr, 2) + '<small>%</small>', fmt(st.totP + st.totF) + ' checks · lowest match ' + fmt(minRate, 1) + '%', vr >= 99 ? 'good' : 'warn') +
    kpi('Predictions settled', fmt(st.pts.length), 'Brier ' + (st.brier == null ? '–' : fmt(st.brier, 3)) + (st.bss != null ? ' · skill ' + fmt(st.bss, 2) : '')) +
    kpi('Console runs', fmt(rs.n), rs.n ? rs.ai + ' Claude · ' + rs.rules + ' rules · avg ' + fmt(rs.avgMs) + ' ms' : 'this session') +
    kpi('Grounding pass', rs.ai ? pct(rs.grounded, rs.ai) + '<small>%</small>' : '–', rs.ai ? rs.grounded + '/' + rs.ai + ' Claude answers fully grounded' : 'Claude not granted here: rules answer', rs.ai && rs.grounded < rs.ai ? 'warn' : '') + '</div>';
  h += gv_safe('Pipeline', () => card('Agent pipeline', 'How work flows between agents. In-match agents write into the match data; console agents read it, check it and draft from it.', gv_flow(st)));
  h += '<div class="grid" style="margin-top:14px"><div class="s5">' + gv_safe('Agent', () => gv_agDetail(st)) + '</div><div class="s7">' + gv_safe('Roster', () => gv_roster(st)) + '</div></div>';
  // demo
  const opts = D.matches.slice().reverse().map((m) => '<option value="' + m.id + '"' + (m.id === gv_S.ag.mid ? ' selected' : '') + '>MD' + m.matchday + ' · ' + esc(m.title) + '</option>').join('');
  h += '<div style="margin-top:14px" id="gv-pipe">' + card('Run the pipeline on a match', 'Analyst drafts three findings from derived metrics, Verifier recomputes each from raw events, Report writer composes from the verified ones. Runs on ' + (AI.on ? 'Claude for the writer step' : 'rules (Claude not granted in this view)') + '.',
    '<div class="filters"><label class="field" style="flex:1;min-width:220px;max-width:460px">Match<select id="gv-mid">' + opts + '</select></label><button class="btn pri" id="gv-run"' + (gv_S.ag.pipe && gv_S.ag.pipe.running ? ' disabled' : '') + '>▶ Run pipeline' + lockBtn('ask') + '</button></div><div id="gv-pipe-out">' + gv_pipeHtml() + '</div>') + '</div>';
  // metrics
  h += '<div class="grid" style="margin-top:14px">';
  h += '<div class="s4">' + gv_safe('Insights', () => card('Insights by agent and verdict', 'In-match insight events across ' + D.matches.length + ' matches.',
    (insN ? barChart({ groups: st.byAg.map((b) => ({ label: b.agent, vals: [{ v: b.verified, color: gv_VCOL.verified, title: b.agent + ' verified: ' + b.verified }, { v: b.review, color: gv_VCOL.review, title: b.agent + ' review: ' + b.review }, { v: b.rejected, color: gv_VCOL.rejected, title: b.agent + ' rejected: ' + b.rejected }] })), stacked: true, w: 360, h: 210 }) : '<div class="empty">No insight events in this data version.</div>') +
    legend([['Verified', gv_VCOL.verified], ['Review', gv_VCOL.review], ['Rejected', gv_VCOL.rejected]]) +
    '<div class="note" style="margin-top:8px">' + st.byAg.map((b) => '<b>' + esc(b.agent) + '</b> ' + b.n + (b.n ? ' (' + pct(b.rejected, b.n) + '% rejected)' : '')).join(' · ') + '</div>')) + '</div>';
  h += '<div class="s8">' + gv_safe('Verifier', () => { const pm = st.perMatch; const lo = Math.max(0, Math.floor(Math.min(99, minRate) - 0.5));
    return card('Verifier pass rate per match', 'Share of rule checks passed in each match, in date order (m.verifier). Below 99% a match is quarantined from reports.',
      lineChart({ series: [{ name: 'Pass rate', color: 'var(--good)', pts: pm.map((x, i) => [i + 1, x.rate]), area: false }, { name: 'Threshold', color: 'var(--bad)', dash: true, pts: [[1, 99], [Math.max(2, pm.length), 99]] }], yMin: lo, yMax: 100, w: innerWidth < 700 ? 360 : 640, h: innerWidth < 700 ? 230 : 210, xMin: 1, xMax: Math.max(2, pm.length), xTicks: [1, Math.ceil(pm.length / 2), pm.length], xFmt: (v) => '#' + v, yFmt: (v) => v.toFixed(1) + '%', marks: pm.map((x, i) => ({ x: i + 1, y: x.rate, r: 3.5, color: x.rate >= 99 ? 'var(--good)' : 'var(--bad)', title: x.id + ' ' + x.title + ': ' + x.rate + '% (' + x.failed + ' failed of ' + (x.passed + x.failed) + ')' })) }) +
      legend([['Pass rate', 'var(--good)'], ['99% quarantine threshold', 'var(--bad)']]) + '<div class="note" style="margin-top:6px">' + pm.filter((x) => x.rate < 99).length + ' of ' + pm.length + ' matches below threshold · ' + fmt(st.totF) + ' failed checks in the season.</div>'); }) + '</div>';
  h += '<div class="s5">' + gv_safe('Calibration', () => card('Predictor calibration', 'Settled calls binned by predicted probability. On the dashed line, a 30% call happens 30% of the time.',
    (st.pts.length ? gv_relChart(st) : '<div class="empty">No settled predictions.</div>') +
    '<div class="gv-kpis3" style="margin-top:10px">' + kpi('Brier', st.brier == null ? '–' : fmt(st.brier, 3), 'lower is better') + kpi('Base rate', fmt(st.base * 100, 1) + '<small>%</small>', 'calls that happened') + kpi('Skill', st.bss == null ? '–' : fmt(st.bss, 2), 'vs always predicting base rate', st.bss > 0 ? 'good' : 'warn') + '</div>')) + '</div>';
  h += '<div class="s7">' + gv_safe('Kinds', () => card('Calibration by prediction kind', 'Brier = mean of (p − outcome)². Reference = base rate × (1 − base rate) = ' + fmt(st.ref, 3) + '.',
    tbl([{ k: 'kind', l: 'Kind', f: (r) => esc(String(r.kind).replace(/_/g, ' ')) }, { k: 'n', l: 'Calls', r: true }, { k: 'mp', l: 'Mean p', r: true, f: (r) => fmt(r.mp * 100, 1) + '%' }, { k: 'obs', l: 'Happened', r: true, f: (r) => fmt(r.obs * 100, 1) + '%' },
      { k: 'gap', l: 'Gap', r: true, v: (r) => Math.abs(r.mp - r.obs), f: (r) => { const g = (r.obs - r.mp) * 100; return '<span style="color:' + (Math.abs(g) > 10 ? 'var(--bad)' : 'var(--ink-2)') + '">' + (g > 0 ? '+' : '') + fmt(g, 1) + ' pt</span>'; } },
      { k: 'brier', l: 'Brier', r: true, f: (r) => fmt(r.brier, 3) }], st.kinds, { id: 'gv-kinds' }) +
    '<div class="note" style="margin-top:8px">Gap = observed minus predicted. A gap beyond ±10 points marks a kind for recalibration.</div>')) + '</div>';
  h += '<div class="s6">' + gv_safe('Checks', () => card('In-match Verifier checks, season total', 'Every rule the simulator Verifier runs, summed over all matches. Flags are raised as verifier_flag events.',
    tbl([{ k: 'id', l: 'Check', f: (r) => esc(gv_CHK[r.id] || r.id) + ' <span class="sub mono">' + esc(r.id) + '</span>' }, { k: 'passed', l: 'Passed', r: true, f: (r) => fmt(r.passed) }, { k: 'failed', l: 'Failed', r: true, f: (r) => (r.failed ? '<span style="color:var(--bad)">' + fmt(r.failed) + '</span>' : '0') },
      { k: 'rate', l: 'Pass', r: true, v: (r) => (r.passed + r.failed ? r.passed / (r.passed + r.failed) : 1), f: (r) => (r.passed + r.failed ? fmt((100 * r.passed) / (r.passed + r.failed), 2) + '%' : '<span class="sub">n/a</span>') }], st.checks.slice().sort((a, b) => b.failed - a.failed || b.passed - a.passed), { id: 'gv-checks' }))) + '</div>';
  h += '<div class="s6">' + gv_safe('Console', () => { const per = Object.keys(AGENTS).map((k) => { const l = AI.runs.filter((r) => r.agent === k); return { k, n: l.length, ms: l.length ? avg(l, (r) => r.ms) : 0 }; });
    return card('Console agent runs', 'This session’s runs from Copilot, pages and the pipeline (AI.runs).',
      (rs.n ? '<div class="gv-kpis3">' + kpi('Runs', fmt(rs.n), rs.ai + ' Claude · ' + rs.rules + ' rules') + kpi('Avg latency', fmt(rs.avgMs) + '<small>ms</small>', 'p95 ' + fmt(rs.p95) + ' ms') + kpi('Grounded', rs.ai ? pct(rs.grounded, rs.ai) + '%' : 'n/a', rs.ai ? rs.grounded + '/' + rs.ai + ' Claude answers' : 'rules runs only') + '</div>' +
        hbars(per.map((p) => ({ label: AGENTS[p.k].name, v: p.n, color: AGENTS[p.k].color })), { fmt: (v) => fmt(v) }) : '<div class="empty">No console agent runs yet this session. Ask Copilot a question or run the pipeline above.</div>') +
      '<div class="note" style="margin-top:8px">Grounding: every number in a Claude answer must appear in the data the agent was given or fetched with a tool. Rules answers are deterministic and counted separately.</div>'); }) + '</div>';
  h += '<div class="s12">' + gv_safe('Run log', () => card('Run log', AI.runs.length + ' runs this session, newest first. Each run is also an entry in the audit chain.',
    tbl([{ k: 'at', l: 'Time', f: (r) => '<span class="mono">' + gv_ts(r.at) + '</span>' }, { k: 'id', l: 'Run', f: (r) => '<span class="mono sub">' + esc(r.id) + '</span>' }, { k: 'agent', l: 'Agent', f: (r) => esc((AGENTS[r.agent] || {}).name || r.agent) },
      { k: 'user', l: 'User', f: (r) => esc(r.user) }, { k: 'src', l: 'Engine', f: (r) => chip(r.src === 'ai' ? 'Claude' : 'Rules', r.src === 'ai' ? 'acc' : '') }, { k: 'q', l: 'Task', cls: 'wrap', f: (r) => esc(String(r.q || '').slice(0, 120)) },
      { k: 'steps', l: 'Tool calls', v: (r) => (r.steps || []).length, f: (r) => ((r.steps || []).length ? '<span class="mono sub" title="' + esc((r.steps || []).join('\n')) + '">' + r.steps.length + ' · ' + esc(String(r.steps[0]).slice(0, 28)) + (r.steps.length > 1 ? '…' : '') + '</span>' : '<span class="sub">none</span>') },
      { k: 'g', l: 'Grounding', v: (r) => (r.ground && r.ground.pass ? 1 : 0), f: (r) => (r.ground && r.ground.rule ? (r.agent === 'verifier' ? chip(r.ground.ok + '/' + r.ground.n + ' reproduced', r.ground.pass ? 'good' : 'warn') : chip('Rule-based', '')) : groundChip(r.ground)) },
      { k: 'ms', l: 'Latency', r: true, f: (r) => fmt(r.ms) + ' ms' }], AI.runs, { id: 'gv-runs', sort: gv_S.ag.runSort, limit: 100, empty: 'No runs yet this session.' }))) + '</div>';
  h += '</div>';
  el.innerHTML = h; gv_bindGo(el);
  el.querySelectorAll('[data-ag]').forEach((b) => { b.onclick = () => { gv_S.ag.sel = b.dataset.ag; gv_agRender(el); }; });
  bindTbl(el, 'gv-roster', {}, () => {}, (id) => { gv_S.ag.sel = id; gv_agRender(el); });
  bindTbl(el, 'gv-runs', gv_S.ag.runSort, () => gv_agRender(el));
  const sel = el.querySelector('#gv-mid'); if (sel) sel.onchange = () => { gv_S.ag.mid = sel.value; };
  el.querySelector('#gv-run').onclick = async (e) => { e.target.disabled = true; try { await gv_runPipe(el); } finally { if (gv_el.ag === el && R.page === 'agents') gv_agRender(el); } };
  el.querySelector('#gv-jump').onclick = () => { const p = el.querySelector('#gv-pipe'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  el.querySelector('#gv-runcsv').onclick = () => exportFile('agent-runs.csv', toCSV(AI.runs.map((r) => ({ at: r.at, id: r.id, agent: r.agent, user: r.user, engine: r.src, task: r.q, tool_calls: (r.steps || []).join(' | '), grounded: r.ground ? (r.ground.rule ? 'rule' : r.ground.pass) : '', latency_ms: r.ms }))) || 'at,id,agent,user,engine,task,tool_calls,grounded,latency_ms\n', 'text/csv', 'Agent run log (CSV)');
  const sv = el.querySelector('#gv-pipe-save'); if (sv) sv.onclick = () => gv_pipeSave();
}
page({ id: 'agents', title: 'Agent operations', render: (el) => gv_agRender(el) });

// ===================================================================================================
// REPORTS & APPROVALS
// ===================================================================================================
const gv_TPL = [
  { id: 'post', name: 'Post-match report', target: 'match', desc: 'Result, chances, control, top performers, key moments and Verifier status for one match.', sections: ['Summary', 'Key numbers', 'Goals', 'Top performers', 'Key moments', 'Data quality'] },
  { id: 'opp', name: 'Opposition report', target: 'link', desc: 'Built on the Opposition page from the next opponent’s recent matches. Saved reports land in this library.', sections: ['Shape and style', 'Threats', 'Set pieces', 'How to hurt them'] },
  { id: 'player', name: 'Player scouting report', target: 'player', desc: 'Season line, per-match ratings, strengths and watch-outs for one player against his position group.', sections: ['Profile', 'Season numbers', 'Match ratings', 'Strengths', 'Watch-outs'] },
  { id: 'season', name: 'Season review', target: 'club', desc: 'Table position, record, chance quality, results and leading players for one club.', sections: ['Standing', 'Results', 'Chance quality', 'Leading players'] },
  { id: 'board', name: 'Board pack', target: 'club', desc: 'One-page executive summary: position, points, trend, discipline and how the analysis platform performed.', sections: ['Headline', 'KPIs', 'Trend', 'Risks', 'Platform assurance'] },
];
const gv_ST = { draft: ['Draft', ''], pending: ['Pending approval', 'warn'], published: ['Published', 'good'], approved: ['Published', 'good'], rejected: ['Changes requested', 'bad'] };
const gv_stChip = (s) => { const x = gv_ST[s] || [s || 'Draft', '']; return chip(esc(x[0]), x[1]); };
const gv_mdTbl = (head, rows) => '| ' + head.join(' | ') + ' |\n|' + head.map(() => '---').join('|') + '|\n' + rows.map((r) => '| ' + r.join(' | ') + ' |').join('\n') + '\n';

function gv_genPost(m) {
  const H = m.home, A = m.away, th = m.ts[H], ta = m.ts[A], s = m.setup || {}, sm = m.sum || {};
  const goals = (m.events || []).filter((e) => e.type === 'goal');
  const top = (k) => Object.values(m.pm).filter((p) => p.team === k).sort((a, b) => b.rating - a.rating).slice(0, 3);
  const km = ((sm.recap || {}).keyMoments || []).slice(0, 6);
  const v = m.verifier || {};
  let b = '# Post-match report: ' + m.title + '\n\n';
  b += '**' + dateLbl(m.date) + '** · Matchday ' + m.matchday + ' · ' + esc(s.stadium || '') + ', ' + esc(s.city || '') + ' · kick-off ' + esc(s.kickoff || '') + '\n\n';
  b += '## Summary\n\n' + (th.result === 'D' ? clubName(H) + ' and ' + clubName(A) + ' drew ' + m.score.join('–') : (th.result === 'W' ? clubName(H) : clubName(A)) + ' won ' + Math.max(...m.score) + '–' + Math.min(...m.score)) +
    '. Expected goals finished **' + fmt(th.xg, 2) + '–' + fmt(ta.xg, 2) + '**; ' + clubName(th.poss >= ta.poss ? H : A) + ' had ' + Math.max(th.poss, ta.poss) + '% of the ball. Shapes: ' + clubName(H) + ' ' + (th.form || '–') + ', ' + clubName(A) + ' ' + (ta.form || '–') + '.\n\n';
  b += '## Key numbers\n\n' + gv_mdTbl(['Metric', H, A], [['Goals', th.goals, ta.goals], ['Expected goals', fmt(th.xg, 2), fmt(ta.xg, 2)], ['Shots (on target)', th.shots + ' (' + th.onTarget + ')', ta.shots + ' (' + ta.onTarget + ')'], ['Possession', th.poss + '%', ta.poss + '%'], ['Passes completed', th.done + '/' + th.passes + ' (' + pct(th.done, th.passes) + '%)', ta.done + '/' + ta.passes + ' (' + pct(ta.done, ta.passes) + '%)'], ['High turnovers won', th.highWins, ta.highWins], ['PPDA', th.ppda ?? '–', ta.ppda ?? '–'], ['Fouls / yellows', th.fouls + ' / ' + th.yellows, ta.fouls + ' / ' + ta.yellows]]) + '\n';
  b += '## Goals\n\n' + (goals.length ? goals.map((g) => '- ' + Math.round(g.minute) + '′ **' + g.player + '** (' + clubName(g.team) + ')' + (g.ownGoal ? ', own goal' : '') + ' → ' + (g.score || '')).join('\n') : 'No goals.') + '\n\n';
  b += '## Top performers\n\n' + [H, A].map((k) => '- **' + clubName(k) + ':** ' + top(k).map((p) => p.name + ' ' + fmt(p.rating, 1)).join(', ')).join('\n') + '\n\nRatings: ' + RATING_FORMULA + '.\n\n';
  if (km.length) b += '## Key moments\n\n' + km.map((k) => '- ' + Math.round(k.minute) + '′ **' + k.title + '**' + (k.turningPoint ? ' (turning point)' : '') + ': ' + k.explanation).join('\n') + '\n\n';
  b += '## Data quality\n\nIn-match Verifier pass rate **' + (v.passRatePct ?? '–') + '%** across ' + fmt(sum(v.checks || [], (c) => c.passed + c.failed)) + ' checks. ' + ((v.passRatePct ?? 100) >= 99 ? 'Above the 99% release threshold.' : 'Below the 99% release threshold: treat with care.') + '\n';
  return { title: 'Post-match: ' + m.title, type: 'Post-match report', club: m.home === 'HAR' || m.away === 'HAR' ? 'HAR' : m.home, match: m.id, body: b, sources: ['match ' + m.id + ' (events, stats, tracking)', 'm.verifier', 'derived team and player lines'] };
}
function gv_genPlayer(p) {
  const peers = D.players.filter((x) => x.group === p.group && x.apps);
  const rk = (k) => { const s = peers.slice().sort((a, b) => b[k] - a[k]); return s.findIndex((x) => x.name === p.name) + 1; };
  const g = p.games.slice(-8);
  let b = '# Player scouting report: ' + p.name + '\n\n**' + clubName(p.team) + '** · #' + p.num + ' · ' + p.pos + ' (' + p.group + ') · ability ' + p.abil + '\n\n';
  b += '## Season numbers\n\n' + gv_mdTbl(['Metric', 'Value', 'Rank in ' + p.group + ' (of ' + peers.length + ')'], [['Appearances', p.apps, '–'], ['Average rating', fmt(p.rating, 2), rk('rating')], ['Goals / xG', p.goals + ' / ' + fmt(p.xg, 2), rk('goals')], ['Passes completed', p.done + '/' + p.passes + ' (' + p.passPct + '%)', rk('done')], ['Ball wins', p.wins, rk('wins')], ['Take-ons won', p.takeOnsWon + '/' + p.takeOns, rk('takeOnsWon')], ['Tackles', p.tackles, rk('tackles')], ['Distance per 90', fmt(p.per90, 1) + ' km/90', rk('per90')], ['Top speed', fmt(p.top, 1) + ' km/h', rk('top')]]) + '\n';
  b += '## Match ratings\n\n' + g.map((x) => '- ' + dateLbl(x.date) + ' v ' + clubName(x.opp) + ': **' + fmt(x.rating, 1) + '**').join('\n') + '\n\n';
  const str = [['rating', 'match rating'], ['done', 'passes completed'], ['wins', 'ball wins'], ['takeOnsWon', 'take-ons won'], ['tackles', 'tackles'], ['per90', 'distance per 90']].map(([k, l]) => ({ l, r: rk(k) })).sort((a, b) => a.r - b.r);
  b += '## Strengths\n\n' + str.slice(0, 2).map((s) => '- Ranks **' + s.r + ' of ' + peers.length + '** for ' + s.l).join('\n') + '\n\n## Watch-outs\n\n' + str.slice(-2).map((s) => '- Ranks ' + s.r + ' of ' + peers.length + ' for ' + s.l).join('\n') + (p.cards ? '\n- ' + p.cards + ' card' + (p.cards > 1 ? 's' : '') + ' this season' : '') + '\n';
  return { title: 'Scouting: ' + p.name + ' (' + p.team + ')', type: 'Player scouting report', club: p.team, player: p.name, body: b, sources: ['player season aggregates (D.players)', p.apps + ' match lines', 'position-group ranks'] };
}
function gv_genSeason(k) {
  const t = D.table.find((x) => x.key === k) || {}; const ms = D.matches.filter((m) => m.home === k || m.away === k);
  const ps = D.players.filter((p) => p.team === k);
  let b = '# Season review: ' + clubName(k) + '\n\n' + esc(D.league.competition) + ' · ' + esc(D.league.season) + ' · after ' + (t.p || 0) + ' matches\n\n';
  b += '## Standing\n\n**' + ordinal(t.pos) + '** with **' + t.pts + ' points** (W' + t.w + ' D' + t.d + ' L' + t.l + '), goals ' + t.gf + '–' + t.ga + ' (' + (t.gd > 0 ? '+' : '') + t.gd + ').\n\n';
  b += '## Chance quality\n\nxG for ' + fmt(t.xg, 2) + ', against ' + fmt(t.xga, 2) + ' (xGD ' + (t.xgd > 0 ? '+' : '') + fmt(t.xgd, 2) + '). ' + (t.gf - t.xg > 1 ? 'Finishing is running ahead of chance quality; expect some regression.' : t.gf - t.xg < -1 ? 'Finishing is running behind chance quality; results should improve if chances hold.' : 'Goals are in line with chance quality.') + '\n\n';
  b += '## Results\n\n' + gv_mdTbl(['Date', 'Match', 'Result', 'xG'], ms.map((m) => [dateLbl(m.date), m.title, m.ts[k].result, fmt(m.ts[k].xg, 2) + '–' + fmt(m.ts[k].xga, 2)])) + '\n';
  const tg = ps.slice().sort((a, b) => b.goals - a.goals || b.xg - a.xg).slice(0, 3), tr = ps.slice().sort((a, b) => b.rating - a.rating).slice(0, 3);
  b += '## Leading players\n\n- **Goals:** ' + tg.map((p) => p.name + ' ' + p.goals + ' (' + fmt(p.xg, 2) + ' xG)').join(', ') + '\n- **Average rating:** ' + tr.map((p) => p.name + ' ' + fmt(p.rating, 2)).join(', ') + '\n';
  return { title: 'Season review: ' + clubName(k), type: 'Season review', club: k, body: b, sources: ['league table (D.table)', ms.length + ' matches', 'player season aggregates'] };
}
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function gv_genBoard(k) {
  const t = D.table.find((x) => x.key === k) || {}; const ms = D.matches.filter((m) => m.home === k || m.away === k); const last5 = ms.slice(-5);
  const st = gv_agStats(); const disc = sum(ms, (m) => m.ts[k].yellows + 2 * m.ts[k].reds);
  let b = '# Board pack: ' + clubName(k) + '\n\nPrepared ' + dateLbl(new Date().toISOString().slice(0, 10)) + ' · ' + esc(D.league.season) + '\n\n';
  b += '## Headline\n\n' + clubName(k) + ' are **' + ordinal(t.pos) + ' of ' + D.table.length + '** on ' + t.pts + ' points from ' + t.p + ' matches (' + fmt(t.pts / Math.max(1, t.p), 2) + ' per match). Last five: **' + last5.map((m) => m.ts[k].result).join(' ') + '**.\n\n';
  b += '## KPIs\n\n' + gv_mdTbl(['KPI', 'Value', 'League rank'], [['Points', t.pts, t.pos], ['Goal difference', (t.gd > 0 ? '+' : '') + t.gd, D.table.slice().sort((a, b) => b.gd - a.gd).findIndex((x) => x.key === k) + 1], ['xG difference', (t.xgd > 0 ? '+' : '') + fmt(t.xgd, 2), D.table.slice().sort((a, b) => b.xgd - a.xgd).findIndex((x) => x.key === k) + 1], ['Goals against', t.ga, D.table.slice().sort((a, b) => a.ga - b.ga).findIndex((x) => x.key === k) + 1]]) + '\n';
  b += '## Trend\n\nxG difference over the last five matches: ' + last5.map((m) => (m.ts[k].xg - m.ts[k].xga > 0 ? '+' : '') + fmt(m.ts[k].xg - m.ts[k].xga, 2)).join(', ') + '.\n\n';
  b += '## Risks\n\n- Discipline: ' + disc + ' card points this season (yellow 1, red 2).\n- ' + (t.gf - t.xg > 1 ? 'Results are flattered by finishing above xG.' : t.xgd < 0 ? 'Chance quality conceded exceeds chance quality created.' : 'No chance-quality warning this period.') + '\n\n';
  b += '## Platform assurance\n\n- In-match Verifier pass rate ' + fmt((100 * st.totP) / Math.max(1, st.totP + st.totF), 2) + '% over ' + fmt(st.totP + st.totF) + ' checks.\n- Predictor Brier score ' + (st.brier == null ? '–' : fmt(st.brier, 3)) + ' over ' + st.pts.length + ' settled calls.\n- Every figure in this pack comes from data version `' + D.version + '` and is reproducible from the Data catalogue manifest.\n';
  return { title: 'Board pack: ' + clubName(k), type: 'Board pack', club: k, body: b, sources: ['league table', ms.length + ' matches', 'agent operations metrics', 'data version ' + D.version] };
}
async function gv_saveReport(g, author) {
  const now = new Date().toISOString(); const a = author || { name: me().name, role: ROLE };
  const o = { title: g.title, type: g.type, club: g.club || '', match: g.match || '', player: g.player || '', status: 'draft', author: a.name, authorRole: a.role, body: g.body + (g.bodyExtra || ''), sources: g.sources || [], createdAt: now, updatedAt: now, version: D.version,
    history: [{ at: now, actor: a.name, role: a.role, action: 'created', to: 'draft', comment: g.via ? 'Generated by ' + g.via : 'Generated from the ' + g.type + ' template' }] };
  const r = await sAdd('reports', o);
  audit('report.create', r.title, g.type + ' draft · ' + (g.via || 'template') + ' · id ' + r.id);
  gv_S.rp.cache = null; return r;
}
// tiny, safe markdown: everything is escaped first, then a small set of block and inline rules applies
function gv_md(src) {
  const inl = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  const L = String(src || '').replace(/\r/g, '').split('\n'); let o = '', i = 0;
  while (i < L.length) {
    const l = L[i];
    if (!l.trim()) { i++; continue; }
    let mm;
    if ((mm = l.match(/^(#{1,3})\s+(.*)$/))) { o += '<h' + mm[1].length + '>' + inl(mm[2]) + '</h' + mm[1].length + '>'; i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) { o += '<hr>'; i++; continue; }
    if (/^\s*\|/.test(l)) { const rows = []; while (i < L.length && /^\s*\|/.test(L[i])) rows.push(L[i++]); const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()); const hasHead = rows[1] && /^\s*\|?\s*:?-{2,}/.test(rows[1]);
      o += '<div class="mdt"><table>' + (hasHead ? '<thead><tr>' + cells(rows[0]).map((c) => '<th>' + inl(c) + '</th>').join('') + '</tr></thead>' : '') + '<tbody>' + rows.slice(hasHead ? 2 : 0).map((r) => '<tr>' + cells(r).map((c) => '<td>' + inl(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>'; continue; }
    if (/^\s*[-*]\s+/.test(l)) { o += '<ul>'; while (i < L.length && /^\s*[-*]\s+/.test(L[i])) o += '<li>' + inl(L[i++].replace(/^\s*[-*]\s+/, '')) + '</li>'; o += '</ul>'; continue; }
    if (/^\s*\d+[.)]\s+/.test(l)) { o += '<ol>'; while (i < L.length && /^\s*\d+[.)]\s+/.test(L[i])) o += '<li>' + inl(L[i++].replace(/^\s*\d+[.)]\s+/, '')) + '</li>'; o += '</ol>'; continue; }
    if (/^>\s?/.test(l)) { const q = []; while (i < L.length && /^>\s?/.test(L[i])) q.push(L[i++].replace(/^>\s?/, '')); o += '<blockquote>' + inl(q.join(' ')) + '</blockquote>'; continue; }
    const p = []; while (i < L.length && L[i].trim() && !/^(#{1,3}\s|\s*[-*]\s+|\s*\d+[.)]\s+|>|\s*\|)/.test(L[i])) p.push(L[i++]); o += '<p>' + inl(p.join(' ')) + '</p>';
  }
  return o;
}
async function gv_rpLoad(force) { if (!gv_S.rp.cache || force) { try { gv_S.rp.cache = await sList('reports'); } catch (e) { gv_S.rp.cache = []; } } return gv_S.rp.cache; }
async function gv_schLoad(force) { if (!gv_S.rp.sch || force) { try { gv_S.rp.sch = await sList('schedules'); } catch (e) { gv_S.rp.sch = []; } } return gv_S.rp.sch; }
async function gv_rpUpdate(r, patch, h) {
  const now = new Date().toISOString(); const n = Object.assign({}, r, patch, { updatedAt: now, at: r.at || now });
  n.history = (r.history || []).concat([Object.assign({ at: now, actor: me().name, role: ROLE }, h)]); delete n.id;
  await sSet('reports', r.id, n); gv_S.rp.cache = null; return Object.assign({ id: r.id }, n);
}
const gv_isAuthor = (r) => r.author === me().name;
function gv_nextRun(s) {
  const now = new Date();
  if (s.cadence === 'weekly') { const d = new Date(now); d.setHours(8, 0, 0, 0); const add = (8 - d.getDay()) % 7 || (now.getHours() >= 8 || now.getDay() !== 1 ? 7 : 0); d.setDate(d.getDate() + (now.getDay() === 1 && now.getHours() < 8 ? 0 : add)); return { iso: d.toISOString(), label: 'Mon ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' 08:00' }; }
  if (s.cadence === 'monthly') { const d = new Date(now.getFullYear(), now.getMonth() + 1, 1, 8, 0, 0); return { iso: d.toISOString(), label: '1 ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ' 08:00' }; }
  const k = s.target && D.club(s.target) && D.clubs.some((c) => c.key === s.target) ? s.target : 'HAR';
  const played = D.matches.filter((m) => m.home === k || m.away === k); const lastMd = Math.max(0, ...played.map((m) => m.matchday));
  const nx = (D.league.fixtures || []).filter((f) => (f.home === k || f.away === k) && f.md > lastMd).sort((a, b) => a.md - b.md)[0];
  return nx ? { iso: '', label: 'After MD' + nx.md + ': ' + nx.home + ' v ' + nx.away } : { iso: '', label: 'After the next ' + k + ' match (fixture list complete)' };
}
function gv_targetOpts(tpl, cur) {
  if (tpl.target === 'match') return D.matches.slice().reverse().map((m) => '<option value="' + m.id + '"' + (m.id === cur ? ' selected' : '') + '>MD' + m.matchday + ' · ' + esc(m.title) + '</option>').join('');
  if (tpl.target === 'player') return D.players.slice().sort((a, b) => (a.team === 'HAR' ? 0 : 1) - (b.team === 'HAR' ? 0 : 1) || a.team.localeCompare(b.team) || b.rating - a.rating).map((p) => '<option value="' + esc(p.name) + '"' + (p.name === cur ? ' selected' : '') + '>' + esc(p.name) + ' · ' + p.pos + ' · ' + p.team + '</option>').join('');
  if (tpl.target === 'club') return D.clubs.map((c) => '<option value="' + c.key + '"' + (c.key === (cur || 'HAR') ? ' selected' : '') + '>' + esc(c.club) + '</option>').join('');
  return '';
}
function gv_gen(tplId, target) {
  if (tplId === 'post') { const m = D.match(target) || gv_lastMatch(); return gv_genPost(m); }
  if (tplId === 'player') { const p = D.player(target) || D.players.find((x) => x.team === 'HAR'); return gv_genPlayer(p); }
  if (tplId === 'season') return gv_genSeason(target || 'HAR');
  if (tplId === 'board') return gv_genBoard(target || 'HAR');
  return null;
}
function gv_newReport(tplId) {
  if (!gate('author', 'Create report')) return;
  const tpl0 = gv_TPL.find((t) => t.id === tplId) || gv_TPL[0];
  const bg = modal('<h3>New report</h3><p class="note" style="margin:0 0 12px">The body is generated from the season data with real numbers and saved as a draft. You can edit it before submitting for approval.</p>' +
    '<div style="display:flex;flex-direction:column;gap:10px"><label class="field">Template<select id="gv-nt">' + gv_TPL.map((t) => '<option value="' + t.id + '"' + (t.id === tpl0.id ? ' selected' : '') + '>' + t.name + '</option>').join('') + '</select></label>' +
    '<div id="gv-ntarget"></div><div class="note" id="gv-ndesc"></div></div><div class="gv-actrow" style="justify-content:flex-end"><button class="btn" id="gv-ncancel">Cancel</button><button class="btn pri" id="gv-ngo">Generate draft</button></div>');
  const sync = () => {
    const t = gv_TPL.find((x) => x.id === bg.querySelector('#gv-nt').value); bg.querySelector('#gv-ndesc').textContent = t.desc + ' Sections: ' + t.sections.join(', ') + '.';
    const lbl = { match: 'Match', player: 'Player', club: 'Club' }[t.target];
    bg.querySelector('#gv-ntarget').innerHTML = t.target === 'link' ? '<div class="gv-banner info"><div>Opposition reports are built on the Opposition page, which studies the opponent’s recent matches. Saved reports appear in this library for approval.</div></div>' : '<label class="field">' + lbl + '<select id="gv-ntv">' + gv_targetOpts(t, t.target === 'match' ? (gv_ourMatch() || {}).id : '') + '</select></label>';
    bg.querySelector('#gv-ngo').textContent = t.target === 'link' ? 'Open Opposition page' : 'Generate draft';
  };
  sync(); bg.querySelector('#gv-nt').onchange = sync; bg.querySelector('#gv-ncancel').onclick = closeModal;
  bg.querySelector('#gv-ngo').onclick = async () => {
    const t = bg.querySelector('#gv-nt').value; if (t === 'opp') { closeModal(); go('opposition'); return; }
    const v = bg.querySelector('#gv-ntv'); const g = gv_gen(t, v && v.value); if (!g) return;
    bg.querySelector('#gv-ngo').disabled = true; const r = await gv_saveReport(g); closeModal(); toast('Draft created: ' + r.title); go('reports', r.id);
  };
}
async function gv_transition(r, act) {
  const el = gv_el.rp;
  if (act === 'submit') { if (!gate('author', 'Submit report')) return; if (!gv_isAuthor(r) && !can('admin')) { toast('Only the author can submit this draft.'); return; }
    const n = await gv_rpUpdate(r, { status: 'pending', submittedAt: new Date().toISOString() }, { action: 'submitted', from: r.status, to: 'pending', comment: 'Submitted for approval' });
    audit('report.submit', r.title, 'draft → pending · id ' + r.id); toast('Submitted for approval. An approver other than you must sign it off.'); return gv_rpRender(el, n.id); }
  if (act === 'approve' || act === 'reject') {
    if (!gate('approve', (act === 'approve' ? 'Approve' : 'Reject') + ' report')) return;
    if (gv_isAuthor(r)) { audit('report.' + act, r.title, 'Blocked by separation of duties: ' + me().name + ' authored this report', 'denied'); toast('Separation of duties: you authored this report, so another approver must decide.'); return; }
    const bg = modal('<h3>' + (act === 'approve' ? 'Approve and publish' : 'Request changes') + '</h3><p class="note" style="margin:0 0 10px">' + esc(r.title) + ' · authored by ' + esc(r.author) + '. Your decision and comment are stored on the report and in the audit chain.</p><label class="field">Comment' + (act === 'reject' ? ' (required)' : '') + '<textarea id="gv-cm" placeholder="' + (act === 'approve' ? 'Optional note for the record' : 'What needs to change?') + '"></textarea></label><div class="gv-actrow" style="justify-content:flex-end"><button class="btn" id="gv-cx">Cancel</button><button class="btn ' + (act === 'approve' ? 'pri' : 'danger') + '" id="gv-cok">' + (act === 'approve' ? 'Approve and publish' : 'Request changes') + '</button></div>');
    bg.querySelector('#gv-cx').onclick = closeModal;
    bg.querySelector('#gv-cok').onclick = async () => {
      const c = bg.querySelector('#gv-cm').value.trim(); if (act === 'reject' && !c) { bg.querySelector('#gv-cm').focus(); toast('Add a comment so the author knows what to change.'); return; }
      closeModal();
      const now = new Date().toISOString();
      const n = act === 'approve' ? await gv_rpUpdate(r, { status: 'published', approvedBy: me().name, approvedAt: now, publishedAt: now }, { action: 'approved', from: 'pending', to: 'published', comment: c || 'Approved' })
        : await gv_rpUpdate(r, { status: 'rejected', rejectedBy: me().name }, { action: 'changes requested', from: 'pending', to: 'rejected', comment: c });
      audit('report.' + act, r.title, (act === 'approve' ? 'pending → published' : 'pending → rejected') + (c ? ' · “' + c.slice(0, 80) + '”' : '') + ' · author ' + r.author, 'ok');
      toast(act === 'approve' ? 'Approved and published.' : 'Sent back to the author with your comment.'); gv_rpRender(el, n.id);
    };
    return;
  }
  if (act === 'revise') { if (!gv_isAuthor(r) && !can('admin')) { toast('Only the author can revise this report.'); return; } const n = await gv_rpUpdate(r, { status: 'draft' }, { action: 'reopened', from: r.status, to: 'draft', comment: 'Reopened for changes' }); audit('report.revise', r.title, r.status + ' → draft · id ' + r.id); gv_S.rp.edit = true; return gv_rpRender(el, n.id); }
  if (act === 'delete') { if (!(gv_isAuthor(r) && r.status === 'draft') && !can('admin')) { deny('admin', 'Delete report'); return; } if (!confirm('Delete “' + r.title + '”? This cannot be undone.')) return; await sDel('reports', r.id); gv_S.rp.cache = null; audit('report.delete', r.title, 'Deleted (' + r.status + ') · id ' + r.id); toast('Report deleted.'); go('reports'); }
}
function gv_rpViewer(r) {
  const st = r.status || 'draft'; const mine = gv_isAuthor(r);
  const acts = [];
  if (st === 'draft') { acts.push('<button class="btn pri" data-act="submit">Submit for approval' + lockBtn('author') + '</button>'); acts.push('<button class="btn" data-act="edit">' + (gv_S.rp.edit ? 'Close editor' : 'Edit draft') + '</button>'); }
  if (st === 'pending') { acts.push('<button class="btn pri" data-act="approve"' + (mine ? ' title="You authored this report"' : '') + '>Approve' + (mine ? ' <span class="lk">⊘</span>' : lockBtn('approve')) + '</button>'); acts.push('<button class="btn danger" data-act="reject">Request changes' + (mine ? ' <span class="lk">⊘</span>' : lockBtn('approve')) + '</button>'); }
  if (st === 'rejected') acts.push('<button class="btn pri" data-act="revise">Revise</button>');
  acts.push('<button class="btn" data-act="md">Export .md' + lockBtn('export') + '</button><button class="btn" data-act="html">Export .html' + lockBtn('export') + '</button>');
  if ((mine && st === 'draft') || can('admin')) acts.push('<button class="btn ghost" data-act="delete">Delete</button>');
  let sod = '';
  if (st === 'pending') sod = mine ? '<div class="gv-banner warn"><div><b>Separation of duties.</b> You authored this report, so you cannot approve or reject it. ' + (can('approve') ? 'Another approver must decide.' : '') + ' <span class="note">Switch to Elena Marsh (Head coach, approver) in the top bar to see the approver view.</span></div></div>'
    : can('approve') ? '<div class="gv-banner info"><div><b>Waiting for your decision.</b> Authored by ' + esc(r.author) + '. Approving publishes it to the department library.</div></div>' : '<div class="gv-banner info"><div>Waiting for an approver (Manager or Admin role) who is not the author.</div></div>';
  if (st === 'rejected') { const last = (r.history || []).slice().reverse().find((h) => h.to === 'rejected'); sod = '<div class="gv-banner bad"><div><b>Changes requested' + (last ? ' by ' + esc(last.actor) : '') + '.</b> ' + esc(last ? last.comment : '') + '</div></div>'; }
  const editor = st === 'draft' && gv_S.rp.edit ? '<label class="field" style="margin-bottom:10px">Markdown body<textarea id="gv-body" style="min-height:340px;font:12.5px/1.5 var(--f-mono)">' + esc(r.body) + '</textarea></label><div class="gv-actrow" style="margin:0 0 14px"><button class="btn pri" id="gv-save">Save changes</button><span class="note">Edits are stored in the report history and re-hashed.</span></div>' : '';
  const hist = (r.history || []).slice().reverse();
  const tone = (a) => (/approved/.test(a) ? 'good' : /changes|reject/.test(a) ? 'bad' : /submitted/.test(a) ? 'info' : '');
  return pgHead(esc(r.title), esc(r.type || 'Report') + ' · ' + (r.club ? esc(clubName(r.club)) + ' · ' : '') + 'by ' + esc(r.author || '–') + (r.authorRole ? ' (' + esc(r.authorRole) + ')' : '') + ' · updated ' + gv_t(r.updatedAt || r.createdAt || r.at), acts.join(''), [['Reports & approvals', 'reports'], [r.title]]) +
    sod + '<div class="grid"><div class="s8">' + card('', '', editor + '<article class="gv-md">' + gv_md(r.body) + '</article>' +
      '<dl class="gv-prov"><dt>Status</dt><dd>' + gv_stChip(st) + '</dd><dt>Sources</dt><dd>' + esc((r.sources || []).join(' · ') || '–') + '</dd><dt>Data version</dt><dd>' + esc(r.version || D.version) + '</dd><dt>Body sha256</dt><dd id="gv-sha">computing…</dd><dt>Report id</dt><dd>' + esc(r.id) + '</dd>' + (r.approvedBy ? '<dt>Approved by</dt><dd>' + esc(r.approvedBy) + ' · ' + gv_t(r.approvedAt) + '</dd>' : '') + '</dl>') + '</div>' +
    '<div class="s4">' + card('Workflow', 'Draft → Pending → Published. Approver must not be the author.', '<div class="gv-row" style="margin-bottom:10px">' + ['draft', 'pending', 'published'].map((s) => chip(gv_ST[s][0], s === st || (s === 'published' && st === 'approved') ? gv_ST[s][1] || 'acc' : '')).join('<span class="gv-mute">→</span>') + '</div>' +
      '<div class="gv-hist">' + (hist.length ? hist.map((h) => '<div class="e ' + tone(h.action) + '"><i></i><div><div><b>' + esc(h.actor) + '</b> ' + esc(h.action) + (h.to ? ' <span class="sub">→ ' + esc(h.to) + '</span>' : '') + '</div>' + (h.comment ? '<div>' + esc(h.comment) + '</div>' : '') + '<div class="s">' + gv_t(h.at) + ' · ' + esc(h.role || '') + '</div></div></div>').join('') : '<div class="note">No history recorded (created outside this page).</div>') + '</div>') + '</div></div>';
}
function gv_rpTabs(reps, sch) {
  const pend = reps.filter((r) => r.status === 'pending').length;
  return '<div class="tabs" role="tablist">' + [['library', 'Library (' + reps.length + ')'], ['queue', 'Approval queue' + (pend ? ' (' + pend + ')' : '')], ['templates', 'Templates'], ['schedules', 'Schedules (' + sch.length + ')']].map(([k, l]) => '<button role="tab" data-tab="' + k + '" aria-selected="' + (gv_S.rp.tab === k) + '">' + l + '</button>').join('') + '</div>';
}
function gv_rpTable(rows, id, empty) {
  return tbl([{ k: 'title', l: 'Report', cls: 'wrap', f: (r) => '<b>' + esc(r.title) + '</b><div class="sub">' + esc(r.type || '') + '</div>' }, { k: 'club', l: 'Club', f: (r) => (r.club ? clubTag(r.club) : '–') },
    { k: 'author', l: 'Author', f: (r) => esc(r.author || '–') + (r.authorRole ? '<div class="sub">' + esc(r.authorRole) + '</div>' : '') }, { k: 'status', l: 'Status', f: (r) => gv_stChip(r.status) },
    { k: 'at', l: 'Updated', v: (r) => r.updatedAt || r.createdAt || r.at, f: (r) => '<span class="num">' + gv_t(r.updatedAt || r.createdAt || r.at) + '</span>' }], rows, { id, sort: gv_S.rp.sort, click: true, key: (r) => r.id, empty });
}
async function gv_rpRender(el, arg) {
  gv_el.rp = el;
  if (!el.innerHTML) el.innerHTML = pgHead('Reports & approvals', 'Loading the report library…');
  const reps = await gv_rpLoad(); const sch = await gv_schLoad();
  if (R.page !== 'reports' || gv_el.rp !== el) return;
  if (arg) { const r = reps.find((x) => x.id === arg); if (r) { el.innerHTML = gv_rpViewer(r); gv_bindGo(el); gv_rpBindViewer(el, r); sha(r.body || '').then((h) => { const s = el.querySelector('#gv-sha'); if (s) s.textContent = h; }); return; } }
  const S = gv_S.rp; const pend = reps.filter((r) => r.status === 'pending');
  let h = pgHead('Reports & approvals', 'Report library with an approval workflow. Drafts are generated from the data, approved by someone other than the author, then published. Every transition is stored on the report and in the audit chain.',
    '<button class="btn pri" id="gv-new">New report' + lockBtn('author') + '</button>');
  h += '<div class="kpis">' + kpi('Reports', fmt(reps.length), STORE.mode === 'db' ? 'shared team store' : 'stored in this browser') + kpi('Pending approval', fmt(pend.length), pend.length ? 'oldest ' + gv_t(pend.map((r) => r.submittedAt || r.updatedAt).sort()[0]) : 'queue clear', pend.length ? 'warn' : '') +
    kpi('Published', fmt(reps.filter((r) => r.status === 'published' || r.status === 'approved').length), 'approved by a second person') + kpi('Schedules', fmt(sch.length), 'delivery planned (Microsoft 365)') + '</div>';
  h += gv_rpTabs(reps, sch);
  if (S.tab === 'library' || S.tab === 'queue') {
    if (!reps.length) h += card('', '', '<div class="empty" style="padding:36px 10px"><div style="font:700 22px var(--f-disp);color:var(--ink);margin-bottom:6px">No reports yet</div><div style="max-width:52ch;margin:0 auto 14px">Reports are generated from the match data, saved as drafts, and published once an approver who did not write them signs off. Start with the latest match.</div><div class="gv-row" style="justify-content:center"><button class="btn pri" id="gv-sample">Create sample report from the latest match' + lockBtn('author') + '</button><button class="btn" id="gv-new2">Choose a template</button></div><div class="note" style="margin-top:10px">Latest match: ' + esc((gv_lastMatch() || {}).title || '–') + '</div></div>');
    else if (S.tab === 'library') {
      const rows = reps.filter((r) => S.status === 'all' || (S.status === 'published' ? r.status === 'published' || r.status === 'approved' : r.status === S.status));
      h += '<div class="filters">' + seg('gv-stf', [['all', 'All'], ['draft', 'Drafts'], ['pending', 'Pending'], ['published', 'Published'], ['rejected', 'Changes requested']], S.status) + '</div>' + card('', '', gv_rpTable(rows, 'gv-rtbl'));
    } else h += card('Approval queue', can('approve') ? 'Reports waiting for a decision. You cannot decide on reports you authored.' : 'Reports waiting for an approver. Your role can view the queue but not decide.', gv_rpTable(pend, 'gv-rtbl', 'Nothing is waiting for approval.'));
  } else if (S.tab === 'templates') {
    h += '<div class="gv-tpl">' + gv_TPL.map((t) => '<section class="card"><h3 style="margin:0;font-size:14.5px">' + t.name + '</h3><div class="note">' + esc(t.desc) + '</div><ul>' + t.sections.map((s) => '<li>' + s + '</li>').join('') + '</ul><div style="margin-top:auto;padding-top:6px">' + (t.id === 'opp' ? '<button class="btn sm" data-go="opposition">Open Opposition page →</button>' : '<button class="btn sm" data-tpl="' + t.id + '">Use template' + lockBtn('author') + '</button>') + '</div></section>').join('') + '</div>';
  } else {
    h += gv_schHtml(sch);
  }
  el.innerHTML = h; gv_bindGo(el);
  const nw = () => gv_newReport(); el.querySelector('#gv-new').onclick = nw; const n2 = el.querySelector('#gv-new2'); if (n2) n2.onclick = nw;
  const sm = el.querySelector('#gv-sample'); if (sm) sm.onclick = async () => { if (!gate('author', 'Create sample report')) return; sm.disabled = true; const r = await gv_saveReport(gv_genPost(gv_lastMatch())); toast('Draft created from ' + gv_lastMatch().id); go('reports', r.id); };
  el.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { S.tab = b.dataset.tab; gv_rpRender(el); }; });
  el.querySelectorAll('[data-tpl]').forEach((b) => { b.onclick = () => gv_newReport(b.dataset.tpl); });
  bindSeg(el, 'gv-stf', (v) => { S.status = v; gv_rpRender(el); });
  bindTbl(el, 'gv-rtbl', S.sort, () => gv_rpRender(el), (id) => { gv_S.rp.edit = false; go('reports', id); });
  if (S.tab === 'schedules') gv_schBind(el);
}
function gv_rpBindViewer(el, r) {
  el.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = async () => {
      const a = b.dataset.act;
      if (a === 'edit') { if (!gv_isAuthor(r) && !can('admin')) { toast('Only the author can edit this draft.'); return; } gv_S.rp.edit = !gv_S.rp.edit; return gv_rpRender(el, r.id); }
      if (a === 'md') return exportFile(gv_slug(r.title) + '.md', r.body + '\n\n---\nData version ' + (r.version || D.version) + ' · status ' + r.status + ' · author ' + r.author + (r.approvedBy ? ' · approved by ' + r.approvedBy : '') + '\nsha256(body) ' + (await sha(r.body || '')) + '\n', 'text/markdown', 'Report ' + r.title + ' (.md)');
      if (a === 'html') { const hsh = await sha(r.body || ''); const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(r.title) + '</title><style>body{font:15px/1.6 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#13201A;background:#fff}table{border-collapse:collapse}th,td{border-bottom:1px solid #D9E1DC;padding:4px 10px;text-align:left}h2{border-bottom:1px solid #D9E1DC;padding-bottom:4px}blockquote{border-left:3px solid #0C7A53;margin:8px 0;padding:4px 12px;background:#F3F6F4}footer{margin-top:30px;font:12px monospace;color:#5A6B63;border-top:1px dashed #C6D1CB;padding-top:10px}</style>' + gv_md(r.body) + '<footer>MatchCast Enterprise · Harbor City FC · ' + esc(r.status) + ' · author ' + esc(r.author) + (r.approvedBy ? ' · approved by ' + esc(r.approvedBy) : '') + '<br>Sources: ' + esc((r.sources || []).join(' · ')) + '<br>Data version ' + esc(r.version || D.version) + ' · sha256(body) ' + hsh + '</footer>'; return exportFile(gv_slug(r.title) + '.html', html, 'text/html', 'Report ' + r.title + ' (.html)'); }
      return gv_transition(r, a);
    };
  });
  const sv = el.querySelector('#gv-save'); if (sv) sv.onclick = async () => { const body = el.querySelector('#gv-body').value; if (body === r.body) { gv_S.rp.edit = false; return gv_rpRender(el, r.id); } const n = await gv_rpUpdate(r, { body }, { action: 'edited', to: 'draft', comment: 'Body edited (' + body.length + ' chars)' }); audit('report.edit', r.title, 'Draft body edited · sha256 ' + (await sha(body)).slice(0, 12) + '…'); gv_S.rp.edit = false; toast('Draft saved.'); gv_rpRender(el, n.id); };
}
const gv_slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const gv_CAD = { after: 'After every match', weekly: 'Weekly · Monday 08:00', monthly: 'Monthly · 1st, 08:00' };
function gv_schHtml(sch) {
  const form = '<div class="filters" style="margin-bottom:0">' +
    '<label class="field">Template<select id="gv-sct">' + gv_TPL.filter((t) => t.id !== 'opp').map((t) => '<option value="' + t.id + '">' + t.name + '</option>').join('') + '</select></label>' +
    '<label class="field">Target club<select id="gv-scc">' + D.clubs.map((c) => '<option value="' + c.key + '">' + esc(c.club) + '</option>').join('') + '</select></label>' +
    '<label class="field">Cadence<select id="gv-sccd">' + Object.entries(gv_CAD).map(([k, l]) => '<option value="' + k + '">' + l + '</option>').join('') + '</select></label>' +
    '<label class="field" style="flex:1;min-width:200px">Recipients<input id="gv-scr" value="analysis@harborcity.example, e.marsh@harborcity.example"></label>' +
    '<label class="field">Channel<select id="gv-sch">' + ['Email', 'Teams', 'SharePoint'].map((c) => '<option>' + c + '</option>').join('') + '</select></label>' +
    '<button class="btn pri" id="gv-scadd">Add schedule' + lockBtn('author') + '</button></div>';
  const rows = sch.map((s) => Object.assign({}, s, { nx: gv_nextRun(s) }));
  return card('New schedule', 'Scheduled reports are generated as drafts and still go through approval. Delivery to Email, Teams or SharePoint is planned on Microsoft Graph; in this demo, “Run now” creates the draft.', form) +
    '<div style="margin-top:14px">' + card('Schedules', rows.length ? rows.length + ' active' : '', tbl([{ k: 'template', l: 'Template', f: (r) => '<b>' + esc((gv_TPL.find((t) => t.id === r.template) || {}).name || r.template) + '</b>' }, { k: 'target', l: 'Target', f: (r) => clubTag(r.target) },
      { k: 'cadence', l: 'Cadence', f: (r) => esc(gv_CAD[r.cadence] || r.cadence) }, { k: 'recipients', l: 'Recipients', cls: 'wrap', f: (r) => '<span class="sub">' + esc(r.recipients) + '</span>' },
      { k: 'channel', l: 'Channel', f: (r) => esc(r.channel) + ' ' + chip('Planned', 'warn') }, { k: 'nx', l: 'Next run', v: (r) => r.nx.iso || r.nx.label, f: (r) => '<span class="num">' + esc(r.nx.label) + '</span>' },
      { k: 'act', l: '', sort: false, f: (r) => '<span class="gv-row" style="flex-wrap:nowrap"><button class="btn sm" data-run="' + esc(r.id) + '">Run now</button><button class="btn sm ghost" data-del="' + esc(r.id) + '" aria-label="Delete schedule">✕</button></span>' }],
    rows, { id: 'gv-stbl', empty: 'No schedules yet. Add one above: for example a Post-match report for Harbor City after every match.' })) + '</div>';
}
function gv_schBind(el) {
  const add = el.querySelector('#gv-scadd'); if (add) add.onclick = async () => {
    if (!gate('author', 'Create report schedule')) return;
    const s = { template: el.querySelector('#gv-sct').value, target: el.querySelector('#gv-scc').value, cadence: el.querySelector('#gv-sccd').value, recipients: el.querySelector('#gv-scr').value.trim(), channel: el.querySelector('#gv-sch').value, owner: me().name, createdAt: new Date().toISOString() };
    s.nextRun = gv_nextRun(s).label; const r = await sAdd('schedules', s); gv_S.rp.sch = null;
    audit('schedule.create', (gv_TPL.find((t) => t.id === s.template) || {}).name + ' · ' + s.target, gv_CAD[s.cadence] + ' via ' + s.channel + ' (planned) · id ' + r.id); toast('Schedule added. Next run: ' + s.nextRun); gv_rpRender(el);
  };
  el.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { const s = (gv_S.rp.sch || []).find((x) => x.id === b.dataset.del); if (!s) return; if (s.owner !== me().name && !can('admin')) { deny('admin', 'Delete schedule'); return; } await sDel('schedules', s.id); gv_S.rp.sch = null; audit('schedule.delete', s.template + ' · ' + s.target, 'Schedule removed · id ' + s.id); gv_rpRender(el); }; });
  el.querySelectorAll('[data-run]').forEach((b) => { b.onclick = async () => {
    if (!gate('author', 'Run schedule')) return;
    const s = (gv_S.rp.sch || []).find((x) => x.id === b.dataset.run); if (!s) return;
    const tgt = s.template === 'post' ? (D.matches.filter((m) => m.home === s.target || m.away === s.target).slice(-1)[0] || gv_lastMatch()).id : s.template === 'player' ? (D.players.filter((p) => p.team === s.target).sort((a, c) => c.rating - a.rating)[0] || {}).name : s.target;
    const g = gv_gen(s.template, tgt); if (!g) return; g.via = 'schedule ' + s.id + ' (' + gv_CAD[s.cadence] + ')';
    const r = await gv_saveReport(g, { name: 'MatchCast Scheduler', role: 'service' }); audit('schedule.run', s.template + ' · ' + s.target, 'Manual run by ' + me().name + ' → draft ' + r.id + ' · delivery via ' + s.channel + ' is planned, not sent');
    toast('Draft generated by the scheduler: ' + r.title); go('reports', r.id);
  }; });
}
page({ id: 'reports', title: 'Reports & approvals', render: (el, arg) => { el.innerHTML = ''; gv_rpRender(el, arg); } });

// ===================================================================================================
// AUDIT LOG
// ===================================================================================================
const gv_aType = (a) => String(a || '').split('.')[0];
const gv_OUT = { ok: 'good', denied: 'bad', flagged: 'warn' };
function gv_auRows(src) {
  const S = gv_S.au; return src.filter((e) => (!S.act || gv_aType(e.action) === S.act) && (!S.out || e.outcome === S.out) && (!S.actor || e.actor === S.actor));
}
function gv_auTable(rows, id, org) {
  return tbl([{ k: 'seq', l: '#', r: true, f: (e) => '<span class="mono">' + e.seq + '</span>' }, ...(org ? [{ k: 'session', l: 'Session', f: (e) => '<span class="mono sub">' + esc(e.session || '–') + '</span>' }] : []),
    { k: 'at', l: 'Time', f: (e) => '<span class="mono">' + (org ? gv_t(e.at) : gv_ts(e.at)) + '</span>' }, { k: 'actor', l: 'Actor', f: (e) => esc(e.actor) + '<div class="sub">' + esc(e.role) + '</div>' },
    { k: 'action', l: 'Action', f: (e) => '<span class="mono">' + esc(e.action) + '</span>' }, { k: 'target', l: 'Target', cls: 'wrap', f: (e) => esc(e.target) }, { k: 'detail', l: 'Detail', cls: 'wrap', f: (e) => '<span class="sub">' + esc(e.detail) + '</span>' },
    { k: 'outcome', l: 'Outcome', f: (e) => chip(esc(e.outcome), gv_OUT[e.outcome] || '') }, { k: 'hash', l: 'Hash', f: (e) => '<span class="gv-hash" title="prev ' + esc(e.prev || '') + '\nhash ' + esc(e.hash || '') + '">' + (e.hash ? esc(e.hash.slice(0, 10)) + '…' : 'pending') + '</span>' }],
  rows.slice().reverse().slice(0, 300), { id, empty: 'No entries match these filters.' });
}
function gv_auBody() {
  const S = gv_S.au; const full = can('audit'); const src = full ? AUD.log : AUD.log.filter((e) => e.actor === me().name);
  const rows = gv_auRows(src);
  const types = [...new Set(AUD.log.map((e) => gv_aType(e.action)))].sort(), actors = [...new Set(AUD.log.map((e) => e.actor))];
  const sel = (id, lbl, opts, cur) => '<label class="field">' + lbl + '<select id="' + id + '"><option value="">All</option>' + opts.map((o) => '<option value="' + esc(o) + '"' + (o === cur ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select></label>';
  const v = S.verify;
  const vb = !v ? '<div class="gv-banner info"><div><b>Chain not verified yet in this view.</b> Each entry stores sha256(previous hash | seq | time | actor | role | action | target | detail | outcome). Verifying recomputes every hash from the first entry.</div></div>'
    : v.ok ? '<div class="gv-banner ok"><div><b>✓ Chain intact.</b> ' + v.n + ' entries recomputed from genesis; every link matches. Head <span class="mono">' + esc((v.head || '').slice(0, 16)) + '…</span> · verified ' + gv_ts(v.when) + '</div></div>'
      : '<div class="gv-banner bad"><div><b>✕ Chain broken at entry #' + v.at + '.</b> The stored hash no longer matches its content, so this entry and everything after it cannot be trusted. Verified ' + gv_ts(v.when) + '.</div></div>';
  let t = '';
  if (S.tamper) { const T = S.tamper; t = card('Tamper test result', 'Admin-only drill: proves the chain detects an edited entry.', '<div class="gv-steps">' +
    '<div class="gv-step done"><div class="gv-step-h"><span class="gv-num">1</span><b>Edited entry #' + T.seq + '</b><span class="note">detail changed in memory</span></div><div class="gv-cmp"><div class="h">Before</div><div>' + esc(T.orig) + '</div><div class="h">After</div><div>' + esc(T.orig + T.suffix) + '</div></div></div>' +
    '<div class="gv-step done"><div class="gv-step-h"><span class="gv-num">2</span><b>Verify</b>' + (T.r1.ok ? chip('Not detected', 'bad') : chip('Break detected at #' + T.r1.at, 'good')) + '<span class="ms">' + fmt(T.ms1, 1) + ' ms</span></div></div>' +
    '<div class="gv-step done"><div class="gv-step-h"><span class="gv-num">3</span><b>Restore and re-verify</b>' + (T.r2.ok ? chip('Chain intact again · ' + T.r2.n + ' entries', 'good') : chip('Still broken at #' + T.r2.at, 'bad')) + '<span class="ms">' + fmt(T.ms2, 1) + ' ms</span></div></div></div>'); }
  const kp = '<div class="kpis">' + kpi(full ? 'Session entries' : 'Your entries', fmt(src.length), 'session ' + AUD.session) + kpi('Denied', fmt(src.filter((e) => e.outcome === 'denied').length), 'permission and duty blocks', src.some((e) => e.outcome === 'denied') ? 'warn' : '') +
    kpi('Exports', fmt(src.filter((e) => e.action === 'data.export').length), 'each hashed') + kpi('Agent runs', fmt(src.filter((e) => /^agent\./.test(e.action)).length), 'runs and verifications') +
    kpi('Chain', v ? (v.ok ? 'Intact' : 'Broken') : 'Unverified', v ? v.n + ' entries' : 'press Verify chain', v ? (v.ok ? 'good' : 'bad') : '') + '</div>';
  return kp + vb + (full ? '' : '<div class="lock" style="margin-bottom:12px">🔒 Showing only your own entries in this session. The full organisation log needs the Manager or Admin role.</div>') + t +
    '<div class="filters">' + sel('gv-fa', 'Action type', types, S.act) + sel('gv-fo', 'Outcome', ['ok', 'denied', 'flagged'], S.out) + (full ? sel('gv-fu', 'Actor', actors, S.actor) : '') + '<span class="sp"></span><span class="note">' + rows.length + ' of ' + src.length + ' entries' + (rows.length > 300 ? ' · newest 300 shown' : '') + '</span></div>' +
    card('', '', gv_auTable(rows, 'gv-atbl'));
}
function gv_auBind(el) {
  const S = gv_S.au; const box = el.querySelector('#gv-aubody');
  const f = (id, k) => { const s = box.querySelector('#' + id); if (s) s.onchange = () => { S[k] = s.value; gv_auRefresh(); }; };
  f('gv-fa', 'act'); f('gv-fo', 'out'); f('gv-fu', 'actor');
}
function gv_auRefresh() {
  const el = gv_el.au; if (!el || R.page !== 'audit' || !el.isConnected) return; const box = el.querySelector('#gv-aubody'); if (!box) return;
  if (gv_S.au.tab === 'session') { box.innerHTML = gv_auBody(); gv_auBind(el); }
}
async function gv_auOrg(el) {
  const box = el.querySelector('#gv-aubody'); if (!can('audit')) { box.innerHTML = '<div class="lock">🔒 The organisation audit log needs the Manager or Admin role (perm “audit”). Your own session entries are on the Session chain tab.</div>'; return; }
  box.innerHTML = '<div class="empty">Loading the organisation log…</div>';
  let rows = []; try { rows = await sList('audit'); } catch (e) {}
  if (R.page !== 'audit' || gv_S.au.tab !== 'org') return;
  gv_S.au.org = rows; const sessions = new Set(rows.map((r) => r.session)).size;
  const fr = gv_auRows(rows).slice().sort((a, b) => (a.at < b.at ? -1 : 1));
  box.innerHTML = '<div class="kpis">' + kpi('Org entries', fmt(rows.length), STORE.mode === 'db' ? 'shared team store' : 'this browser (last 400)') + kpi('Sessions', fmt(sessions), 'distinct sign-ins') + kpi('Denied', fmt(rows.filter((r) => r.outcome === 'denied').length), 'across sessions') + kpi('Actors', fmt(new Set(rows.map((r) => r.actor)).size), 'people and services') + '</div>' +
    '<div class="gv-banner info"><div>The organisation log collects every session’s entries in the ' + (STORE.mode === 'db' ? 'shared team store' : 'browser store (the shared team store is used when granted)') + '. Each session keeps its own hash chain; the session id ties an entry to its chain.</div></div>' +
    card('', '', gv_auTable(fr, 'gv-otbl', true));
}
function gv_auRender(el) {
  gv_el.au = el; const S = gv_S.au; const full = can('audit');
  if (S.tab === 'org' && !full) S.tab = 'session';
  el.innerHTML = pgHead('Audit log', 'A tamper-evident record of who did what. Every sign-in, export, agent run, report decision and denied action is chained with SHA-256, so editing any past entry breaks every hash after it.',
    '<button class="btn pri" id="gv-ver">Verify chain</button>' + (can('admin') ? '<button class="btn" id="gv-tam">Run tamper test</button>' : '') + '<button class="btn" id="gv-acsv">Export CSV' + lockBtn('export') + '</button>') +
    '<div class="tabs" role="tablist">' + [['session', 'Session chain'], ['org', 'Organisation log' + (full ? '' : ' 🔒')], ['policy', 'Retention & policy']].map(([k, l]) => '<button role="tab" data-tab="' + k + '" aria-selected="' + (S.tab === k) + '">' + l + '</button>').join('') + '</div>' +
    '<div id="gv-aubody"></div>';
  const box = el.querySelector('#gv-aubody');
  if (S.tab === 'session') { box.innerHTML = gv_auBody(); gv_auBind(el); }
  else if (S.tab === 'org') gv_auOrg(el);
  else box.innerHTML = gv_auPolicy();
  el.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { if (b.dataset.tab === 'org' && !can('audit')) { deny('audit', 'Organisation audit log'); return; } S.tab = b.dataset.tab; gv_auRender(el); }; });
  el.querySelector('#gv-ver').onclick = async () => { const t0 = performance.now(); const r = await verifyChain(); S.verify = Object.assign({ when: new Date().toISOString(), ms: performance.now() - t0 }, r); audit('audit.verify', 'session ' + AUD.session, r.ok ? 'Chain intact · ' + r.n + ' entries' : 'Break at #' + r.at, r.ok ? 'ok' : 'flagged'); if (S.tab !== 'session') { S.tab = 'session'; gv_auRender(el); } else gv_auRefresh(); };
  const tm = el.querySelector('#gv-tam'); if (tm) tm.onclick = async () => {
    if (!gate('admin', 'Audit tamper test')) return; tm.disabled = true;
    await AUD.q; const n = AUD.log.length; if (n < 2) { toast('Need at least two entries.'); tm.disabled = false; return; }
    const e = AUD.log[(S.sel && AUD.log[S.sel - 1]) ? S.sel - 1 : Math.max(0, Math.floor(n / 2) - 1)]; const orig = e.detail, suffix = ' [edited by tamper test]';
    let t0 = performance.now(); e.detail = orig + suffix; let r1; try { r1 = await verifyChain(); } finally { e.detail = orig; }
    const ms1 = performance.now() - t0; t0 = performance.now(); const r2 = await verifyChain(); const ms2 = performance.now() - t0;
    S.tamper = { seq: e.seq, orig, suffix, r1, r2, ms1, ms2 }; S.verify = Object.assign({ when: new Date().toISOString() }, r2);
    audit('audit.tamper_test', '#' + e.seq, (r1.ok ? 'NOT detected' : 'Break detected at #' + r1.at) + '; restored and re-verified: ' + (r2.ok ? 'intact' : 'broken at #' + r2.at), r1.ok ? 'flagged' : 'ok');
    S.tab = 'session'; gv_auRender(el);
  };
  el.querySelector('#gv-acsv').onclick = () => { const src = S.tab === 'org' && S.org ? S.org : full ? AUD.log : AUD.log.filter((x) => x.actor === me().name); const rows = gv_auRows(src).map((x) => ({ seq: x.seq, session: x.session, at: x.at, actor: x.actor, role: x.role, action: x.action, target: x.target, detail: x.detail, outcome: x.outcome, prev: x.prev, hash: x.hash })); exportFile('audit-' + (S.tab === 'org' ? 'org' : 'session-' + AUD.session) + '.csv', toCSV(rows) || 'seq,session,at,actor,role,action,target,detail,outcome,prev,hash\n', 'text/csv', 'Audit log (CSV, ' + rows.length + ' entries)'); };
}
function gv_auPolicy() {
  const kv = (rows) => '<dl class="kv">' + rows.map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('') + '</dl>';
  return '<div class="grid"><div class="s6">' + card('Retention policy', 'How long audit evidence is kept and where.', kv([['Retention', '<b>400 days</b> online, then archived for 7 years'], ['Demo storage', STORE.mode === 'db' ? 'Shared team store' : 'This browser (last 400 entries)'], ['Production storage', 'Azure Blob Storage with immutable (WORM) retention policy ' + chip('Planned', 'warn')], ['Monitoring', 'Streams to Log Analytics and Microsoft Sentinel ' + chip('Planned', 'warn')], ['Legal hold', 'Per-tenant hold flag blocks deletion ' + chip('Planned', 'warn')], ['Who can read', 'Manager and Admin roles (perm “audit”); everyone sees their own entries']])) + '</div>' +
    '<div class="s6">' + card('Integrity model', 'Why an edited entry is detectable.', kv([['Algorithm', 'SHA-256 (Web Crypto)'], ['Link', '<span class="mono">hash = sha256(prev | seq | at | actor | role | action | target | detail | outcome)</span>'], ['Genesis', '<span class="mono">' + '0'.repeat(16) + '…</span> (64 zeros)'], ['Current head', '<span class="mono">' + esc(AUD.head.slice(0, 24)) + '…</span>'], ['Session', '<span class="mono">' + esc(AUD.session) + '</span> · ' + AUD.log.length + ' entries'], ['Identity', 'Demo role switcher; production uses Microsoft Entra ID groups ' + chip('Simulated in demo', 'info')]])) + '</div>' +
    '<div class="s12">' + card('What is recorded', 'Every audited action type seen in this session.', tbl([{ k: 'type', l: 'Type', f: (r) => '<span class="mono">' + esc(r.type) + '</span>' }, { k: 'n', l: 'Entries', r: true }, { k: 'ex', l: 'Example', cls: 'wrap', f: (r) => '<span class="sub">' + esc(r.ex) + '</span>' }],
      [...new Set(AUD.log.map((e) => e.action))].map((a) => { const l = AUD.log.filter((e) => e.action === a); return { type: a, n: l.length, ex: l[l.length - 1].target + ' · ' + l[l.length - 1].detail }; }), { id: 'gv-atypes' })) + '</div></div>';
}
(function gv_hookAudit() {
  const prev = onAudit;
  let pend = false;
  onAudit = (e) => {
    if (typeof prev === 'function') { try { prev(e); } catch (x) { console.error(x); } }
    if (R.page !== 'audit' || pend) return; pend = true;
    AUD.q.then(() => { pend = false; gv_auRefresh(); });
  };
})();
page({ id: 'audit', title: 'Audit log', render: (el) => gv_auRender(el) });

// ===================================================================================================
// DATA CATALOGUE
// ===================================================================================================
let gv_ctCache = null;
function gv_ctData() {
  if (gv_ctCache && gv_ctCache.n === D.matches.length) return gv_ctCache;
  const M = D.matches;
  const matches = M.map((m) => ({ id: m.id, date: m.date, matchday: m.matchday, home: m.home, away: m.away, score: m.score.join('-'), stadium: (m.setup || {}).stadium, city: (m.setup || {}).city, kickoff: (m.setup || {}).kickoff, formations: ((m.sum || {}).formations || []).join(' v '), events: (m.events || []).length, frames: (m.frames || []).length, verifierPct: (m.verifier || {}).passRatePct }));
  const events = []; for (const m of M) for (const e of m.events || []) events.push(Object.assign({ match: m.id }, e));
  const frames = { count: sum(M, (m) => (m.frames || []).length), sample: M[0] && M[0].frames ? M[0].frames.slice(0, 5).map((f) => ({ match: M[0].id, m: f.m, f: f.f, b: f.b, p: f.p })) : [] };
  const players = D.players.map((p) => ({ name: p.name, team: p.team, num: p.num, pos: p.pos, group: p.group, abil: p.abil, apps: p.apps, rating: p.rating, goals: p.goals, xg: p.xg, shots: p.shots, passes: p.passes, done: p.done, passPct: p.passPct, wins: p.wins, tackles: p.tackles, per90: p.per90, top: p.top }));
  const table = D.table.map((t) => ({ pos: t.pos, key: t.key, p: t.p, w: t.w, d: t.d, l: t.l, gf: t.gf, ga: t.ga, gd: t.gd, pts: t.pts, xg: t.xg, xga: t.xga, xgd: t.xgd, form: t.form.join('') }));
  const preds = []; for (const m of M) { const res = {}; for (const e of m.events || []) if (e.type === 'prediction_result') res[e.id] = e; for (const e of m.events || []) if (e.type === 'prediction') { const r = res[e.id]; preds.push({ match: m.id, id: e.id, minute: e.minute, kind: e.kind, subject: e.subject, claim: e.claim, p: e.p, horizonMin: e.horizonMin, settled: !!r, happened: r ? r.happened : null, note: r ? r.note : null }); } }
  const insights = events.filter((e) => e.type === 'insight').map((e) => ({ match: e.match, id: e.id, minute: e.minute, agent: e.agent, kind: e.kind, status: e.status, text: e.text }));
  return (gv_ctCache = { n: M.length, matches, events, frames, players, table, preds, insights });
}
const gv_DS = [
  { id: 'matches', name: 'Matches', owner: 'Data platform team (Alex Chen)', desc: 'One row per simulated match: fixture, venue, score, shapes and the engine’s Verifier pass rate. The anchor every other dataset joins to.', rows: (C) => C.matches,
    fields: [['id', 'string', 'Match id, M + fixture index'], ['date', 'date', 'Match date (ISO)'], ['matchday', 'int', 'Round of the season'], ['home', 'club key', 'Home club'], ['away', 'club key', 'Away club'], ['score', 'string', 'Final score home-away'], ['stadium', 'string', 'Venue'], ['city', 'string', 'Venue city'], ['kickoff', 'time', 'Local kick-off'], ['formations', 'string', 'Starting shapes'], ['events', 'int', 'Events in the match'], ['frames', 'int', 'Tracking frames'], ['verifierPct', 'float', 'In-match Verifier pass rate %']] },
  { id: 'events', name: 'Events', owner: 'Data platform team', desc: 'Every on-ball and match event from the simulator stream, with ball position and attack-normalised coordinates. Agent outputs (insight, prediction) travel in the same stream.', rows: (C) => C.events,
    fields: [['match', 'string', 'Match id (FK → Matches)'], ['minute', 'float', 'Match minute'], ['type', 'enum', 'pass, shot, goal, turnover, foul, insight, prediction…'], ['team', 'club key', 'Acting team'], ['player', 'string', 'Acting player'], ['to', 'string', 'Pass receiver'], ['kind', 'string', 'Sub-type (pass kind, shot kind, prediction kind)'], ['xg', 'float', 'Shot expected goals'], ['bx', 'float', 'Ball x, 0–105 m'], ['by', 'float', 'Ball y, 0–68 m'], ['ax', 'float', 'x normalised so the team attacks → 105'], ['ay', 'float', 'y normalised with ax']] },
  { id: 'frames', name: 'Tracking frames', owner: 'Performance analysis (Priya Raman)', desc: 'Positions of the ball and all 22 players every 0.5 match minutes, in world coordinates. Teams swap ends at half-time (f = 1).', rows: (C) => C.frames.sample, count: (C) => C.frames.count,
    fields: [['match', 'string', 'Match id (FK → Matches)'], ['m', 'float', 'Match minute'], ['f', 'int', '0 first half, 1 after half-time'], ['b', '[x, y]', 'Ball position'], ['p', '[[x, y] | null] × 22', 'Players in m.pids order; 0–10 home, 11–21 away']] },
  { id: 'players', name: 'Player season stats', owner: 'Performance analysis (Priya Raman)', desc: 'Season aggregates per player, summed from match lines (events plus engine tracking). Ratings follow the published formula.', rows: (C) => C.players,
    fields: [['name', 'string', 'Player'], ['team', 'club key', 'Club'], ['num', 'int', 'Shirt number'], ['pos', 'string', 'Position'], ['group', 'enum', 'GK, DEF, MID, ATT'], ['abil', 'int', 'Engine ability rating'], ['apps', 'int', 'Appearances'], ['rating', 'float', 'Average match rating'], ['goals', 'int', 'Goals (own goals excluded)'], ['xg', 'float', 'Expected goals'], ['shots', 'int', 'Shots'], ['passes', 'int', 'Passes attempted'], ['done', 'int', 'Passes completed'], ['passPct', 'int', 'Completion %'], ['wins', 'int', 'Ball wins'], ['tackles', 'int', 'Tackles'], ['per90', 'float', 'Distance per 90 minutes (km/90)'], ['top', 'float', 'Top speed km/h']] },
  { id: 'table', name: 'League table', owner: 'Data platform team', desc: 'Standings computed from match results, with expected-goals columns. Recomputed whenever a match is ingested.', rows: (C) => C.table,
    fields: [['pos', 'int', 'Position'], ['key', 'club key', 'Club'], ['p', 'int', 'Played'], ['w', 'int', 'Won'], ['d', 'int', 'Drawn'], ['l', 'int', 'Lost'], ['gf', 'int', 'Goals for'], ['ga', 'int', 'Goals against'], ['gd', 'int', 'Goal difference'], ['pts', 'int', 'Points'], ['xg', 'float', 'xG for'], ['xga', 'float', 'xG against'], ['xgd', 'float', 'xG difference'], ['form', 'string', 'Results in order']] },
  { id: 'preds', name: 'Predictions', owner: 'Agent operations (Alex Chen)', desc: 'Every Predictor call joined to its settlement: what was claimed, with what probability, and whether it happened.', rows: (C) => C.preds,
    fields: [['match', 'string', 'Match id'], ['id', 'string', 'Prediction id within the match'], ['minute', 'float', 'Minute the call was made'], ['kind', 'enum', 'next_goal, danger, key_player, card, sub, tactical'], ['subject', 'string', 'What the call is about'], ['claim', 'string', 'The call as shown to viewers'], ['p', 'float', 'Predicted probability'], ['horizonMin', 'int', 'Minutes until settlement'], ['settled', 'bool', 'Has a prediction_result'], ['happened', 'bool', 'Outcome'], ['note', 'string', 'Settlement note']] },
  { id: 'insights', name: 'Agent insights', owner: 'Agent operations (Alex Chen)', desc: 'Lines written by in-match agents with the Verifier’s verdict. Only verified lines reach the broadcast feed.', rows: (C) => C.insights,
    fields: [['match', 'string', 'Match id'], ['id', 'int', 'Insight id within the match'], ['minute', 'float', 'Match minute'], ['agent', 'enum', 'Narrator, Analyst, Predictor'], ['kind', 'string', 'moment, pred, tactical'], ['status', 'enum', 'verified, review, rejected'], ['text', 'string', 'The line']] },
];
function gv_checks(C) {
  const M = D.matches; const out = {};
  const ck = (ds, name, bad, n, detail) => (out[ds] = out[ds] || []).push({ name, pass: bad.length === 0, n, bad, detail });
  ck('matches', 'Score equals goal events', M.filter((m) => [m.home, m.away].some((k, i) => (m.events || []).filter((e) => e.type === 'goal' && e.team === k).length !== m.score[i])).map((m) => m.id), M.length, 'goal events per team = final score');
  ck('matches', 'Each match has tracking frames', M.filter((m) => !(m.frames || []).length).map((m) => m.id), M.length, 'frames.length > 0');
  ck('matches', 'Verifier pass rate ≥ 99%', M.filter((m) => ((m.verifier || {}).passRatePct ?? 0) < 99).map((m) => m.id + ' ' + (m.verifier || {}).passRatePct + '%'), M.length, 'm.verifier.passRatePct');
  ck('matches', 'Match ids unique', M.filter((m, i) => M.findIndex((x) => x.id === m.id) !== i).map((m) => m.id), M.length, 'primary key');
  const ev = C.events, goals = ev.filter((e) => e.type === 'goal');
  ck('events', 'No event outside 0–130 minutes', ev.filter((e) => !(e.minute >= 0 && e.minute <= 130)).map((e) => e.match + ' ' + e.type + ' @' + e.minute), ev.length, 'minute ∈ [0, 130]');
  ck('events', 'Every goal has a preceding shot or is an own goal', goals.filter((g) => !g.ownGoal && !ev.some((e) => e.match === g.match && e.type === 'shot' && e.team === g.team && e.minute <= g.minute && e.minute >= g.minute - 2)).map((g) => g.match + ' ' + Math.round(g.minute) + '′ ' + g.player + ' (' + g.how + ')'), goals.length, 'shot by the scoring team within 2 minutes before');
  const keys = new Set(D.clubs.map((c) => c.key));
  ck('events', 'Team keys are known clubs', ev.filter((e) => e.team && !keys.has(e.team)).map((e) => e.match + ' ' + e.team), ev.filter((e) => e.team).length, 'team ∈ league clubs');
  ck('events', 'Ball inside the pitch area', ev.filter((e) => e.bx != null && (e.bx < -5 || e.bx > 110 || e.by < -5 || e.by > 73)).map((e) => e.match + ' ' + e.type + ' (' + e.bx + ', ' + e.by + ')'), ev.filter((e) => e.bx != null).length, 'bx ∈ [−5, 110], by ∈ [−5, 73]');
  const tm = []; for (const m of M) for (const k of [m.home, m.away]) tm.push({ id: m.id + ' ' + k, v: pct(m.ts[k].done, m.ts[k].passes), n: m.ts[k].passes });
  ck('matches', 'Team pass completion between 40 and 100%', tm.filter((x) => x.n && (x.v < 40 || x.v > 100)).map((x) => x.id + ' ' + x.v + '%'), tm.length, 'per team per match');
  const dup = []; for (const c of D.clubs) { const ns = D.players.filter((p) => p.team === c.key).map((p) => p.name); ns.forEach((n, i) => { if (ns.indexOf(n) !== i) dup.push(c.key + ' ' + n); }); }
  ck('players', 'Player names unique per club', dup, D.players.length, 'name + club is a key');
  const played = {}; for (const m of M) for (const k of [m.home, m.away]) played[k] = (played[k] || 0) + 1;
  ck('players', 'Appearances ≤ club matches', D.players.filter((p) => p.apps > (played[p.team] || 0)).map((p) => p.name), D.players.length, 'apps ≤ matches played');
  const fb = []; for (const m of M) for (const f of m.frames || []) { if (!f.p || f.p.length !== 22) { fb.push(m.id + ' @' + f.m); if (fb.length > 20) break; } }
  ck('frames', '22 player slots per frame', fb, C.frames.count, 'p.length = 22');
  ck('frames', 'Each match has frames', M.filter((m) => !(m.frames || []).length).map((m) => m.id), M.length, 'frames.length > 0');
  const fm = M.filter((m) => { const f = m.frames || []; for (let i = 1; i < f.length; i++) if (f[i].m < f[i - 1].m) return true; return false; }).map((m) => m.id);
  ck('frames', 'Frame minutes increase', fm, M.length, 'm is non-decreasing');
  ck('table', 'Points = 3 × wins + draws', D.table.filter((t) => t.pts !== 3 * t.w + t.d).map((t) => t.key), D.table.length, 'per club');
  ck('table', 'Goals for = goals against (league total)', sum(D.table, (t) => t.gf) === sum(D.table, (t) => t.ga) ? [] : ['Σgf ' + sum(D.table, (t) => t.gf) + ' ≠ Σga ' + sum(D.table, (t) => t.ga)], 1, 'Σ gf = Σ ga');
  ck('table', 'Played = W + D + L', D.table.filter((t) => t.p !== t.w + t.d + t.l).map((t) => t.key), D.table.length, 'per club');
  ck('preds', 'Probabilities within 0–1', C.preds.filter((p) => !(p.p >= 0 && p.p <= 1)).map((p) => p.match + ' ' + p.id), C.preds.length, 'p ∈ [0, 1]');
  ck('preds', 'Every prediction is settled', C.preds.filter((p) => !p.settled).map((p) => p.match + ' ' + p.id), C.preds.length, 'has a prediction_result');
  ck('insights', 'Verdict is a known status', C.insights.filter((x) => !['verified', 'review', 'rejected'].includes(x.status)).map((x) => x.match + ' #' + x.id), C.insights.length, 'status ∈ {verified, review, rejected}');
  ck('insights', 'Agent is a registered agent', C.insights.filter((x) => !['Narrator', 'Analyst', 'Predictor', 'Verifier'].includes(x.agent)).map((x) => x.match + ' ' + x.agent), C.insights.length, 'agent ∈ roster');
  return out;
}
const gv_ex = (v) => { if (v == null) return '<span class="sub">null</span>'; if (Array.isArray(v)) { const s = JSON.stringify(v); return '<span class="mono">' + esc(s.length > 40 ? s.slice(0, 38) + '… (' + v.length + ' items)' : s) + '</span>'; } if (typeof v === 'object') return '<span class="mono">' + esc(JSON.stringify(v).slice(0, 40)) + '</span>'; const s = String(v); return '<span class="mono">' + esc(s.length > 48 ? s.slice(0, 46) + '…' : s) + '</span>'; };
function gv_lineage(ds) {
  const hi = { matches: ['sim', 'ev'], events: ['ev'], frames: ['ev'], players: ['der'], table: ['der'], preds: ['sim', 'ev'], insights: ['sim', 'ev', 'ag'] }[ds] || [];
  const W = 940, bw = 150, bh = 50, gap = (W - 40 - 5 * bw) / 4;
  const node = (i, y, id, t, s, pl) => { const x = 20 + i * (bw + gap); return '<g class="nd' + (pl ? ' pl' : '') + (hi.includes(id) ? ' hi' : '') + '"><rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh + '" rx="7"/><text x="' + (x + bw / 2) + '" y="' + (y + 21) + '" text-anchor="middle">' + esc(t) + '</text><text class="s" x="' + (x + bw / 2) + '" y="' + (y + 37) + '" text-anchor="middle">' + esc(s) + '</text></g>'; };
  const arr = (i, y, pl) => { const x1 = 20 + i * (bw + gap) + bw, x2 = x1 + gap; return '<line class="ar' + (pl ? ' pl' : '') + '" x1="' + (x1 + 3) + '" y1="' + (y + bh / 2) + '" x2="' + (x2 - 7) + '" y2="' + (y + bh / 2) + '"/><path class="ah" d="M' + (x2 - 2) + ' ' + (y + bh / 2) + ' l-7 -4 v8 z"/>'; };
  const y1 = 26, y2 = 132;
  let s = '<div class="tw"><svg class="gv-lin" viewBox="0 0 ' + W + ' 196" width="100%" role="img" aria-label="Data lineage: simulator to console today, and the planned Azure path" style="display:block;height:auto">';
  s += '<text class="lane" x="20" y="16">TODAY · DEMO</text><text class="lane" x="20" y="122">PLANNED ON AZURE</text>';
  const a = [['sim', 'MatchCast simulator', 'engine + in-match agents'], ['ev', 'Event stream', 'JSON per match'], ['der', 'Derived metrics', 'team, player, table'], ['ag', 'Reports & agents', 'verified, approved'], ['con', 'This console', 'Harbor City FC']];
  const b = [['eh', 'Azure Event Hubs', 'live ingest'], ['fe', 'Fabric Eventhouse', 'real-time KQL store'], ['db', 'Azure Databricks', 'features + models'], ['fa', 'Foundry agents', 'Agent Service'], ['con2', 'This console', 'Entra ID SSO']];
  a.forEach((n, i) => { s += node(i, y1, n[0], n[1], n[2]); if (i < 4) s += arr(i, y1); });
  b.forEach((n, i) => { s += node(i, y2, n[0], n[1], n[2], true); if (i < 4) s += arr(i, y2, true); });
  return s + '</svg></div>';
}
async function gv_manifest() {
  if (!gate('export', 'Dataset manifest')) return;
  const C = gv_ctData(); const Q = gv_checks(C); const out = { product: 'MatchCast Enterprise', tenant: 'Harbor City FC', dataVersion: D.version, season: D.league.season, competition: D.league.competition, generatedAt: new Date().toISOString(), classification: 'Synthetic · Internal', datasets: [] };
  for (const d of gv_DS) {
    const rows = d.id === 'frames' ? D.matches.map((m) => ({ id: m.id, frames: m.frames })) : d.rows(C);
    out.datasets.push({ id: d.id, name: d.name, owner: d.owner, rows: d.count ? d.count(C) : rows.length, fields: d.fields.map((f) => f[0]), sha256: await sha(JSON.stringify(rows)), qualityChecks: (Q[d.id] || []).map((q) => ({ name: q.name, pass: q.pass, failures: q.bad.length })) });
  }
  exportFile('matchcast-dataset-manifest.json', JSON.stringify(out, null, 2), 'application/json', 'Dataset manifest (JSON)');
}
function gv_ctRender(el) {
  const C = gv_ctData(); const Q = gv_checks(C); const S = gv_S.ct;
  const d = gv_DS.find((x) => x.id === S.ds) || gv_DS[0];
  const count = (x) => (x.count ? x.count(C) : x.rows(C).length);
  const allQ = Object.values(Q).flat(); const qPass = allQ.filter((q) => q.pass).length;
  const last = gv_lastMatch();
  let h = pgHead('Data catalogue', 'Every dataset behind the console: what it holds, who owns it, its schema, live quality checks and where it comes from. All data in this tenant is synthetic, produced by the MatchCast simulator.',
    '<button class="btn pri" id="gv-man">Export dataset manifest' + lockBtn('export') + '</button>');
  h += '<div class="kpis">' + kpi('Datasets', gv_DS.length, 'classification Synthetic · Internal') + kpi('Rows', fmt(sum(gv_DS, count)), fmt(C.events.length) + ' events · ' + fmt(C.frames.count) + ' frames') + kpi('Quality checks', qPass + '<small>/ ' + allQ.length + '</small>', allQ.length - qPass ? (allQ.length - qPass) + ' failing, see below' : 'all passing', qPass === allQ.length ? 'good' : 'warn') + kpi('Freshness', last ? dateLbl(last.date) : '–', 'latest match · data ' + D.version) + '</div>';
  const list = '<div class="gv-ds" role="group" aria-label="Datasets">' + gv_DS.map((x) => { const q = Q[x.id] || []; const f = q.filter((c) => !c.pass).length; return '<button data-ds="' + x.id + '" aria-pressed="' + (x.id === d.id) + '"><span>' + esc(x.name) + (f ? ' <span class="chip warn" style="margin-left:4px">' + f + ' failing</span>' : '') + '</span><span class="c">' + fmt(count(x)) + '</span></button>'; }).join('') + '</div>';
  const rows = d.rows(C); const ex = (k) => { const r = rows.find((x) => x[k] != null && x[k] !== ''); return r ? r[k] : null; };
  const q = Q[d.id] || [];
  const meta = '<dl class="kv"><dt>Owner</dt><dd>' + esc(d.owner) + '</dd><dt>Classification</dt><dd>' + chip('Synthetic', 'info') + ' ' + chip('Internal', '') + '</dd><dt>Rows</dt><dd class="num"><b>' + fmt(count(d)) + '</b></dd><dt>Freshness</dt><dd>Latest match ' + (last ? esc(last.id) + ' · ' + dateLbl(last.date) : '–') + '; loaded ' + gv_t(new Date().toISOString()) + '</dd><dt>Source</dt><dd>MatchCast simulator → <span class="mono">data/M###.json</span>' + (['players', 'table'].includes(d.id) ? ' → derived in console (core.js)' : '') + '</dd><dt>Version</dt><dd class="mono">' + esc(D.version) + '</dd></dl>';
  const sampleCols = d.fields.slice(0, d.id === 'events' ? 9 : 8);
  const sample = rows.slice(0, 5);
  h += '<div class="grid"><div class="gv-s3">' + card('Datasets', '', list) + '</div><div class="gv-s9">' +
    card(esc(d.name), esc(d.desc), meta) +
    '<div class="grid" style="margin-top:14px"><div class="s7">' + card('Schema', d.fields.length + ' fields · examples from the live data', tbl([{ k: 'f', l: 'Field', f: (r) => '<span class="mono"><b>' + esc(r[0]) + '</b></span>' }, { k: 't', l: 'Type', f: (r) => '<span class="sub mono">' + esc(r[1]) + '</span>' }, { k: 'd', l: 'Description', cls: 'wrap', f: (r) => esc(r[2]) }, { k: 'e', l: 'Example', f: (r) => gv_ex(ex(r[0])) }], d.fields, { id: 'gv-schema' })) + '</div>' +
    '<div class="s5">' + card('Quality checks', q.filter((c) => c.pass).length + ' of ' + q.length + ' passing · computed live on load', '<div>' + q.map((c) => '<div class="gv-q">' + (c.pass ? chip('✓ Pass', 'good') : chip('✕ Fail', 'bad')) + '<div style="min-width:0"><div><b>' + esc(c.name) + '</b></div><div class="d">' + esc(c.detail) + ' · ' + (c.pass ? fmt(c.n) + ' checked' : c.bad.length + ' of ' + fmt(c.n) + ' fail') + '</div>' + (c.pass ? '' : '<div class="d mono" style="margin-top:3px;overflow-wrap:anywhere">' + c.bad.slice(0, 4).map(esc).join(' · ') + (c.bad.length > 4 ? ' …' : '') + '</div>') + '</div></div>').join('') + '</div>') + '</div></div>' +
    '<div style="margin-top:14px">' + card('Sample rows', 'First 5 rows' + (d.id === 'frames' ? ' of ' + (D.matches[0] || {}).id : ''), tbl(sampleCols.map((f) => ({ k: f[0], l: f[0], f: (r) => gv_ex(r[f[0]]) })), sample, { id: 'gv-sample' })) + '</div>' +
    '</div></div>';
  h += '<div style="margin-top:14px">' + card('Lineage', 'Where ' + esc(d.name.toLowerCase()) + ' come from (highlighted) and the planned production path on Azure.', gv_lineage(d.id) + legend([['Today (demo)', 'var(--accent)'], ['Planned on Azure', 'var(--line-2)', true]])) + '</div>';
  el.innerHTML = h;
  el.querySelectorAll('[data-ds]').forEach((b) => { b.onclick = () => { S.ds = b.dataset.ds; gv_ctRender(el); }; });
  el.querySelector('#gv-man').onclick = () => gv_manifest();
}
page({ id: 'catalogue', title: 'Data catalogue', render: (el) => gv_ctRender(el) });
