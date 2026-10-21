// ============ BROADCASTER CONSOLE: players and desk (bc-players.js) ============
BC.team = 0; BC.airMap = {}; BC.cardKey = -1;
function bcShellPlayers() {
  $('pane-players').innerHTML = '<div class="bc-h">Players <small>facts from players.json and the event log</small></div>'
    + '<div class="bc-sec"><h4>Squad</h4><div class="bc-seg" id="pl-team" role="group" aria-label="Team" style="align-self:flex-start"><button data-ti="0" aria-pressed="true"></button><button data-ti="1" aria-pressed="false"></button></div>'
    + '<div class="bc-plist" id="pl-roster"></div></div>'
    + '<div class="bc-sec" id="pl-card"><div class="bc-empty">Click a name on the list or on the pitch to open a player card. Talk to the player from the card.</div></div>';
  bcSetTeamLabels();
}
function bcSetTeamLabels() {
  const b = $('pl-team'); if (!b) return;
  b.children[0].textContent = bcTeam(0); b.children[1].textContent = bcTeam(1);
  for (const x of b.children) x.setAttribute('aria-pressed', String(+x.dataset.ti === BC.team));
}
function bcPaintPlayers() {
  if (!$('pl-roster')) bcShellPlayers();
  bcSetTeamLabels();
  const L = players.filter((p) => p.ti === BC.team).sort((a, b) => a.num - b.num);
  bcSet('pl-roster', L.map((p) => {
    const i = players.indexOf(p), st = Math.round(p.stamina * 100), cls = st < 45 ? 'low' : st < 70 ? 'mid' : '';
    return '<button class="bc-pl' + (BC.player === p ? ' on' : '') + '" data-pi="' + i + '"><span class="num">' + p.num + '</span><span>' + bcEsc(p.name) + ' · ' + bcEsc(p.pos) + (p.off ? ' (off)' : '') + '</span>'
      + '<span class="st"><i class="' + cls + '" style="width:' + st + '%"></i></span><span style="text-align:right;font-variant-numeric:tabular-nums">' + Math.round(p.rating) + '</span></button>';
  }).join(''));
  if (BC.player) bcPaintCard();
}
function bcOpenPlayer(p) {
  if (!p || players.indexOf(p) < 0) return;
  BC.player = p; BC.team = p.ti; bcShellPlayers(); bcRenderPlayerCard(); bcPaintPlayers(); bcPane('players');
}
function bcRenderPlayerCard() {
  const p = BC.player, i = players.indexOf(p); if (!p || !$('pl-card')) return;
  BC.cardKey = i;
  $('pl-card').innerHTML = '<div class="bc-h">#' + p.num + ' ' + bcEsc(p.name) + ' <small>' + bcEsc(p.pos) + ' · ' + bcEsc(p.T.club) + '</small></div>'
    + '<div id="pc-facts" class="bc-grid2"></div>'
    + '<div class="bc-btnrow"><button class="bc-btn pri" data-iso="' + i + '">Iso on him</button></div>'
    + '<div class="bc-sec"><h4>Talk to the player <span class="bc-tag">simulated</span></h4>'
    + '<div class="bc-btnrow">' + Object.keys(ORDERS).map((k) => '<button class="bc-btn" data-order="' + k + '" data-pi="' + i + '">' + bcEsc(ORDERS[k].label) + '</button>').join('') + '</div>'
    + '<div class="bc-talk" id="pc-log"></div>'
    + '<form id="pc-form" class="bc-btnrow" style="flex-wrap:nowrap"><input id="pc-q" aria-label="What do you say to him?" placeholder="What do you say to him?" style="flex:1;min-width:0;background:var(--bc-panel2);border:1px solid var(--bc-line);border-radius:8px;padding:8px;color:var(--bc-ink);font:inherit;font-size:13px"><button class="bc-btn pri" type="submit" data-pi="' + i + '">Send</button></form>'
    + '<div class="bc-foot">The player is a generated character. Replies come from the Foundry agent in production; here they use the Claude stand-in when available, otherwise rules.</div></div>';
  bcPaintCard();
}
function bcPaintCard() {
  const p = BC.player; if (!p || !$('pc-facts')) return;
  const ex = exPlayerStats(p) || {}, st = pStats(p);
  bcSet('pc-facts', [['Rating', Math.round(p.rating)], ['Stamina', Math.round(p.stamina * 100) + '%'], ['Distance', ex.distanceKm != null ? ex.distanceKm + ' km' : '–'], ['Top speed', ex.topSpeedKmh != null ? ex.topSpeedKmh + ' km/h' : '–'],
    ['Passes', st.passes], ['Shots', st.shots], ['Take-ons won', st.takeOns], ['Yellow cards', p.yellows || 0]].map(([k, v]) => '<div class="bc-stat"><b>' + bcEsc(v) + '</b><span>' + k + '</span></div>').join(''));
  const log = (TK.log.get(p) || []).slice(-12);
  bcSet('pc-log', log.map((x) => '<div class="' + (x.who === 'me' ? 'me' : 'pl') + '"><b>' + (x.who === 'me' ? 'You' : bcEsc(p.name)) + '</b>' + bcEsc(x.text) + '</div>').join('') || '<div class="bc-empty">Say something to him, or pick a quick order.</div>');
}

