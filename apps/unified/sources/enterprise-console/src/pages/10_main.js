// ---- Workspace pages: Home, Match library (with ingest from the Watch app), Match centre; and the Copilot drawer ----
const OUR = 'HAR';
const mcc = (m, k) => { const p = pairCols(m.home, m.away); return k === m.home ? p[0] : k === m.away ? p[1] : ccol(k); };
const MC = { lib: { md: 'all', club: 'all', q: '', sort: { k: 'date', dir: 'desc' } }, tab: 'ov', ptSort: { k: 'rating', dir: 'desc' }, evF: 'key', evQ: '' };
(() => { const s = document.createElement('style'); s.textContent = `
.mc-score{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:14px}
.mc-team{display:flex;align-items:center;gap:10px;min-width:0}.mc-team.away{justify-content:flex-end;text-align:right}
.mc-team b{font:700 24px/1.05 var(--f-disp);letter-spacing:.02em;overflow-wrap:anywhere}.mc-team small{display:block;color:var(--muted);font-size:12px}
.mc-crest{width:38px;height:38px;border-radius:9px;display:grid;place-items:center;font:700 13px var(--f-mono);color:#fff;flex:none}
.mc-sc{font:700 46px/1 var(--f-disp);letter-spacing:.04em;font-variant-numeric:tabular-nums;text-align:center}.mc-sc small{display:block;font:500 11px var(--f-mono);letter-spacing:.08em;color:var(--muted);text-transform:uppercase}
.mc-goals{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:4px 20px;margin-top:10px;font-size:12.5px;color:var(--ink-2)}.mc-goals div:nth-child(2n){text-align:right}
.mc-cmp{display:grid;grid-template-columns:3.4rem minmax(0,1fr) 3.4rem;gap:4px 10px;align-items:center;font-size:13px}
.mc-cmp .l{text-align:left;font-variant-numeric:tabular-nums;font-weight:600}.mc-cmp .r{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.mc-cmp .m{display:flex;flex-direction:column;gap:3px}.mc-cmp .m span{font-size:11.5px;color:var(--muted);text-align:center}
.mc-cmp .m i{display:flex;height:6px;border-radius:3px;overflow:hidden;background:var(--surface-3)}.mc-cmp .m i b{display:block;height:100%}
.mc-moment{display:grid;grid-template-columns:2.6rem minmax(0,1fr);gap:10px;padding:9px 0;border-top:1px solid var(--line)}.mc-moment:first-child{border-top:0}
.mc-moment .min{font:700 18px var(--f-disp);color:var(--accent)}.mc-moment .t{font-weight:600}.mc-moment p{margin:2px 0 0;font-size:12.5px;color:var(--muted)}
.mc-recap{white-space:pre-wrap;font-size:13.5px;line-height:1.6;color:var(--ink-2);max-width:75ch}
.mc-q{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.mc-tool{display:flex;gap:10px;align-items:flex-start;text-align:left;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px;color:var(--ink)}
.mc-tool:hover{border-color:var(--accent)}.mc-tool svg{width:20px;height:20px;color:var(--accent);flex:none;margin-top:1px}.mc-tool b{display:block;font-size:13.5px}.mc-tool span{font-size:12px;color:var(--muted)}
.mc-drop{border:1.5px dashed var(--line-2);border-radius:8px;padding:14px;text-align:center;color:var(--muted);font-size:13px}
.mc-drop.on{border-color:var(--accent);background:var(--accent-soft)}
.mc-form{display:inline-flex;gap:3px}.mc-form .chip{padding:3px 6px;min-width:22px;justify-content:center}
tr.us td{background:var(--accent-soft)}
`; document.head.appendChild(s); })();
const crest = (k) => '<span class="mc-crest" style="background:' + col(k) + '">' + esc(k) + '</span>';
const mc_form = (f) => '<span class="mc-form">' + f.slice(-5).map((r) => resChip(r)).join('') + '</span>';
const minLbl = (m) => Math.floor(m) + '′';

// average positions in each player's own attacking direction (→), optionally for one half
function mcAvgPos(m, half) {
  const acc = (m.pids || []).map(() => ({ x: 0, y: 0, n: 0 }));
  for (const fr of m.frames || []) {
    if (half && (fr.f ? 2 : 1) !== half) continue;
    fr.p.forEach((q, i) => { if (!q) return; const flip = i < 11 ? fr.f === 1 : fr.f === 0; acc[i].x += flip ? 105 - q[0] : q[0]; acc[i].y += flip ? 68 - q[1] : q[1]; acc[i].n++; });
  }
  return acc.map((a, i) => (a.n ? { x: a.x / a.n, y: a.y / a.n, n: a.n, pid: m.pids[i], i } : null));
}
function mcXgRace(m) {
  const S = { [m.home]: [[0, 0]], [m.away]: [[0, 0]] }, tot = { [m.home]: 0, [m.away]: 0 }, marks = [];
  const end = Math.max(90, ...(m.events || []).map((e) => e.minute || 0));
  for (const e of m.events) {
    if (e.type === 'shot' && S[e.team]) { tot[e.team] += e.xg || 0; S[e.team].push([e.minute, +tot[e.team].toFixed(3)]); }
    if (e.type === 'goal') { const k = e.ownGoal ? (e.team === m.home ? m.away : m.home) : e.team; const tk = S[k] ? k : e.team; if (S[tk]) marks.push({ x: e.minute, y: tot[tk], color: mcc(m, tk), title: minLbl(e.minute) + ' ' + (e.player || '') + (e.ownGoal ? ' (own goal)' : '') }); }
  }
  for (const k in S) S[k].push([end, +tot[k].toFixed(3)]);
  return { series: [{ name: clubName(m.home), color: mcc(m, m.home), pts: S[m.home], step: true }, { name: clubName(m.away), color: mcc(m, m.away), pts: S[m.away], step: true, dash: true }], marks, end };
}
function mcGoals(m) { return (m.events || []).filter((e) => e.type === 'goal').map((e) => ({ min: e.minute, player: e.player, own: e.ownGoal, side: e.ownGoal ? (e.team === m.home ? m.away : m.home) : e.team })); }

