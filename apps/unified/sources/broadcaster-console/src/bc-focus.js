// ============ BROADCASTER CONSOLE: focus, win, calls (bc-focus.js) ============
const BC_KIND = { next_goal: 'Next goal', result: 'Result', sub: 'Substitution', tactical: 'Tactical change', card: 'Card', red_card: 'Red card', chaos: 'Chaos', milestone: 'Milestone' };
const bcKind = (k) => BC_KIND[k] || String(k || '').replace(/_/g, ' ');
const bcIdx = (name, ti) => players.findIndex((p) => p.name === name && p.ti === ti);
const bcFirst = (w) => (Array.isArray(w) ? w[0] : w) || '';
const bcNum = (x) => (x == null || !isFinite(x) ? '–' : x.toFixed(1));
const bcShellsDone = { v: false };

function bcShells() {
  if (bcShellsDone.v) return; bcShellsDone.v = true;
  $('pane-focus').innerHTML = '<div class="bc-h">Where to focus <small>next 10 match minutes · predict.js</small></div>'
    + '<div class="bc-sec"><h4>Camera now <span class="bc-tag">suggested</span></h4><div id="fx-cam"></div></div>'
    + '<div class="bc-sec"><h4>Danger zone</h4><div id="fx-danger"></div></div>'
    + '<div class="bc-sec"><h4>Key players</h4><div id="fx-keys"></div></div>'
    + '<div class="bc-sec"><h4>Card risk</h4><div id="fx-cards"></div></div>'
    + '<div class="bc-sec"><h4>Sub watch</h4><div id="fx-fat"></div></div>'
    + '<div class="bc-sec"><h4>Likely tactical change</h4><div id="fx-tac"></div></div>'
    + '<div class="bc-sec"><h4>What if… <span class="bc-tag">model only</span></h4>'
    + '<div class="bc-grid2"><label class="bc-field">Team<select id="wi-team"><option value="0"></option><option value="1"></option></select></label>'
    + '<label class="bc-field">Change<select id="wi-change"><option value="press">Press high or low</option><option value="tempo">Tempo up or down</option><option value="defend_deep">Sit deep</option><option value="formation">Switch formation</option><option value="sub">Fresh legs (sub)</option></select></label></div>'
    + '<label class="bc-field">Setting<select id="wi-val"></select></label>'
    + '<div class="bc-btnrow"><button class="bc-btn pri" id="wi-run">Run what-if</button></div>'
    + '<div id="fx-wi-out" class="bc-ans">Pick a change and run it. The engine recomputes the odds for that one side and leaves the match running.</div></div>';
  $('pane-win').innerHTML = '<div class="bc-h">Win probability <small>predict.js · live</small></div>'
    + '<div class="bc-sec"><h4>Result</h4><div id="wn-res"></div></div>'
    + '<div class="bc-sec"><h4>Next goal, next 10 min</h4><div id="wn-ng"></div><div id="wn-ngwhy" class="bc-foot"></div></div>'
    + '<div class="bc-sec"><h4>Trend <span id="wn-tr"></span></h4><canvas id="wn-chart" width="640" height="240" style="width:100%;height:auto;background:#0a1220;border:1px solid #24324b;border-radius:8px"></canvas></div>'
    + '<div class="bc-sec"><h4>How far to trust it</h4><div id="wn-hit"></div>'
    + '<div class="bc-foot"><b>Sub and tactical calls beat a constant baseline</b> on 60 held-out matches (Brier 0.167 vs 0.221, and 0.154 vs 0.206). <b>Goal and result odds are well calibrated but no better than the baseline</b>, because the engine scores about one goal a match. Treat the win and goal numbers as a guide, not a forecast. Source: v10/README.md.</div></div>';
  $('pane-calls').innerHTML = '<div class="bc-h">Our calls <small>logged when made, scored when settled</small></div>'
    + '<div class="bc-sec"><h4>Scorecard</h4><div id="ca-sum"></div></div>'
    + '<div class="bc-sec"><h4>By kind</h4><div id="ca-kind"></div></div>'
    + '<div class="bc-sec"><h4>Latest calls</h4><div id="ca-list"></div></div>';
  bcFillWhatIfValues();
  $('wi-change').onchange = bcFillWhatIfValues;
  $('wi-run').onclick = bcRunWhatIf;
  $('wi-team').innerHTML = '<option value="0">' + bcEsc(bcTeam(0)) + '</option><option value="1">' + bcEsc(bcTeam(1)) + '</option>';
}
function bcFillWhatIfValues() {
  const c = $('wi-change').value, sel = $('wi-val');
  const opts = c === 'press' ? [['1', 'Press higher'], ['-1', 'Drop off, press less']] : c === 'tempo' ? [['1', 'Up the tempo'], ['-1', 'Slow it down']]
    : c === 'defend_deep' ? [['1', 'Sit deep']] : c === 'formation' ? Object.keys(FORMATIONS).map((f) => [f, f]) : [['', 'Most tired player off']];
  sel.innerHTML = opts.map(([v, l]) => '<option value="' + v + '">' + bcEsc(l) + '</option>').join('');
}
function bcRunWhatIf() {
  const c = $('wi-change').value, v = $('wi-val').value;
  const q = { ti: +$('wi-team').value, change: c, value: c === 'formation' ? v : c === 'sub' ? undefined : +v };
  const r = predWhatIf(q), k = q.ti === 0 ? 'home' : 'away', ko = k === 'home' ? 'away' : 'home';
  const pc = (x) => bcPct(x);
  const row = (lab, a, b) => '<div class="bc-row"><div class="k">' + bcEsc(lab) + '</div><div><b>' + pc(a) + '</b> → <b>' + pc(b) + '</b></div></div>';
  $('fx-wi-out').innerHTML = '<div><b>' + bcEsc(r.text) + '</b></div><div class="bc-foot" style="margin:4px 0 8px">' + bcEsc(r.why) + '</div>'
    + row(bcTeam(0) + ' to win', r.before.result.home, r.after.result.home) + row(bcTeam(1) + ' to win', r.before.result.away, r.after.result.away)
    + row('Next goal ' + bcTeam(q.ti), r.before.nextGoal[k], r.after.nextGoal[k]) + row('Next goal ' + bcTeam(1 - q.ti), r.before.nextGoal[ko], r.after.nextGoal[ko]);
}