// ---- desk: pre-match, storylines and graphics, the producer, the brief ----
function bcShellDesk() {
  $('pane-desk').innerHTML = '<div class="bc-h">Desk <small>pre-match, graphics, the producer, the brief</small></div>'
    + '<div class="bc-sec"><h4>Pre-match package</h4><div id="bcd-pre"></div></div>'
    + '<div class="bc-sec"><h4>Live storylines <span class="bc-tag">air as graphics</span></h4><div id="bcd-story"></div></div>'
    + '<div class="bc-sec"><h4>Graphics queue <span class="bc-tag">moments</span></h4><div id="bcd-queue"></div></div>'
    + '<div class="bc-sec"><h4>Aired</h4><div id="bcd-aired"></div><div class="bc-btnrow"><button class="bc-btn" id="bcd-export">Export graphics as overlay JSON</button></div></div>'
    + '<div class="bc-sec"><h4>Ask the producer <span class="bc-tag" id="bcd-ai">Foundry in production</span></h4>'
    + '<label class="bc-field">Question<textarea id="bcd-q" placeholder="e.g. Who should we iso next, and why?"></textarea></label>'
    + '<div class="bc-btnrow"><button class="bc-btn pri" id="bcd-ask">Ask</button></div>'
    + '<div class="bc-ans" id="bcd-ans">Answers use only the match state on this desk.</div></div>'
    + '<div class="bc-sec"><h4>Match-day brief</h4><div class="bc-btnrow"><button class="bc-btn pri" id="bcd-brief">Download brief (HTML)</button></div>'
    + '<div class="bc-foot">One page: score, stats, calls scorecard, script lines and aired graphics.</div></div>';
  $('bcd-ask').onclick = bcAsk;
  $('bcd-brief').onclick = bcBrief;
  $('bcd-export').onclick = bcExport;
}
function bcPaintDesk(P) {
  if (!$('bcd-pre')) bcShellDesk();
  const pre = BC.pre;
  bcSet('bcd-pre', !pre ? '<div class="bc-empty">The package is built at kick-off.</div>' : '<div class="bc-row"><div class="k"><b>' + bcEsc(pre.venue) + '</b><span class="why">' + bcEsc(pre.weather) + ' · ref ' + bcEsc(pre.ref) + '</span></div></div>'
    + pre.teams.map((t) => '<div class="bc-row"><div class="k"><b>' + bcEsc(t.club) + '</b> · ' + bcEsc(t.form) + ' · ' + bcEsc(t.style) + '<span class="why">Squad average ' + t.rating + '. Top: ' + t.top.map((p) => bcEsc(p.name) + ' ' + Math.round(p.rating)).join(', ') + '</span></div></div>').join('')
    + (pre.prior ? '<div class="bc-row"><div class="k">History prior: ' + bcPct(pre.prior[0]) + ' · ' + bcPct(pre.prior[1]) + ' · ' + bcPct(pre.prior[2]) + '<span class="why">Elo from history.js, national-team mode only</span></div></div>' : '<div class="bc-foot">Fictional clubs have no real-world history, so there is no history prior. The squad average comes from players.json.</div>'));
  P = S.started ? (P || predNow()) : null;
  BC.airMap = {};
  const story = P ? (P.storylines || []).slice(0, 5).map((s) => { const it = { id: 'st-' + s.id, kicker: 'Storyline · ' + s.graphic, title: s.title, text: s.text, src: 'predict.js storyline' }; BC.airMap[it.id] = it; return '<div class="bc-row"><div class="k"><b>' + bcEsc(s.title) + '</b><span class="why">' + bcEsc(s.text) + '</span></div><button class="bc-btn" data-airid="' + it.id + '">Air</button></div>'; }).join('') : '';
  bcSet('bcd-story', story || '<div class="bc-empty">Storylines appear at kick-off.</div>');
  const q = BC.graphics.slice(0, 12).map((g) => { BC.airMap[g.id] = g; return '<div class="bc-row"><div class="k"><b>' + bcEsc(g.title) + '</b><span class="why">' + bcEsc(g.text) + '</span>' + bcSrc(g.src) + '</div>' + (g.aired ? '<span class="bc-tag live">aired</span>' : '<button class="bc-btn" data-airid="' + g.id + '">Air</button>') + '</div>'; }).join('');
  bcSet('bcd-queue', q || '<div class="bc-empty">Moments from the engine land here as they happen.</div>');
  bcSet('bcd-aired', BC.aired.slice(-8).reverse().map((a) => '<div class="bc-row"><div class="k"><b>' + bcEsc(a.title) + '</b> · ' + a.minute + "'<span class=\"why\">" + bcEsc(a.text) + '</span></div></div>').join('') || '<div class="bc-empty">Nothing aired yet.</div>');
}
function bcAskContext(P) {
  const s = predScore().overall;
  return { minute: Math.floor(S.mclock / 60), score: S.score, result: P.result, nextGoal: { home: P.nextGoal.home, away: P.nextGoal.away, none: P.nextGoal.none, why: P.nextGoal.why },
    keyPlayers: P.keyPlayers.slice(0, 3).map((k) => ({ name: k.name, team: bcTeam(k.ti), role: k.role, why: k.why })), storylines: (P.storylines || []).slice(0, 3).map((x) => x.title),
    calls: { right: s.hits, made: s.n } };
}
async function bcAsk() {
  const q = $('bcd-q').value.trim(); if (!q) return;
  const P = S.started ? predNow() : null;
  if (!P) { $('bcd-ans').textContent = 'Kick off first; there is no match state to answer from yet.'; return; }
  $('bcd-ans').textContent = 'Thinking…';
  let out = null, tag = 'Rules fallback';
  if (SAMPLE) {
    try { const r = await SAMPLE('You are the producer of a football broadcast. Answer in two or three short sentences, using only the facts in this JSON. If the facts do not answer the question, say so. Facts: ' + JSON.stringify(bcAskContext(P)) + ' Question: ' + q, { modelTier: 'quick', cache: false });
      out = typeof r === 'string' ? r : r && r.text; tag = 'Claude stands in for Foundry'; } catch (e) { out = null; }
  }
  if (!out) out = ruleAnswer(q);
  $('bcd-ai').textContent = tag; $('bcd-ans').textContent = out.trim();
}
// saves through the engine's downloads capability when the page has one, so the file reaches the viewer
function bcSave(name, text, type) { saveFile(name, text, type); }
function bcExport() {
  bcSave('matchcast-broadcaster-graphics.json', JSON.stringify({ schema: 'matchcast.broadcaster-graphics/1', simulated: true, aired: BC.aired, overlays: overlayTrack() }, null, 1), 'application/json');
}
function bcBrief() {
  const P = S.started ? predNow() : null, s = predScore().overall, e = (x) => bcEsc(x);
  const sec = (h, body) => '<h2>' + h + '</h2>' + body;
  const table = (rows) => '<table>' + rows.map((r) => '<tr>' + r.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</table>';
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MatchCast brief</title>'
    + '<style>body{font-family:system-ui,sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#111;line-height:1.45}h1{margin:0 0 4px}h2{margin:22px 0 6px;font-size:16px;text-transform:uppercase;letter-spacing:.06em;color:#333}table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #ddd;padding:6px 4px;vertical-align:top}.s{color:#666;font-size:12px}</style></head><body>'
    + '<h1>' + e(bcTeam(0)) + ' ' + S.score.join('–') + ' ' + e(bcTeam(1)) + '</h1>'
    + '<p class="s">Simulated match, fictional clubs · ' + e(SET.st.name) + ' · minute ' + Math.floor(S.mclock / 60) + ' · made ' + new Date().toISOString() + '</p>'
    + sec('Stats', table([['xG', bcRound(STATS.xg[0], 2), bcRound(STATS.xg[1], 2)], ['Shots', STATS.shots[0], STATS.shots[1]], ['On target', STATS.onTarget[0], STATS.onTarget[1]]]))
    + (P ? sec('Win probability now', table([[e(bcTeam(0)), bcPct(P.result.home)], ['Draw', bcPct(P.result.draw)], [e(bcTeam(1)), bcPct(P.result.away)]])) : '')
    + sec('Calls scorecard', s.n ? '<p>' + s.hits + ' of ' + s.n + ' calls right (' + bcPct(s.hitRate) + '). Brier ' + (s.brier == null ? '–' : s.brier.toFixed(3)) + '. Sample sizes this small are not evidence of skill.</p>' : '<p>No settled calls yet.</p>')
    + sec('Script lines', table(BC.script.map((l) => ['<b>' + l.min + "'</b>", e(l.en) + '<br><small>' + e(l.ta) + '</small>'])) || '<p>None yet.</p>')
    + sec('Aired graphics', BC.aired.length ? table(BC.aired.map((a) => [a.minute + "'", e(a.title), e(a.text)])) : '<p>Nothing aired yet.</p>')
    + '</body></html>';
  bcSave('matchcast-brief.html', html, 'text/html');
}

// one place for every click in the console
function bcBindPanes() {
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('button,[data-pi]'); if (!t || !$('bc').contains(t)) return;
    if (t.dataset.airid) { const g = BC.airMap[t.dataset.airid]; if (g) bcAir(g); return; }
    if (t.dataset.iso !== undefined) { const p = players[+t.dataset.iso]; if (p) bcCam('player', p); return; }
    if (t.dataset.camTake !== undefined) { const p = players[+t.dataset.pi]; bcCam(t.dataset.camTake, p); return; }
    if (t.dataset.order) { const p = players[+t.dataset.pi]; if (p) sendToPlayer(p, ORDERS[t.dataset.order].label, t.dataset.order); return; }
    if (t.closest('#pl-team') && t.dataset.ti !== undefined) { BC.team = +t.dataset.ti; bcPaintPlayers(); return; }
    if (t.dataset.pi !== undefined && t.tagName === 'BUTTON' && t.getAttribute('type') !== 'submit' && t.dataset.pi !== '-1') { bcOpenPlayer(players[+t.dataset.pi]); return; }
  });
  document.addEventListener('submit', (ev) => {
    if (ev.target.id !== 'pc-form') return; ev.preventDefault();
    const p = BC.player, q = $('pc-q'); if (p && q && q.value.trim()) sendToPlayer(p, q.value, null);
  });
}

bcBoot();