// ================================================================ HOME
page({ id: 'home', title: 'Home', render(el) {
  const t = D.table.find((x) => x.key === OUR) || {}; const ours = D.matches.filter((m) => !m.imported && (m.home === OUR || m.away === OUR));
  const last = ours[ours.length - 1]; const ver = avg(D.matches, (m) => m.verifier ? m.verifier.passRatePct : 100);
  const ins = D.matches.flatMap((m) => (m.events || []).filter((e) => e.type === 'insight').map((e) => Object.assign({ m }, e)));
  const insOk = ins.filter((e) => e.status === 'verified').length;
  const pr = D.matches.flatMap((m) => (m.events || []).filter((e) => e.type === 'prediction_result'));
  const brier = pr.length ? avg(pr, (e) => Math.pow((e.p || 0) - (e.happened ? 1 : 0), 2)) : null;
  const mdMax = Math.max(...D.matches.map((m) => m.matchday || 0));
  el.innerHTML = pgHead('Good ' + (new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening') + ', ' + esc(me().name.split(' ')[0]), esc(clubName(OUR)) + ' analysis department · ' + esc(D.league.competition) + ' ' + esc(D.league.season) + ' · matchday ' + mdMax + ' complete', '<button class="btn" data-go="library">Match library</button><button class="btn pri" data-go="match.' + (last ? last.id : '') + '">Latest match centre</button>') +
    '<div class="kpis">' + kpi('League position', t.pos + '<small>of ' + D.table.length + '</small>', t.pts + ' pts · ' + t.w + 'W ' + t.d + 'D ' + t.l + 'L') + kpi('Goal difference', (t.gd > 0 ? '+' : '') + t.gd, t.gf + ' scored · ' + t.ga + ' conceded', t.gd > 0 ? 'good' : t.gd < 0 ? 'bad' : '') +
      kpi('xG difference', (t.xgd > 0 ? '+' : '') + fmt(t.xgd, 2), fmt(t.xg, 2) + ' for · ' + fmt(t.xga, 2) + ' against', t.xgd > 0 ? 'good' : t.xgd < 0 ? 'bad' : '') +
      kpi('Verifier pass rate', fmt(ver, 1) + '<small>%</small>', 'Law and motion checks, ' + D.matches.length + ' matches', ver >= 99 ? 'good' : 'warn') +
      kpi('Agent insights verified', pct(insOk, ins.length) + '<small>%</small>', insOk + ' of ' + ins.length + ' in-match insights') + kpi('Prediction Brier score', brier == null ? '–' : fmt(brier, 3), 'Lower is better · ' + pr.length + ' resolved calls') + '</div>' +
    '<div class="grid">' +
      '<div class="s7">' + card('League table', 'Points first, then goal difference. xG columns show whether results match chance quality.', mcTable(), '<button class="btn sm" id="h-tcsv">Export CSV' + lockBtn('export') + '</button>') + '</div>' +
      '<div class="s5" style="display:flex;flex-direction:column;gap:14px">' + (last ? card('Latest match', dateLbl(last.date) + ' · ' + esc(last.setup.stadium), mcMini(last), '<button class="btn sm" data-go="match.' + last.id + '">Open</button>') : '') + card('Approvals and work', 'Shared with your team', '<div id="h-work"><div class="empty">Loading…</div></div>') + '</div>' +
      '<div class="s7">' + card(esc(clubName(OUR)) + ' chance quality by match', 'Expected goals for (solid) and against (dashed), per match. Source: shot events, engine xG model.', mcFormChart(ours)) + '</div>' +
      '<div class="s5">' + card('What the agents flagged this matchday', 'In-match insights from the Narrator and Analyst agents, with the Verifier’s verdict', mcInsights(ins.filter((e) => e.m.matchday === mdMax).slice(-6).reverse())) + '</div>' +
      '<div class="s12">' + card('Tools', '', '<div class="mc-q">' + [['explorer', 'Query explorer', 'Build any cut of the event data'], ['scouting', 'Scouting', 'Find, profile and compare players'], ['opposition', 'Opposition report', 'Auto-built dossier on the next opponent'], ['setpieces', 'Set pieces', 'Corners, free kicks and throw-ins'], ['board', 'Tactical board', 'Replay tracking data and draw on it'], ['reports', 'Reports & approvals', 'Draft, approve and release reports']].filter((x) => PAGES[x[0]]).map(([id, l, s]) => '<button class="mc-tool" data-go="' + id + '">' + icon(id) + '<div><b>' + l + '</b><span>' + s + '</span></div></button>').join('') + '</div>') + '</div>' +
    '</div>';
  el.querySelectorAll('#h-table tr.click').forEach((tr) => { tr.onclick = () => go('scouting', 'club-' + tr.dataset.i); });
  const b = $('#h-tcsv', el); if (b) b.onclick = () => exportFile('league_table.csv', toCSV(D.table.map((x) => ({ pos: x.pos, club: clubName(x.key), p: x.p, w: x.w, d: x.d, l: x.l, gf: x.gf, ga: x.ga, gd: x.gd, pts: x.pts, xg: x.xg, xga: x.xga, xgd: x.xgd }))), 'text/csv', 'League table (CSV)');
  mcWork($('#h-work', el));
} });
function mcTable() {
  const rows = D.table; const cols = [{ k: 'pos', l: '#', r: 1 }, { k: 'key', l: 'Club', f: (r) => clubTag(r.key) }, { k: 'p', l: 'P', r: 1 }, { k: 'w', l: 'W', r: 1 }, { k: 'd', l: 'D', r: 1 }, { k: 'l', l: 'L', r: 1 }, { k: 'gd', l: 'GD', r: 1, f: (r) => (r.gd > 0 ? '+' : '') + r.gd }, { k: 'pts', l: 'Pts', r: 1, f: (r) => '<b>' + r.pts + '</b>' }, { k: 'xg', l: 'xG', r: 1, f: (r) => fmt(r.xg, 1) }, { k: 'xga', l: 'xGA', r: 1, f: (r) => fmt(r.xga, 1) }, { k: 'form', l: 'Form', f: (r) => mc_form(r.form) }];
  return tbl(cols, rows, { id: 'h-table', click: 1, key: (r) => r.key }).replace(/<tr class="click" data-i="HAR"/, '<tr class="click us" data-i="HAR"');
}
function mcMini(m) {
  const g = mcGoals(m);
  return '<div class="mc-score"><div class="mc-team">' + crest(m.home) + '<div><b>' + esc(clubName(m.home)) + '</b><small>' + esc(m.ts[m.home].form) + ' · xG ' + fmt(m.ts[m.home].xg, 2) + '</small></div></div><div class="mc-sc">' + m.score[0] + '–' + m.score[1] + '<small>' + esc(m.sum.ended || 'Full-time') + '</small></div><div class="mc-team away"><div><b>' + esc(clubName(m.away)) + '</b><small>xG ' + fmt(m.ts[m.away].xg, 2) + ' · ' + esc(m.ts[m.away].form) + '</small></div>' + crest(m.away) + '</div></div>' +
    (g.length ? '<div class="mc-goals"><div>' + g.filter((x) => x.side === m.home).map((x) => '⚽ ' + esc(x.player) + ' ' + minLbl(x.min) + (x.own ? ' (og)' : '')).join('<br>') + '</div><div>' + g.filter((x) => x.side !== m.home).map((x) => minLbl(x.min) + ' ' + esc(x.player) + (x.own ? ' (og)' : '') + ' ⚽').join('<br>') + '</div></div>' : '') +
    '<p class="note" style="margin:10px 0 0">' + esc(((m.sum.recap || {}).analyst || '').split('\n')[0]) + '</p>';
}
function mcFormChart(ms) {
  if (!ms.length) return '<div class="empty">No matches yet.</div>';
  const f = ms.map((m, i) => [i + 1, m.ts[OUR].xg]), a = ms.map((m, i) => [i + 1, m.ts[OUR].xga]);
  return lineChart({ series: [{ name: 'xG for', color: 'var(--accent)', pts: f, area: true }, { name: 'xG against', color: 'var(--bad)', pts: a, dash: true }], xMin: 1, xMax: ms.length, xTicks: ms.map((_, i) => i + 1), xFmt: (v) => { const m = ms[v - 1]; return m ? 'MD' + m.matchday + ' ' + (m.home === OUR ? m.away : m.home) : ''; }, h: 210 }) + legend([['xG for', 'var(--accent)'], ['xG against', 'var(--bad)']]);
}
function mcInsights(list) {
  if (!list.length) return '<div class="empty">No agent insights on this matchday.</div>';
  return '<div class="list">' + list.map((e) => '<div class="li"><span class="chip ' + (e.status === 'verified' ? 'good' : e.status === 'rejected' ? 'bad' : 'warn') + '">' + esc(e.status) + '</span><div><div class="t" style="font-weight:500">' + esc(e.text) + '</div><div class="s">' + esc(e.agent) + ' · ' + minLbl(e.minute) + ' · <button class="btn ghost sm" style="padding:0;min-height:0;color:var(--accent)" data-go="match.' + e.m.id + '">' + esc(e.m.title) + '</button></div></div></div>').join('') + '</div>';
}
async function mcWork(box) {
  if (!box) return;
  const reps = await sList('reports').catch(() => []); const pend = reps.filter((r) => r.status === 'pending'); const mine = reps.filter((r) => r.author === me().name).slice(0, 3);
  NAVCNT.reports = pend.length ? { n: pend.length, hot: can('approve') } : null; drawNav();
  box.innerHTML = '<div class="list">' +
    '<div class="li"><span class="chip ' + (pend.length ? 'warn' : 'good') + '">' + pend.length + '</span><div><div class="t">Reports waiting for approval</div><div class="s">' + (pend.length ? pend.slice(0, 2).map((r) => esc(r.title)).join(' · ') : 'Nothing is waiting.') + (can('approve') && pend.length ? ' You can approve these.' : '') + '</div></div><span class="sp"></span>' + (PAGES.reports ? '<button class="btn sm" data-go="reports">Open</button>' : '') + '</div>' +
    '<div class="li"><span class="chip">' + mine.length + '</span><div><div class="t">Your recent reports</div><div class="s">' + (mine.length ? mine.map((r) => esc(r.title) + ' (' + esc(r.status) + ')').join(' · ') : 'You haven’t written a report in this tenant yet.') + '</div></div></div>' +
    '<div class="li"><span class="chip info">' + AUD.log.length + '</span><div><div class="t">Audit entries this session</div><div class="s">Every sign-in, export, agent run and approval is hash-chained.</div></div><span class="sp"></span>' + (PAGES.audit ? '<button class="btn sm" data-go="audit">View</button>' : '') + '</div></div>';
  box.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go); });
}