function bcPaintFocus(P) {
  bcShells();
  P = S.started ? (P || predNow()) : null;
  if (!P) { bcSet('fx-cam', '<div class="bc-empty">Waiting for kick-off.</div>'); return; }
  const f = P.focus, fp = f && f.name ? bcIdx(f.name, f.ti) : -1;
  bcSet('fx-cam', f && f.name ? '<div class="bc-row"><div class="k"><b>' + bcEsc(f.name) + '</b> #' + f.num + ' · ' + bcTeam(f.ti) + '<span class="why">' + bcEsc(f.reason) + '</span></div>'
    + '<button class="bc-btn" data-cam-take="' + f.cam + '" data-pi="' + fp + '">Take it</button></div>' : '<div class="bc-empty">No single player stands out right now.</div>');
  const D = P.danger;
  const y0 = { left: 0, centre: 22.7, right: 45.3 }[D.zone] ?? 22.7;
  bcSet('fx-danger', '<svg class="bc-pitch" viewBox="0 0 105 68" role="img" aria-label="Danger zone on a mini pitch">'
    + '<rect x="0" y="0" width="105" height="68" fill="none" stroke="#e8f5ee" stroke-opacity=".5"/><line x1="52.5" y1="0" x2="52.5" y2="68" stroke="#e8f5ee" stroke-opacity=".35"/>'
    + '<rect x="70" y="0" width="35" height="68" fill="none" stroke="#e8f5ee" stroke-opacity=".3" stroke-dasharray="2 2"/>'
    + '<rect x="70" y="' + y0 + '" width="35" height="22.7" fill="#ffc83d" fill-opacity="' + (0.25 + 0.6 * D.p).toFixed(2) + '"/>'
    + '<text x="5" y="9" fill="#e8f5ee" font-size="4.2" font-family="sans-serif">' + bcEsc(bcTeam(D.ti)) + ' attacking →</text></svg>'
    + '<div class="bc-row"><div class="k">Chance most likely from the <b>' + bcEsc(D.zone) + '</b> channel: ' + bcPct(D.p) + ' in 10 min<span class="why">' + bcEsc(bcFirst(D.why)) + '</span></div></div>');
  bcSet('fx-keys', P.keyPlayers.map((k) => { const i = bcIdx(k.name, k.ti); return '<div class="bc-row"><div class="k"><span class="bc-chip ' + k.role + '">' + k.role + '</span> <button class="bc-btn" style="padding:2px 8px" data-pi="' + i + '">' + bcEsc(k.name) + ' #' + k.num + '</button> ' + bcTeamKey(k.ti) + '<span class="why">' + bcEsc(k.why) + '</span></div>' + bcBar(k.score / 100) + '</div>'; }).join('') || '<div class="bc-empty">None yet.</div>');
  bcSet('fx-cards', P.cardRisk.map((c) => { const i = bcIdx(c.name, c.ti); return '<div class="bc-row"><div class="k"><button class="bc-btn" style="padding:2px 8px" data-pi="' + i + '">' + bcEsc(c.name) + '</button> ' + bcTeamKey(c.ti) + '<span class="why">' + bcEsc(c.why) + '</span></div>' + bcBar(c.p) + '<b>' + bcPct(c.p) + '</b></div>'; }).join('') || '<div class="bc-empty">No card risk worth a graphic.</div>');
  bcSet('fx-fat', P.fatigue.map((t) => { const i = bcIdx(t.name, t.ti); return '<div class="bc-row"><div class="k"><button class="bc-btn" style="padding:2px 8px" data-pi="' + i + '">' + bcEsc(t.name) + '</button> ' + bcTeamKey(t.ti) + ' · ' + bcPct(t.stamina) + ' legs<span class="why">' + bcEsc(t.why) + '</span></div>' + bcBar(t.subSoon, 'a') + '<b>' + bcPct(t.subSoon) + '</b></div>'; }).join('') || '<div class="bc-empty">Legs are holding.</div>');
  bcSet('fx-tac', P.tactical.map((t) => '<div class="bc-row"><div class="k"><b>' + bcEsc(t.kind) + '</b> · ' + bcTeam(t.ti) + '<span class="why">' + bcEsc(t.why) + '</span></div>' + bcBar(t.p) + '<b>' + bcPct(t.p) + '</b></div>').join('') || '<div class="bc-empty">No change expected.</div>');
}

function bcPaintWin(P) {
  bcShells();
  P = S.started ? (P || predNow()) : null;
  if (!P) { bcSet('wn-res', '<div class="bc-empty">Waiting for kick-off.</div>'); return; }
  const r = P.result, n = P.nextGoal;
  bcSet('wn-res', '<div class="bc-odds"><span>' + bcEsc(bcTeam(0)) + '</span>' + bcBar(r.home, 'h') + '<span class="pc">' + bcPct(r.home) + '</span></div>'
    + '<div class="bc-odds"><span>Draw</span>' + bcBar(r.draw, 'n') + '<span class="pc">' + bcPct(r.draw) + '</span></div>'
    + '<div class="bc-odds"><span>' + bcEsc(bcTeam(1)) + '</span>' + bcBar(r.away, 'a') + '<span class="pc">' + bcPct(r.away) + '</span></div>');
  bcSet('wn-ng', '<div class="bc-odds"><span>' + bcEsc(bcTeam(0)) + '</span>' + bcBar(n.home, 'h') + '<span class="pc">' + bcPct(n.home) + '</span></div>'
    + '<div class="bc-odds"><span>No goal</span>' + bcBar(n.none, 'n') + '<span class="pc">' + bcPct(n.none) + '</span></div>'
    + '<div class="bc-odds"><span>' + bcEsc(bcTeam(1)) + '</span>' + bcBar(n.away, 'a') + '<span class="pc">' + bcPct(n.away) + '</span></div>');
  bcSet('wn-ngwhy', n.why.map((w) => '• ' + bcEsc(w)).join('<br>'));
  const s = predScore().overall;
  bcSet('wn-hit', s.n ? '<div class="bc-grid2"><div class="bc-stat"><b>' + s.hits + '/' + s.n + '</b><span>calls right</span></div><div class="bc-stat"><b>' + (s.brier == null ? '–' : s.brier.toFixed(3)) + '</b><span>Brier (lower is better)</span></div></div>' + (s.n < 30 ? '<div class="bc-foot">' + s.n + ' settled calls is too few to judge skill.</div>' : '')
    : '<div class="bc-empty">No settled calls yet. Calls settle at their horizon.</div>');
  bcDrawChart();
}
function bcDrawChart() {
  const c = $('wn-chart'); if (!c) return;
  const L = BC.series, W = c.width, H = c.height, g = c.getContext('2d');
  if (c.dataset.n === String(L.length)) return; c.dataset.n = String(L.length);
  g.clearRect(0, 0, W, H);
  const pad = 26, xmax = Math.max(90, L.length ? L[L.length - 1].m : 90);
  const X = (m) => pad + (m / xmax) * (W - pad - 8), Y = (v) => H - pad - v * (H - pad - 10);
  g.strokeStyle = '#24324b'; g.lineWidth = 1; g.font = '12px IBM Plex Sans, sans-serif'; g.fillStyle = '#8d9ab3';
  for (const v of [0, 0.5, 1]) { g.beginPath(); g.moveTo(pad, Y(v)); g.lineTo(W - 8, Y(v)); g.stroke(); g.fillText(Math.round(v * 100) + '%', 2, Y(v) + 4); }
  for (const m of [0, 45, 90]) if (m <= xmax) g.fillText(m + "'", X(m) - 8, H - 6);
  const line = (key, col) => { if (!L.length) return; g.strokeStyle = col; g.lineWidth = 2.2; g.beginPath(); L.forEach((p, i) => (i ? g.lineTo(X(p.m), Y(p[key])) : g.moveTo(X(p.m), Y(p[key])))); g.stroke(); };
  line('h', '#4da3ff'); line('d', '#9aa6bd'); line('a', '#ff7a59');
  $('wn-tr').textContent = L.length ? '' : 'draws in as the match runs';
}