// ================================================================ MATCH LIBRARY
page({ id: 'library', title: 'Match library', render(el) {
  const F = MC.lib; const mds = [...new Set(D.matches.map((m) => m.matchday))].filter(Boolean).sort((a, b) => a - b);
  const list = D.matches.filter((m) => (F.md === 'all' || String(m.matchday) === F.md || (F.md === 'imp' && m.imported)) && (F.club === 'all' || m.home === F.club || m.away === F.club) && (!F.q || (m.title + ' ' + m.setup.stadium + ' ' + m.setup.city).toLowerCase().includes(F.q.toLowerCase())));
  const goals = sum(D.matches.filter((m) => !m.imported), (m) => m.score[0] + m.score[1]), evs = sum(D.matches, (m) => m.events.length), frs = sum(D.matches, (m) => (m.frames || []).length * 23);
  const cols = [
    { k: 'date', l: 'Date', f: (m) => '<span class="num">' + esc(m.date) + '</span><div class="sub">MD' + (m.matchday || '–') + ' · ' + esc(m.id) + '</div>' },
    { k: 'home', l: 'Home', f: (m) => clubTag(m.home), v: (m) => clubName(m.home) },
    { k: 'score', l: 'Score', f: (m) => '<b class="num">' + m.score[0] + '–' + m.score[1] + '</b>', v: (m) => m.score[0] + m.score[1], sort: false },
    { k: 'away', l: 'Away', f: (m) => clubTag(m.away), v: (m) => clubName(m.away) },
    { k: 'xg', l: 'xG', r: 1, f: (m) => fmt(m.ts[m.home].xg, 2) + '–' + fmt(m.ts[m.away].xg, 2), v: (m) => m.ts[m.home].xg + m.ts[m.away].xg },
    { k: 'venue', l: 'Venue', f: (m) => esc(m.setup.stadium) + '<div class="sub">' + esc(m.setup.city) + ' · ' + esc(m.setup.kickoff || '') + '</div>', v: (m) => m.setup.stadium },
    { k: 'wx', l: 'Weather', f: (m) => esc((m.sum.weatherStart || '–') + (m.sum.weatherEnd && m.sum.weatherEnd !== m.sum.weatherStart ? ' → ' + m.sum.weatherEnd : '')) + '<div class="sub">' + fmt(m.sum.tempMaxC, 0) + '°C</div>', v: (m) => m.sum.tempMaxC },
    { k: 'ev', l: 'Events', r: 1, f: (m) => fmt(m.events.length), v: (m) => m.events.length },
    { k: 'ver', l: 'Verifier', r: 1, f: (m) => chip(fmt(m.verifier ? m.verifier.passRatePct : 0, 1) + '%', (m.verifier ? m.verifier.passRatePct : 0) >= 99.5 ? 'good' : 'warn'), v: (m) => (m.verifier ? m.verifier.passRatePct : 0) },
    { k: 'st', l: 'Status', f: (m) => (m.imported ? chip('Imported', 'info') : chip('Final', 'acc')), sort: false },
  ];
  el.innerHTML = pgHead('Match library', 'Every match in the tenant, played by the MatchCast simulator and ingested with full event and tracking data. Open one to analyse it.', '<button class="btn" id="lib-csv">Export list' + lockBtn('export') + '</button><button class="btn pri" id="lib-imp">Import from Watch' + lockBtn('author') + '</button>', [['Workspace', 'home'], ['Match library']]) +
    '<div class="kpis">' + kpi('Matches', D.matches.length, D.league.competition + ' · ' + mds.length + ' matchdays') + kpi('Goals', goals, fmt(goals / Math.max(1, D.matches.filter((m) => !m.imported).length), 2) + ' per match') + kpi('Events ingested', fmt(evs), 'passes, shots, duels, decisions') + kpi('Tracking points', fmt(frs), '22 players + ball, every 30 match seconds') + '</div>' +
    '<div class="filters"><label class="field">Matchday<select id="lib-md"><option value="all">All</option>' + mds.map((d) => '<option value="' + d + '"' + (String(d) === F.md ? ' selected' : '') + '>Matchday ' + d + '</option>').join('') + (D.matches.some((m) => m.imported) ? '<option value="imp"' + (F.md === 'imp' ? ' selected' : '') + '>Imported</option>' : '') + '</select></label>' +
    '<label class="field">Club<select id="lib-club"><option value="all">All clubs</option>' + D.clubs.map((c) => '<option value="' + c.key + '"' + (c.key === F.club ? ' selected' : '') + '>' + esc(c.club) + '</option>').join('') + '</select></label>' +
    '<label class="field" style="flex:1;min-width:180px">Search<input id="lib-q" value="' + esc(F.q) + '" placeholder="Club, stadium or city"></label><span class="note" style="align-self:center">' + list.length + ' of ' + D.matches.length + ' matches</span></div>' +
    card('', '', tbl(cols, list, { id: 'lib-t', sort: F.sort, click: 1, key: (m) => m.id }), '', 'flat') +
    '<div class="grid" style="margin-top:14px"><div class="s6">' + card('Ingestion', 'How matches reach the library', '<dl class="kv"><dt>Source</dt><dd>MatchCast simulator (the same engine as the Watch app), run headless per fixture</dd><dt>Schema</dt><dd class="mono">matchcast.match/1 · events + tracking + engine summary</dd><dt>Data version</dt><dd class="mono">' + esc(D.version) + '</dd><dt>Checks on ingest</dt><dd>Verifier law and motion checks, score reconciliation, schema validation</dd><dt>Production path</dt><dd>Planned: Azure Event Hubs → Microsoft Fabric Eventhouse → this library</dd></dl>') + '</div>' +
    '<div class="s6">' + card('Import a match from Watch', 'Play a match in the 3D Watch app, download “Full dataset (JSON)” from its Match data panel, and drop it here. It is validated and added for this session.', '<div class="mc-drop" id="lib-drop">Drop a MatchCast dataset JSON here, or <button class="btn sm" id="lib-pick">choose a file</button><input type="file" id="lib-file" accept=".json,application/json" hidden></div><p class="note" id="lib-imsg" style="margin:8px 0 0"></p>') + '</div></div>';
  $('#lib-md', el).onchange = (e) => { F.md = e.target.value; rerender(); };
  $('#lib-club', el).onchange = (e) => { F.club = e.target.value; rerender(); };
  $('#lib-q', el).oninput = (e) => { F.q = e.target.value; clearTimeout(MC.qt); MC.qt = setTimeout(() => { rerender(); const q = $('#lib-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 250); };
  bindTbl(el, 'lib-t', F.sort, rerender, (id) => go('match', id));
  $('#lib-csv', el).onclick = () => exportFile('match_library.csv', toCSV(list.map((m) => ({ id: m.id, date: m.date, matchday: m.matchday, home: clubName(m.home), away: clubName(m.away), score: m.score.join('-'), xg_home: m.ts[m.home].xg, xg_away: m.ts[m.away].xg, stadium: m.setup.stadium, events: m.events.length, verifier_pct: m.verifier ? m.verifier.passRatePct : '' }))), 'text/csv', 'Match library (CSV, ' + list.length + ' rows)');
  const pick = () => { if (gate('author', 'Import match')) $('#lib-file', el).click(); };
  $('#lib-imp', el).onclick = pick; $('#lib-pick', el).onclick = pick;
  $('#lib-file', el).onchange = (e) => { const f = e.target.files[0]; if (f) mcImport(f); };
  const dz = $('#lib-drop', el); dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('on'); }; dz.ondragleave = () => dz.classList.remove('on');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('on'); const f = e.dataTransfer.files[0]; if (f && gate('author', 'Import match')) mcImport(f); };
} });
async function mcImport(file) {
  const msg = (t) => { const m = $('#lib-imsg'); if (m) m.textContent = t; };
  try {
    const text = await file.text(); const ds = JSON.parse(text);
    if (!ds.events || !ds.teams || !ds.summary) throw new Error('This file isn’t a MatchCast dataset (no events, teams or summary).');
    const [H, A] = ds.teams.map((t) => t.key);
    for (const t of ds.teams) if (!D.clubs.find((c) => c.key === t.key)) D.clubs.push({ key: t.key, club: t.club, city: '', color: t === ds.teams[0] ? '#3D86F0' : '#FF7A2E', str: 0, squad: [], guest: true });
    const sc = (ds.summary.result || '').match(/(\d+)-(\d+)/); const trk = ds.summary.playerTracking || [];
    const m = derive({ id: 'W' + String(D.matches.filter((x) => x.imported).length + 1).padStart(3, '0'), imported: true, matchday: null, date: new Date().toISOString().slice(0, 10), home: H, away: A, score: sc ? [+sc[1], +sc[2]] : [0, 0],
      setup: { stadium: ds.setup.stadium, city: ds.setup.city, country: ds.setup.country, month: MONTHS.indexOf(ds.setup.month), kickoff: ds.setup.kickoffLocal, seed: ds.setup.seed, half: ds.setup.halfLengthRealMin }, sum: ds.summary,
      stats: { xg: ds.summary.xg, shots: ds.summary.shots, passes: ds.summary.passes, done: ds.summary.passesCompleted, fouls: ds.summary.fouls, yellows: ds.summary.yellowCards, reds: ds.summary.redCards, offsides: ds.summary.offsides }, events: ds.events, timeline: ds.timeline, frames: [],
      pids: trk.map((t) => ({ name: t.name, team: t.team, num: '' })), roster: {}, verifier: null, generator: ds.generator });
    D.matches.push(m); const h = await sha(text);
    audit('data.ingest', m.id, 'Imported from Watch: ' + m.title + ' · ' + ds.events.length + ' events · sha256 ' + h.slice(0, 16) + '…');
    msg('Imported ' + m.title + ' (' + ds.events.length + ' events). It is in the library for this session and isn’t counted in the league table.'); toast('Match imported · ' + m.title);
    setTimeout(() => go('match', m.id), 600);
  } catch (e) { audit('data.ingest', file.name, 'Rejected: ' + e.message, 'failed'); msg('Import failed: ' + e.message); }
}

// ================================================================ MATCH CENTRE
const MC_TABS = [['ov', 'Overview'], ['team', 'Team stats'], ['ply', 'Players'], ['shots', 'Shots & xG'], ['pass', 'Passing'], ['shape', 'Shape'], ['ev', 'Event log'], ['trust', 'Agents & trust']];
page({ id: 'match', title: 'Match centre', render(el, arg) {
  const m = D.match(arg) || D.matches[D.matches.length - 1]; if (!m) { el.innerHTML = pgHead('Match centre', 'No matches in the library yet.'); return; }
  R.lastMatch = m.id; if (!MC_TABS.some((t) => t[0] === MC.tab)) MC.tab = 'ov';
  const wx = m.sum.weatherStart ? m.sum.weatherStart + (m.sum.weatherEnd && m.sum.weatherEnd !== m.sum.weatherStart ? ' → ' + m.sum.weatherEnd : '') : '';
  el.innerHTML = pgHead(esc(m.title), (m.matchday ? 'Matchday ' + m.matchday + ' · ' : 'Imported from Watch · ') + dateLbl(m.date) + ' · ' + esc(m.setup.stadium) + ', ' + esc(m.setup.city) + ' · kick-off ' + esc(m.setup.kickoff || '–') + (wx ? ' · ' + esc(wx) + ', ' + fmt(m.sum.tempMaxC, 0) + '°C' : ''),
    (m.frames && m.frames.length ? '<button class="btn" data-pip-open="' + m.id + '">Open in PiP window</button>' : '') + (PAGES.board && m.frames && m.frames.length ? '<button class="btn" data-go="board.' + m.id + '">Replay on tactical board</button>' : '') + '<button class="btn" id="mc-ecsv">Events CSV' + lockBtn('export') + '</button><button class="btn" id="mc-json">Match JSON + manifest' + lockBtn('export') + '</button>', [['Match library', 'library'], [m.id]]) +
    '<div class="tabs" role="tablist">' + MC_TABS.map(([k, l]) => '<button role="tab" data-t="' + k + '" aria-selected="' + (MC.tab === k) + '">' + l + '</button>').join('') + '</div><div id="mc-body"></div>';
  el.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => { MC.tab = b.dataset.t; el.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b))); mcTab(m); }; });
  $('#mc-ecsv', el).onclick = () => exportFile(m.id + '_events.csv', toCSV(m.events.map((e) => ({ minute: e.minute, type: e.type, team: e.team || '', player: e.player || '', detail: JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !['minute', 'type', 'team', 'player'].includes(k)))) }))), 'text/csv', 'Event log ' + m.id + ' (CSV, ' + m.events.length + ' rows)');
  $('#mc-json', el).onclick = async () => { const body = JSON.stringify({ id: m.id, date: m.date, home: m.home, away: m.away, score: m.score, setup: m.setup, summary: m.sum, stats: m.stats, events: m.events, frames: m.frames }); const h = await sha(body); exportFile(m.id + '.json', JSON.stringify({ manifest: { schema: 'matchcast.match/1', dataVersion: D.version, match: m.id, rows: { events: m.events.length, frames: (m.frames || []).length }, sha256: h, syntheticData: true, exportedBy: me().name, role: ROLE, exportedAt: new Date().toISOString() }, match: JSON.parse(body) }), 'application/json', 'Match ' + m.id + ' (JSON + manifest)'); };
  mcTab(m);
} });
function mcTab(m) {
  const b = $('#mc-body'); if (!b) return;
  try { b.innerHTML = MC_RENDER[MC.tab](m); if (MC_BIND[MC.tab]) MC_BIND[MC.tab](m, b); } catch (e) { console.error(e); b.innerHTML = '<div class="empty">This view couldn’t be drawn for this match: ' + esc(e.message) + '</div>'; }
}
const mcCmp = (m, rows) => '<div class="list" style="gap:10px">' + rows.map(([l, a, bb, f, inv]) => { const t = (+a || 0) + (+bb || 0); const pa = t ? (100 * (+a || 0)) / t : 50; return '<div class="mc-cmp"><span class="l">' + (f ? f(a) : a) + '</span><div class="m"><span>' + l + '</span><i><b style="width:' + pa.toFixed(1) + '%;background:' + mcc(m, m.home) + '"></b><b style="width:' + (100 - pa).toFixed(1) + '%;background:' + mcc(m, m.away) + ';opacity:.85"></b></i></div><span class="r">' + (f ? f(bb) : bb) + '</span></div>'; }).join('') + '</div>';
const MC_RENDER = {
  ov(m) {
    const xr = mcXgRace(m); const km = ((m.sum.recap || {}).keyMoments || []);
    const H = m.ts[m.home], A = m.ts[m.away];
    return '<div class="grid"><div class="s7">' + card('', '', mcMini(m)) + '</div><div class="s5">' + card('At a glance', '', mcCmp(m, [['Expected goals', H.xg, A.xg, (v) => fmt(v, 2)], ['Shots (on target)', H.shots, A.shots], ['Possession %', H.poss, A.poss], ['Passes completed', H.done, A.done]])) + '</div>' +
      '<div class="s7">' + card('xG race', 'Cumulative expected goals by minute; dots are goals. Source: shot events.', lineChart({ series: xr.series, marks: xr.marks, xMin: 0, xMax: Math.ceil(xr.end), xTicks: [0, 15, 30, 45, 60, 75, 90], xFmt: (v) => v + '′', h: 230 }) + legend([[clubName(m.home), mcc(m, m.home)], [clubName(m.away), mcc(m, m.away), 1]])) + '</div>' +
      '<div class="s5">' + card('Key moments', 'Picked by the Narrator agent from the momentum model', km.length ? km.map((k) => '<div class="mc-moment"><span class="min">' + Math.floor(k.minute) + '′</span><div><span class="t">' + esc(k.title) + '</span>' + (k.turningPoint ? ' ' + chip('Turning point', 'acc') : '') + '<p>' + esc(k.explanation) + '</p></div></div>').join('') : '<div class="empty">No key moments were flagged.</div>') + '</div>' +
      '<div class="s12">' + card('Engine match report', 'Written by the simulator’s template writer from the match numbers. Every figure ties back to the event log.', '<div class="mc-recap">' + esc((m.sum.recap || {}).analyst || 'No report for this match.') + '</div>') + '</div></div>';
  },
  team(m) {
    const H = m.ts[m.home], A = m.ts[m.away];
    const rows = [['Goals', H.goals, A.goals], ['Expected goals', H.xg, A.xg, (v) => fmt(v, 2)], ['Shots', H.shots, A.shots], ['On target', H.onTarget, A.onTarget], ['Possession %', H.poss, A.poss], ['Passes', H.passes, A.passes], ['Passes completed', H.done, A.done], ['Final-third passes', H.finalThird, A.finalThird], ['Ball wins', H.wins, A.wins], ['High ball wins (final third)', H.highWins, A.highWins], ['Take-ons (won)', H.takeOnsWon, A.takeOnsWon], ['Slide tackles', H.tackles, A.tackles], ['Corners', H.corners, A.corners], ['Free kicks won', H.freekicks, A.freekicks], ['Fouls', H.fouls, A.fouls], ['Yellow cards', H.yellows, A.yellows], ['Offsides', H.offsides, A.offsides]];
    return '<div class="grid"><div class="s7">' + card('Team comparison', clubName(m.home) + ' (left) v ' + clubName(m.away) + ' (right)', mcCmp(m, rows)) + '</div><div class="s5">' +
      card('Shape and style', 'Starting shapes and game plans chosen by the tactics engine', '<dl class="kv"><dt>' + esc(clubName(m.home)) + '</dt><dd>' + esc(H.form) + ' · ' + esc(H.style) + '</dd><dt>' + esc(clubName(m.away)) + '</dt><dd>' + esc(A.form) + ' · ' + esc(A.style) + '</dd><dt>Pass completion</dt><dd>' + pct(H.done, H.passes) + '% v ' + pct(A.done, A.passes) + '%</dd><dt>PPDA</dt><dd>' + (H.ppda ?? '–') + ' v ' + (A.ppda ?? '–') + ' <span class="note">(opponent passes in their own 60% per defensive action there; lower = more intense press)</span></dd></dl>') +
      '<div style="height:14px"></div>' + card('Pass types', 'Attempted (completed) by type', mcKinds(m)) + '</div></div>';
  },
  ply(m) {
    const rows = Object.values(m.pm);
    const cols = [{ k: 'num', l: '#', r: 1 }, { k: 'name', l: 'Player', f: (r) => '<span class="dot" style="background:' + col(r.team) + '"></span>' + esc(r.name) + '<div class="sub">' + esc(r.pos) + ' · ' + esc(r.team) + '</div>' }, { k: 'rating', l: 'Rating', r: 1, f: (r) => '<b>' + fmt(r.rating, 1) + '</b>', t: RATING_FORMULA }, { k: 'goals', l: 'G', r: 1 }, { k: 'xg', l: 'xG', r: 1, f: (r) => fmt(r.xg, 2) }, { k: 'shots', l: 'Sh', r: 1 }, { k: 'passes', l: 'Passes', r: 1, f: (r) => r.done + '/' + r.passes }, { k: 'wins', l: 'Ball wins', r: 1 }, { k: 'takeOnsWon', l: 'Take-ons', r: 1, f: (r) => r.takeOnsWon + '/' + r.takeOns }, { k: 'tackles', l: 'Tackles', r: 1 }, { k: 'per90', l: 'Km/90', r: 1, f: (r) => fmt(r.per90, 1), t: 'Distance covered at a per-90-minute pace (the simulation runs a compressed clock)' }, { k: 'top', l: 'Top km/h', r: 1, f: (r) => fmt(r.top, 1) }, { k: 'stamina', l: 'Stamina', r: 1, f: (r) => (r.stamina == null ? '–' : r.stamina + '%') }];
    return card('Player ratings and output', 'Rating = ' + esc(RATING_FORMULA) + '. Tap a player for the scouting profile.', tbl(cols, rows, { id: 'mc-pt', sort: MC.ptSort, click: 1, key: (r) => r.name }));
  },
  shots(m) {
    const sh = m.events.filter((e) => e.type === 'shot'); const gl = mcGoals(m);
    const dot = (e) => { const home = e.team === m.home; const x = home ? (e.ax ?? e.x) : 105 - (e.ax ?? (105 - e.x)), y = home ? (e.ay ?? e.y) : 68 - (e.ay ?? (68 - e.y)); const goal = gl.some((g) => g.player === e.player && Math.abs(g.min - e.minute) < 0.6 && !g.own); return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (0.9 + Math.sqrt(e.xg || 0.01) * 4).toFixed(2) + '" fill="' + mcc(m, e.team) + '" fill-opacity="' + (goal ? 0.95 : 0.45) + '" stroke="' + (goal ? 'var(--ink)' : mcc(m, e.team)) + '" stroke-width="' + (goal ? 0.5 : 0.25) + '"><title>' + minLbl(e.minute) + ' ' + esc(e.player) + ' · xG ' + e.xg + (goal ? ' · GOAL' : '') + '</title></circle>'; };
    const cols = [{ k: 'minute', l: 'Min', r: 1, f: (e) => minLbl(e.minute) }, { k: 'team', l: 'Club', f: (e) => clubTag(e.team) }, { k: 'player', l: 'Player' }, { k: 'kind', l: 'Type', f: (e) => esc(e.kind || '') }, { k: 'xg', l: 'xG', r: 1, f: (e) => fmt(e.xg, 3) }, { k: 'kmh', l: 'km/h', r: 1 }, { k: 'res', l: 'Result', f: (e) => (gl.some((g) => g.player === e.player && Math.abs(g.min - e.minute) < 0.6 && !g.own) ? chip('Goal', 'good') : '') }];
    return '<div class="grid"><div class="s7">' + card('Shot map', clubName(m.home) + ' shoot right → · ' + clubName(m.away) + ' shoot ← left. Size = xG; solid outline = goal.', pitch(sh.map(dot).join(''), { title: 'Shot map' }) + legend([[clubName(m.home), mcc(m, m.home)], [clubName(m.away), mcc(m, m.away)]])) + '</div><div class="s5">' +
      card('Chance quality', '', mcCmp(m, [['xG', m.ts[m.home].xg, m.ts[m.away].xg, (v) => fmt(v, 2)], ['Shots', m.ts[m.home].shots, m.ts[m.away].shots], ['xG per shot', m.ts[m.home].shots ? +(m.ts[m.home].xg / m.ts[m.home].shots).toFixed(3) : 0, m.ts[m.away].shots ? +(m.ts[m.away].xg / m.ts[m.away].shots).toFixed(3) : 0, (v) => fmt(v, 3)], ['Goals', m.score[0], m.score[1]]])) + '</div>' +
      '<div class="s12">' + card('All shots', sh.length + ' shots', tbl(cols, sh, { id: 'mc-sh' })) + '</div></div>';
  },
  pass(m) {
    return '<div class="grid">' + [m.home, m.away].map((k) => '<div class="s6">' + card(esc(clubName(k)) + ' pass network', 'Nodes at average position (attacking →), sized by passes received; lines = passes between a pair (3 or more).', mcNetwork(m, k)) + '</div>').join('') + '</div>';
  },
  shape(m) {
    const draw = (half) => { const ap = mcAvgPos(m, half); return pitch(ap.filter(Boolean).map((p) => { const home = p.i < 11; const x = home ? p.x : 105 - p.x, y = home ? p.y : 68 - p.y; return '<g><circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.3" fill="' + mcc(m, p.pid.team) + '" stroke="var(--surface)" stroke-width=".4"/><text x="' + x.toFixed(1) + '" y="' + (y + 0.9).toFixed(1) + '" text-anchor="middle" style="font-size:2.2px;fill:#fff;font-weight:600">' + (p.pid.num || '') + '</text><title>' + esc(p.pid.name) + '</title></g>'; }).join(''), { title: 'Average positions' }); };
    const has = (m.frames || []).length;
    return has ? '<div class="grid"><div class="s6">' + card('Average positions, first half', clubName(m.home) + ' attack → · ' + clubName(m.away) + ' attack ←. Source: tracking frames every 30 match seconds.', draw(1)) + '</div><div class="s6">' + card('Average positions, second half', 'Same orientation as the first half so shape changes are easy to compare.', draw(2)) + '</div><div class="s12">' + card('Territory', 'Where the ball was, by pitch third, from tracking frames (home attacking →).', mcTerritory(m)) + '</div></div>' : '<div class="empty">This match has no tracking data (imported from Watch). Event views still work.</div>';
  },
  ev(m) {
    const KEY = new Set(['goal', 'shot', 'foul', 'yellow_card', 'red_card', 'corner', 'freekick', 'offside', 'kickoff', 'half_time', 'full_time', 'weather_change', 'tactical_change', 'insight', 'verifier_flag', 'lightning']);
    const types = [...new Set(m.events.map((e) => e.type))].sort();
    let list = m.events.filter((e) => (MC.evF === 'key' ? KEY.has(e.type) : MC.evF === 'all' ? true : e.type === MC.evF));
    if (MC.evQ) list = list.filter((e) => JSON.stringify(e).toLowerCase().includes(MC.evQ.toLowerCase()));
    const det = (e) => { const o = []; for (const k of ['to', 'from', 'on', 'kind', 'how', 'xg', 'move', 'success', 'card', 'claim', 'text', 'status', 'note', 'score', 'formations']) if (e[k] != null && e[k] !== '') o.push((k === 'xg' ? 'xG ' : k === 'to' ? '→ ' : k === 'from' ? 'from ' : k === 'on' ? 'on ' : '') + e[k]); return esc(o.join(' · ')); };
    return card('Event log', list.length + ' of ' + m.events.length + ' events', '<div class="filters"><label class="field">Show<select id="mc-evf"><option value="key"' + (MC.evF === 'key' ? ' selected' : '') + '>Key events</option><option value="all"' + (MC.evF === 'all' ? ' selected' : '') + '>Everything</option>' + types.map((t) => '<option value="' + t + '"' + (MC.evF === t ? ' selected' : '') + '>' + esc(t.replace(/_/g, ' ')) + '</option>').join('') + '</select></label><label class="field" style="flex:1;min-width:160px">Search<input id="mc-evq" value="' + esc(MC.evQ) + '" placeholder="Player, type or detail"></label></div>' +
      tbl([{ k: 'minute', l: 'Min', r: 1, f: (e) => '<span class="num">' + fmt(e.minute, 1) + '</span>' }, { k: 'type', l: 'Event', f: (e) => esc(e.type.replace(/_/g, ' ')) }, { k: 'team', l: 'Club', f: (e) => (e.team ? clubTag(e.team) : '') }, { k: 'player', l: 'Player', f: (e) => esc(e.player || '') }, { k: 'd', l: 'Detail', cls: 'wrap', f: det }], list.slice(0, 600), { id: 'mc-evt' }) + (list.length > 600 ? '<p class="note">Showing the first 600. Narrow the filter or export the CSV for everything.</p>' : ''));
  },
  trust(m) {
    const ins = m.events.filter((e) => e.type === 'insight'); const pr = m.events.filter((e) => e.type === 'prediction_result'); const hit = pr.filter((e) => e.hit).length;
    const brier = pr.length ? avg(pr, (e) => Math.pow((e.p || 0) - (e.happened ? 1 : 0), 2)) : null; const flags = m.events.filter((e) => e.type === 'verifier_flag');
    return '<div class="kpis">' + kpi('Verifier pass rate', m.verifier ? fmt(m.verifier.passRatePct, 1) + '<small>%</small>' : '–', m.verifier ? sum(m.verifier.checks, (c) => c.passed + c.failed) + ' checks' : 'Not run on imported matches', m.verifier && m.verifier.passRatePct >= 99.5 ? 'good' : 'warn') + kpi('Agent insights', ins.length, ins.filter((e) => e.status === 'verified').length + ' verified · ' + ins.filter((e) => e.status === 'rejected').length + ' rejected') + kpi('Predictions resolved', pr.length, hit + ' correct calls (' + pct(hit, pr.length) + '%)') + kpi('Brier score', brier == null ? '–' : fmt(brier, 3), 'Probability accuracy, lower is better') + '</div>' +
      '<div class="grid"><div class="s6">' + card('Verifier checks', 'Every refereeing decision and every player’s motion re-checked against the Laws of the Game', m.verifier ? tbl([{ k: 'id', l: 'Check' }, { k: 'passed', l: 'Passed', r: 1 }, { k: 'failed', l: 'Failed', r: 1, f: (c) => (c.failed ? '<b style="color:var(--bad)">' + c.failed + '</b>' : '0') }], m.verifier.checks) + (flags.length ? '<p class="note">Flags: ' + flags.map((f) => esc(f.note)).join(' · ') + '</p>' : '') : '<div class="empty">No Verifier run for this match.</div>') + '</div>' +
      '<div class="s6">' + card('Agent insights', 'Proposed during the match, checked by the Verifier before they could air', ins.length ? '<div class="list">' + ins.map((e) => '<div class="li"><span class="chip ' + (e.status === 'verified' ? 'good' : e.status === 'rejected' ? 'bad' : 'warn') + '">' + esc(e.status) + '</span><div><div class="t" style="font-weight:500">' + esc(e.text) + '</div><div class="s">' + esc(e.agent) + ' · ' + minLbl(e.minute) + '</div></div></div>').join('') + '</div>' : '<div class="empty">No insights recorded.</div>') + '</div>' +
      '<div class="s12">' + card('Provenance', 'Everything needed to reproduce this match', '<dl class="kv"><dt>Generator</dt><dd>' + esc(m.generator || 'MatchCast simulator') + '</dd><dt>Seed</dt><dd class="mono">' + esc(m.setup.seed) + '</dd><dt>Venue and conditions</dt><dd>' + esc(m.setup.stadium) + ' · ' + esc(MONTHS[m.setup.month] || '') + ' · ' + esc(m.setup.kickoff || '') + '</dd><dt>Half length (simulation)</dt><dd>' + esc(m.setup.half) + ' min</dd><dt>Data version</dt><dd class="mono">' + esc(D.version) + '</dd><dt>Synthetic</dt><dd>Yes. Clubs, players and officials are fictional.</dd></dl>') + '</div></div>';
  },
};
const MC_BIND = {
  ply(m, b) { bindTbl(b, 'mc-pt', MC.ptSort, () => mcTab(m), (n) => { if (PAGES.scouting) go('scouting', 'p-' + n.replace(/[^A-Za-z0-9]/g, '_')); }); },
  ev(m, b) { $('#mc-evf', b).onchange = (e) => { MC.evF = e.target.value; mcTab(m); }; $('#mc-evq', b).oninput = (e) => { MC.evQ = e.target.value; clearTimeout(MC.et); MC.et = setTimeout(() => { mcTab(m); const q = $('#mc-evq'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 250); }; },
};
function mcKinds(m) {
  const K = (m.stats && m.stats.kinds) || {}; const rows = Object.entries(K).map(([k, v]) => ({ k, a: v[0] + (v[1] || 0) ? v : [0, 0] }));
  if (!rows.length) return '<div class="empty">No pass-type data.</div>';
  const per = (k, ti) => m.events.filter((e) => e.type === 'pass' && e.kind === k && e.team === (ti ? m.away : m.home)).length;
  return tbl([{ k: 'k', l: 'Type', f: (r) => esc(r.k) }, { k: 'h', l: esc(m.home), r: 1, f: (r) => per(r.k, 0) }, { k: 'a', l: esc(m.away), r: 1, f: (r) => per(r.k, 1) }, { k: 'c', l: 'Completed %', r: 1, f: (r) => pct(r.a[1], r.a[0]) + '%' }], rows.sort((a, b) => b.a[0] - a.a[0]));
}
function mcNetwork(m, k) {
  const ap = mcAvgPos(m); const pos = {}; ap.forEach((p) => { if (p && p.pid.team === k) pos[p.pid.name] = p; });
  const pairs = {}, recv = {};
  for (const e of m.events) if (e.type === 'pass' && e.team === k && e.to) { const key = [e.player, e.to].sort().join('|'); pairs[key] = (pairs[key] || 0) + 1; recv[e.to] = (recv[e.to] || 0) + 1; }
  if (!Object.keys(pos).length) return '<div class="empty">No tracking data for this match.</div>';
  const mx = Math.max(1, ...Object.values(pairs)); let s = '';
  for (const kk in pairs) { if (pairs[kk] < 3) continue; const [a, b] = kk.split('|'); if (!pos[a] || !pos[b]) continue; s += '<line x1="' + pos[a].x.toFixed(1) + '" y1="' + pos[a].y.toFixed(1) + '" x2="' + pos[b].x.toFixed(1) + '" y2="' + pos[b].y.toFixed(1) + '" stroke="' + mcc(m, k) + '" stroke-opacity="' + (0.25 + 0.6 * pairs[kk] / mx).toFixed(2) + '" stroke-width="' + (0.3 + 1.6 * pairs[kk] / mx).toFixed(2) + '"><title>' + esc(a + ' ↔ ' + b + ': ' + pairs[kk] + ' passes') + '</title></line>'; }
  const rm = Math.max(1, ...Object.values(recv));
  for (const n in pos) { const p = pos[n]; const r = 1.6 + 2.2 * Math.sqrt((recv[n] || 0) / rm); s += '<g><circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + r.toFixed(2) + '" fill="' + mcc(m, k) + '" stroke="var(--surface)" stroke-width=".4"/><text x="' + p.x.toFixed(1) + '" y="' + (p.y + 0.9).toFixed(1) + '" text-anchor="middle" style="font-size:2.2px;fill:#fff;font-weight:600">' + (p.pid.num || '') + '</text><title>' + esc(n + ': received ' + (recv[n] || 0)) + '</title></g>'; }
  const top = Object.entries(pairs).sort((a, b) => b[1] - a[1])[0];
  return pitch(s, { title: 'Pass network' }) + (top ? '<p class="note" style="margin:6px 0 0">Most-used link: <b>' + esc(top[0].replace('|', ' ↔ ')) + '</b> (' + top[1] + ' passes).</p>' : '');
}
function mcTerritory(m) {
  const z = [0, 0, 0]; for (const fr of m.frames) { const x = fr.f ? 105 - fr.b[0] : fr.b[0]; z[x < 35 ? 0 : x < 70 ? 1 : 2]++; }
  const n = sum(z) || 1;
  return '<div style="display:flex;height:34px;border-radius:6px;overflow:hidden;font:600 12px/34px var(--f-mono);color:#fff">' + z.map((v, i) => '<div style="flex:' + v + ';background:' + (i === 0 ? mcc(m, m.away) : i === 2 ? mcc(m, m.home) : 'var(--muted)') + ';text-align:center;min-width:0;overflow:hidden">' + Math.round((100 * v) / n) + '%</div>').join('') + '</div><div class="legend"><span>← ' + esc(clubName(m.home)) + ' defensive third</span><span>Middle third</span><span>' + esc(clubName(m.home)) + ' attacking third →</span></div>';
}

// ================================================================ COPILOT (Analyst agent with tools; rules fallback)
const COP = { log: [] };
const COP_TOOLS = [
  { name: 'league_table', description: 'Current league table with points, goal difference and xG for/against for every club.', inputSchema: { type: 'object', properties: {} }, execute: () => D.table.map((t) => ({ pos: t.pos, club: clubName(t.key), key: t.key, p: t.p, w: t.w, d: t.d, l: t.l, gf: t.gf, ga: t.ga, pts: t.pts, xg: t.xg, xga: t.xga })) },
  { name: 'top_players', description: 'Top players by a season metric. metric is one of rating, goals, xg, shots, passes, passPct, wins, takeOnsWon, tackles, km, top. Optional club key and position group (GK, DEF, MID, ATT).', inputSchema: { type: 'object', properties: { metric: { type: 'string' }, club: { type: 'string' }, group: { type: 'string' }, limit: { type: 'number' } }, required: ['metric'] },
    execute: ({ metric = 'rating', club, group, limit = 5 }) => D.players.filter((p) => (!club || p.team === club) && (!group || p.group === group)).sort((a, b) => (b[metric] || 0) - (a[metric] || 0)).slice(0, Math.min(10, limit)).map((p) => ({ name: p.name, club: clubName(p.team), pos: p.pos, apps: p.apps, [metric]: p[metric], rating: p.rating })) },
  { name: 'player', description: 'Season numbers for one player by name (partial names work).', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    execute: ({ name }) => { const p = D.players.find((x) => x.name.toLowerCase().includes(String(name).toLowerCase())); return p ? { name: p.name, club: clubName(p.team), pos: p.pos, ability: p.abil, apps: p.apps, rating: p.rating, goals: p.goals, xg: p.xg, shots: p.shots, passes: p.passes, passPct: p.passPct, wins: p.wins, takeOns: p.takeOnsWon + '/' + p.takeOns, tackles: p.tackles, kmPer90: p.per90, topSpeedKmh: p.top } : { error: 'No player matches ' + name }; } },
  { name: 'club', description: 'Season profile for one club by key or name: record, xG, shapes used, results.', inputSchema: { type: 'object', properties: { club: { type: 'string' } }, required: ['club'] },
    execute: ({ club }) => { const c = D.clubs.find((x) => x.key === String(club).toUpperCase() || x.club.toLowerCase().includes(String(club).toLowerCase())); if (!c) return { error: 'No club ' + club }; const t = D.table.find((x) => x.key === c.key) || {}; const ms = D.matches.filter((m) => !m.imported && (m.home === c.key || m.away === c.key)); return { club: c.club, key: c.key, coach: c.coach, pos: t.pos, pts: t.pts, record: t.w + 'W ' + t.d + 'D ' + t.l + 'L', gf: t.gf, ga: t.ga, xg: t.xg, xga: t.xga, shapes: [...new Set(ms.map((m) => m.ts[c.key].form))], results: ms.map((m) => ({ id: m.id, vs: clubName(m.home === c.key ? m.away : m.home), score: m.score.join('-'), venue: m.home === c.key ? 'home' : 'away', xg: m.ts[c.key].xg, xga: m.ts[c.key].xga })) }; } },
  { name: 'match', description: 'Summary of one match by id (e.g. M004) or by two club names.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, clubs: { type: 'string' } } },
    execute: ({ id, clubs }) => { let m = id && D.match(String(id).toUpperCase()); if (!m && clubs) { const q = String(clubs).toLowerCase(); m = D.matches.find((x) => q.includes(clubName(x.home).toLowerCase().split(' ')[0]) && q.includes(clubName(x.away).toLowerCase().split(' ')[0])); } if (!m) return { error: 'Match not found' }; return { id: m.id, title: m.title, date: m.date, stadium: m.setup.stadium, home: m.ts[m.home], away: m.ts[m.away], goals: mcGoals(m), keyMoments: (m.sum.recap || {}).keyMoments || [] }; } },
];
function copRules(q) {
  const s = q.toLowerCase(); const T = D.table;
  const pl = D.players.find((p) => s.includes(p.name.toLowerCase().split(' ').slice(-1)[0].toLowerCase()) && p.name.split(' ').slice(-1)[0].length > 3);
  const cl = D.clubs.find((c) => s.includes(c.club.toLowerCase()) || s.includes(c.club.toLowerCase().split(' ')[0]) || new RegExp('\\b' + c.key.toLowerCase() + '\\b').test(s));
  if (/top scorer|most goals|who scores/.test(s)) { const t = D.players.slice().sort((a, b) => b.goals - a.goals || b.xg - a.xg).slice(0, 3); return 'Top scorers: ' + t.map((p) => p.name + ' (' + clubName(p.team) + ') ' + p.goals + ' goals from ' + fmt(p.xg, 2) + ' xG').join('; ') + '.'; }
  if (/best player|highest rat|top rated|player of/.test(s)) { const t = D.players.slice().sort((a, b) => b.rating - a.rating).slice(0, 3); return 'Highest average match ratings: ' + t.map((p) => p.name + ' (' + p.pos + ', ' + clubName(p.team) + ') ' + fmt(p.rating, 2)).join('; ') + '. Rating = ' + RATING_FORMULA + '.'; }
  if (pl) return pl.name + ' (' + pl.pos + ', ' + clubName(pl.team) + '): ' + pl.apps + ' matches, average rating ' + fmt(pl.rating, 2) + ', ' + pl.goals + ' goals from ' + fmt(pl.xg, 2) + ' xG, ' + pl.passPct + '% passing (' + pl.done + '/' + pl.passes + '), ' + pl.wins + ' ball wins, ' + pl.takeOnsWon + '/' + pl.takeOns + ' take-ons, top speed ' + fmt(pl.top, 1) + ' km/h.';
  if (cl) { const t = T.find((x) => x.key === cl.key); return cl.club + ' are ' + t.pos + ' of ' + T.length + ' with ' + t.pts + ' points (' + t.w + 'W ' + t.d + 'D ' + t.l + 'L), ' + t.gf + ' scored and ' + t.ga + ' conceded. Their chances add up to ' + fmt(t.xg, 2) + ' xG for and ' + fmt(t.xga, 2) + ' against, so results are ' + (t.gf - t.xg > 1 ? 'running ahead of' : t.gf - t.xg < -1 ? 'running behind' : 'in line with') + ' chance quality. Recent form: ' + t.form.join(' ') + '.'; }
  if (/lead|top of|table|who is first|standings/.test(s)) return T.slice(0, 3).map((t) => t.pos + '. ' + clubName(t.key) + ' ' + t.pts + ' pts (GD ' + (t.gd > 0 ? '+' : '') + t.gd + ', xGD ' + fmt(t.xgd, 2) + ')').join('; ') + '.';
  if (/defen|conced|leak/.test(s)) { const t = T.slice().sort((a, b) => a.ga - b.ga || a.xga - b.xga); return 'Best defence: ' + clubName(t[0].key) + ' (' + t[0].ga + ' conceded, ' + fmt(t[0].xga, 2) + ' xGA). Most conceded: ' + clubName(t[t.length - 1].key) + ' (' + t[t.length - 1].ga + ', ' + fmt(t[t.length - 1].xga, 2) + ' xGA).'; }
  if (/unlucky|luck|over.?perform|under.?perform/.test(s)) { const t = T.slice().sort((a, b) => (a.gf - a.xg) - (b.gf - b.xg)); return 'Furthest below their xG: ' + clubName(t[0].key) + ' (' + t[0].gf + ' goals from ' + fmt(t[0].xg, 2) + ' xG). Furthest above: ' + clubName(t[t.length - 1].key) + ' (' + t[t.length - 1].gf + ' from ' + fmt(t[t.length - 1].xg, 2) + ').'; }
  return 'I can answer from the season data: the table, a club (try “How are Ridgeview doing?”), a player by surname, top scorers, best-rated players, defences, or who is over- or under-performing their xG. With Claude enabled I can also combine these with tool calls.';
}
function copInit() {
  const box = $('#cop'), btn = $('#copbtn');
  const open = (o) => { box.hidden = !o; btn.setAttribute('aria-expanded', String(o)); if (o) setTimeout(() => $('#cop-q').focus(), 50); };
  btn.onclick = () => open(box.hidden); $('#cop-x').onclick = () => open(false);
  $('#cop-agents').innerHTML = Object.values(AGENTS).map((a) => '<span class="chip" title="' + esc(a.role) + '"><i style="color:' + a.color + '"></i>' + esc(a.name) + '</span>').join('');
  const chips = ['Who is top of the table?', 'How are Harbor City doing?', 'Who is the top scorer?', 'Which club is most unlucky on xG?', 'Who are the best-rated midfielders?'];
  $('#cop-chips').innerHTML = chips.map((c) => '<button type="button">' + esc(c) + '</button>').join('');
  $('#cop-chips').onclick = (e) => { const b = e.target.closest('button'); if (b) copAsk(b.textContent); };
  $('#cop-f').onsubmit = (e) => { e.preventDefault(); const q = $('#cop-q').value.trim(); if (q) { $('#cop-q').value = ''; copAsk(q); } };
  copDraw();
}
function copDraw() {
  const log = $('#cop-log'); if (!log) return;
  log.innerHTML = COP.log.length ? COP.log.map((x) => '<div class="msg q">' + esc(x.q) + '</div><div class="msg a">' + (x.steps && x.steps.length ? '<div class="steps">' + x.steps.map((s) => '<div>' + esc(s) + '</div>').join('') + '</div>' : '') + esc(x.text || 'Thinking…') + (x.done ? '<div class="meta">' + chip(x.src === 'ai' ? 'Analyst agent · Claude' : 'Analyst agent · rules', x.src === 'ai' ? 'info' : '') + groundChip(x.ground) + (x.ms ? chip(x.ms + ' ms') : '') + '</div>' : '') + '</div>').join('') : '<div class="note">Ask about the season, a club, a player or a match. The Analyst agent answers from the tenant’s data. Every number it gives is checked against that data before you see it.</div>';
  log.scrollTop = log.scrollHeight;
}
async function copAsk(q) {
  if (!gate('ask', 'Ask Copilot')) return;
  const it = { q, text: '', steps: [] }; COP.log.push(it); copDraw();
  const ctx = { tenant: clubName(OUR), competition: D.league.competition, season: D.league.season, table: D.table.slice(0, 8).map((t) => ({ club: clubName(t.key), key: t.key, pts: t.pts, gf: t.gf, ga: t.ga, xg: t.xg, xga: t.xga })) };
  const run = await askAgent({ agent: 'analyst', q, ctx, tools: COP_TOOLS, rules: () => copRules(q), onText: (t, steps) => { if (t != null) it.text = t; it.steps = steps.slice(); copDraw(); } });
  Object.assign(it, { text: run.text, steps: run.steps, src: run.src, ground: run.ground, ms: run.ms, done: true }); copDraw();
}