function bcPaintCalls() {
  bcShells();
  const s = predScore(), o = s.overall, log = predLog().slice().reverse();
  bcSet('ca-sum', o.n ? '<div class="bc-grid2"><div class="bc-stat"><b>' + o.hits + '/' + o.n + '</b><span>right (' + bcPct(o.hitRate) + ')</span></div>'
    + '<div class="bc-stat"><b>' + (o.brier == null ? '–' : o.brier.toFixed(3)) + '</b><span>Brier' + (o.brierBase == null ? '' : ' · base ' + o.brierBase.toFixed(3)) + '</span></div>'
    + '<div class="bc-stat"><b>' + s.pending + '</b><span>pending</span></div><div class="bc-stat"><b>' + log.length + '</b><span>logged</span></div></div>'
    : '<div class="bc-empty">Calls appear here the moment they are made. The scorecard fills as they settle.</div>');
  const kinds = Object.keys(s.byKind);
  bcSet('ca-kind', kinds.length ? '<table class="bc-table"><tr><th>Kind</th><th class="n">Right</th><th class="n">Brier</th></tr>'
    + kinds.map((k) => '<tr><td>' + bcEsc(bcKind(k)) + '</td><td class="n">' + s.byKind[k].hits + '/' + s.byKind[k].n + '</td><td class="n">' + (s.byKind[k].brier == null ? '–' : s.byKind[k].brier.toFixed(3)) + '</td></tr>').join('') + '</table>'
    : '<div class="bc-empty">No kinds settled yet.</div>');
  bcSet('ca-list', log.length ? '<table class="bc-table"><tr><th>Min</th><th>Claim</th><th class="n">Odds</th><th>Result</th></tr>'
    + log.slice(0, 15).map((r) => '<tr><td>' + Math.floor(r.minute) + "'</td><td>" + bcEsc(r.claim) + '<div class="bc-src">' + bcEsc(bcKind(r.kind)) + '</div></td><td class="n">' + bcPct(r.p) + '</td><td>'
      + (r.resolved === null ? '<span class="pend">pending</span>' : (r.p >= 0.5) === r.resolved ? '<span class="ok">✓ right</span>' : '<span class="no">✗ missed</span>') + '</td></tr>').join('') + '</table>'
    : '<div class="bc-empty">Nothing called yet.</div>');
}
