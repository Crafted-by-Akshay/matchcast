// ============ BROADCASTER CONSOLE: core (bc-core.js) ============
// Reads the simulator and the prediction engine through their public hooks; never edits them.
const BC = { lang: 'en', pane: 'focus', player: null, series: [], lastRes: null, lastNg: null, lastCap: -99, reason: null, call: null, callT: -99, wildKey: '', wildOff: -99, l3: null, l3T: -99, script: [], cursor: 0, graphics: [], aired: [], pre: null, ask: null, whatIf: null, lastSample: -1, seq: 0 };
const bcPct = (x) => Math.round((x || 0) * 100) + '%';
const bcEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bcTeam = (ti) => (TEAMS[ti] ? TEAMS[ti].club : '');
const bcTeamKey = (ti) => (TEAMS[ti] ? TEAMS[ti].key : '');
const bcTi = (key) => (TEAMS[0] && TEAMS[0].key === key ? 0 : 1);
// write only when the markup changed, so buttons and inputs are not rebuilt under the user's pointer
const bcSet = (id, html) => { const el = $(id); if (el && el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html; } };
const bcBar = (x, cls) => '<div class="bc-bar ' + (cls || '') + '"><i style="width:' + Math.max(0, Math.min(100, x * 100)).toFixed(1) + '%"></i></div>';
const bcSrc = (s) => '<span class="bc-src">' + bcEsc(s) + '</span>';
const bcPane = (p) => { BC.pane = p; for (const b of $('bc-tabs').querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.p === p)); for (const k of ['focus', 'win', 'script', 'players', 'calls', 'desk']) $('pane-' + k).hidden = k !== p; };

// camera and playback use the engine's own controls, so the 3D view, its camera bar and its state stay in sync
function bcCam(v, p) {
  const label = (CAMS.find((c) => c[0] === v) || [])[1];
  const b = label && [...$('cams').querySelectorAll('button')].find((x) => x.textContent.trim() === label);
  if (b) b.click(); else S.cam = v;
  if (v === 'player' && p) S.follow = p;
}
function bcTogglePlay() { S.paused = !S.paused; }
function bcSpeed(v) { S.speed = +v; }

// the engine's commentary clock and score, read straight from its hud
function bcHeader() {
  $('bc-clk').textContent = $('clock') ? $('clock').textContent : '0:00';
  $('bc-score').textContent = S.score.join('–');
  $('bc-h').textContent = TEAMS[0].key; $('bc-a').textContent = TEAMS[1].key;
  const st = !S.started ? ['Pre-match', ''] : S.over ? ['Full-time', 'ft'] : S.ht ? ['Half-time', ''] : S.paused ? ['Paused', ''] : ['Live', 'live'];
  const el = $('bc-state'); if (el.textContent !== st[0]) el.textContent = st[0]; el.className = 'bc-state ' + st[1];
  const pp = $('bc-pp'); const want = S.paused ? 'Play' : 'Pause'; if (pp.textContent !== want) pp.textContent = want; pp.setAttribute('aria-pressed', String(S.paused));
  for (const b of $('bc-cams').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.cam === S.cam));
  for (const b of $('bc-lang').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.l === BC.lang));
}

// reason caption: when the odds move, say why in the same breath
function bcCaption(P) {
  const r = P.result, n = P.nextGoal, last = BC.lastRes, lastN = BC.lastNg;
  BC.lastRes = { home: r.home, draw: r.draw, away: r.away }; BC.lastNg = { home: n.home, away: n.away, none: n.none };
  if (!last || S.t - BC.lastCap < 8) return;
  // the team whose odds moved most, by size of change either way (a fall counts as much as a rise)
  const dH = r.home - last.home, dA = r.away - last.away, dR = Math.max(Math.abs(dH), Math.abs(dA));
  const gH = n.home - lastN.home, gA = n.away - lastN.away, dN = Math.max(Math.abs(gH), Math.abs(gA));
  if (dN >= 0.03 && dN >= dR / 2) {
    const ti = Math.abs(gH) >= Math.abs(gA) ? 0 : 1, to = ti === 0 ? n.home : n.away, was = ti === 0 ? lastN.home : lastN.away;
    BC.reason = { kicker: 'Why the odds moved', text: 'Next goal ' + bcTeam(ti) + ' ' + bcPct(was) + ' → ' + bcPct(to) + '. ' + (n.why[0] || '') };
  } else if (dR >= 0.03) {
    const ti = Math.abs(dH) >= Math.abs(dA) ? 0 : 1, to = ti === 0 ? r.home : r.away, was = ti === 0 ? last.home : last.away;
    BC.reason = { kicker: 'Why the odds moved', text: bcTeam(ti) + ' to win ' + bcPct(was) + ' → ' + bcPct(to) + '. ' + (P.danger.why || '') };
  } else return;
  BC.lastCap = S.t; BC.reasonT = S.t;
}
function bcDrawReason() {
  const el = $('bc-reason'), show = BC.reason && S.started && S.t - (BC.reasonT ?? -99) < 7;
  el.hidden = !show; if (show) bcSet('bc-reason', '<b>' + bcEsc(BC.reason.kicker) + '</b>' + bcEsc(BC.reason.text));
}

// calls: a claim lands on screen as it is made and again when it is settled
function bcOnCall(r) {
  BC.call = r; BC.callT = S.t; BC.callResolved = r.resolved !== null && r.resolved !== undefined;
}
function bcDrawCall() {
  const el = $('bc-call'), r = BC.call, show = r && S.t - BC.callT < 7;
  el.hidden = !show; if (!show) return;
  const pc = bcPct(r.p);
  if (r.resolved === null || r.resolved === undefined) { el.className = 'bc-call'; bcSet('bc-call', '<b>Call on the board</b>' + bcEsc(r.claim) + ' · ' + pc); }
  else { const hit = (r.p >= 0.5) === r.resolved; el.className = 'bc-call ' + (hit ? 'hit' : 'miss'); bcSet('bc-call', '<b>' + (hit ? '✓ Called right' : '✗ Missed') + '</b>' + bcEsc(r.claim) + ' · ' + pc + (r.note ? ' · ' + bcEsc(r.note) : '')); }
}

// wild moment: the engine's strongest cue, with one-tap iso on the player it is about
function bcWild(P) {
  const w = P.wild, el = $('bc-wild');
  if (w && w.score >= 70 && w.kind + w.text !== BC.wildKey && S.t - BC.wildOff > 30) { BC.wildKey = w.kind + w.text; BC.wildShown = S.t; BC.wildNow = w; }
  const show = BC.wildNow && BC.wildNow !== BC.wildDone && S.t - BC.wildShown < 14;
  el.hidden = !show; if (!show) return;
  const k = BC.wildNow;
  bcSet('bc-wild', '<div class="t"><span class="bc-tag live">Wild moment · ' + k.score + '</span><b>' + bcEsc(k.text) + '</b>' + bcEsc(k.why) + '</div><button class="bc-btn pri" data-act="wild-go">Go to it</button><button class="bc-btn" data-act="wild-x">Dismiss</button>');
}

// lower third: an aired graphic, shown for 10 sim seconds and logged to the overlay track
function bcAir(item) {
  BC.l3 = item; BC.l3T = S.t; item.aired = true;
  exOverlay('director_graphic', 'lower_third', 10, { kicker: item.kicker, title: item.title, text: item.text }, item.src || '');
  BC.aired.push({ id: item.id, kicker: item.kicker, title: item.title, text: item.text, src: item.src || '', minute: Math.floor(S.mclock / 60), simT: +S.t.toFixed(1) });
  if (BC.aired.length > 60) BC.aired.shift();
  bcPaintDesk();
}
function bcDrawL3() {
  const el = $('bc-l3'), show = BC.l3 && S.t - BC.l3T < 10;
  el.hidden = !show; if (!show) return;
  bcSet('bc-l3', '<small>' + bcEsc(BC.l3.kicker) + '</small><strong>' + bcEsc(BC.l3.title) + '</strong><br><span>' + bcEsc(BC.l3.text) + '</span>');
}

// the bottom strip: the most useful single line right now
function bcMini(P) {
  if (!P) { bcSet('bc-mini', '<div>' + bcEsc(bcTeam(0)) + '<b>–</b></div><div>Draw<b>–</b></div><div>' + bcEsc(bcTeam(1)) + '<b>–</b></div>'); return; }
  const c = (lab, x, cls) => '<div>' + lab + '<b>' + bcPct(x) + '</b>' + bcBar(x, cls) + '</div>';
  bcSet('bc-mini', c(bcEsc(bcTeam(0)), P.result.home, 'h') + c('Draw', P.result.draw, 'n') + c(bcEsc(bcTeam(1)), P.result.away, 'a'));
}
function bcStrip(P) {
  const last = BC.script[BC.script.length - 1], top = P.storylines && P.storylines[0];
  const parts = [];
  if (top) parts.push('<b>Top storyline:</b> ' + bcEsc(top.title));
  if (last) parts.push('<b>Latest:</b> ' + bcEsc(BC.lang === 'ta' ? last.ta : last.en));
  bcSet('bc-strip', parts.join(' &nbsp;·&nbsp; ') || 'Waiting for kick-off.');
}

// engine hooks
function bcOnEvent(ev) {
  const line = bcLine(ev);
  if (line) bcPushLine(line);
  if (line && (ev.type === 'goal' || ev.type === 'red_card')) { BC.graphics.unshift({ id: 'g' + (++BC.seq), kicker: 'Event · ' + line.min + "'", title: ev.type === 'goal' ? 'Goal: ' + ev.player : 'Red card: ' + ev.player, text: line.en, src: 'sim event: ' + ev.type }); bcPaintDesk(); }
  if (ev.type === 'goal' || ev.type === 'red_card' || ev.type === 'half_time' || ev.type === 'full_time') bcPaintScript();
}
function bcOnMoment(m) {
  BC.graphics.unshift({ id: 'g' + (++BC.seq), kicker: 'Moment · ' + m.minute + "'", title: m.title, text: m.why, src: 'explain.js moment (' + m.type + ')' });
  if (BC.graphics.length > 30) BC.graphics.pop();
  bcPaintDesk();
}

// match setup: a fresh seed each time, and the pre-match package once kick-off has run
function bcNewMatch(seed) {
  SET.seed = seed ? +seed : (Math.random() * 1e9) | 0;
  BC.series = []; BC.lastRes = null; BC.lastNg = null; BC.reason = null; BC.wildNow = null; BC.wildKey = ''; BC.call = null; BC.l3 = null;
  BC.script = []; BC.cursor = 0; BC.graphics = []; BC.aired = []; BC.player = null; BC.whatIf = null; BC.wildDone = null; BC.wildOff = -99;
  kickOff();
  S.paused = false; S.speed = +$('bc-speed').value;
  BC.pre = bcPrematch();
  bcPaintAll();
}
function bcPrematch() {
  const avg = (ti) => { const L = players.filter((p) => p.ti === ti && !p.off); return L.reduce((a, p) => a + p.rating, 0) / Math.max(1, L.length); };
  const top = (ti) => players.filter((p) => p.ti === ti).sort((a, b) => b.rating - a.rating).slice(0, 3);
  const prior = (typeof HX !== 'undefined' && HX.mode === 'intl' && HX.prior) ? HX.prior : null;
  return {
    venue: SET.st.name + ', ' + SET.st.city, weather: WX[ENV.wx].label + ', ' + Math.round(ENV.temp) + '°C', ref: OFFICIALS.ref + ' (' + OFFICIALS.nat + ')',
    teams: [0, 1].map((ti) => ({ ti, club: bcTeam(ti), key: bcTeamKey(ti), form: TEAMS[ti].tac.form, style: STYLES[TEAMS[ti].tac.style].label, rating: Math.round(avg(ti)), top: top(ti) })),
    prior,
  };
}

function bcBoot() {
  $('bc-view').prepend($('stage'));
  window.dispatchEvent(new Event('resize'));
  // chips for the camera and the language switch
  $('bc-cams').innerHTML = CAMS.map(([v, l]) => '<button data-cam="' + v + '">' + l + '</button>').join('');
  $('bc-tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) bcPane(b.dataset.p); });
  $('bc-cams').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) bcCam(b.dataset.cam); });
  $('bc-pp').onclick = bcTogglePlay;
  $('bc-speed').onchange = (e) => bcSpeed(e.target.value);
  $('bc-new').onclick = () => bcNewMatch();
  $('bc-lang').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; BC.lang = b.dataset.l; bcPaintScript(); });
  $('bc-wild').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    BC.wildDone = BC.wildNow; BC.wildOff = S.t;
    if (b.dataset.act === 'wild-x') { $('bc-wild').hidden = true; return; }
    const P = predNow(), f = P.focus && players.find((p) => p.name === P.focus.name && p.ti === P.focus.ti);
    if (f) bcCam('player', f); else bcCam('ball');
  });
  $('bc-l3').onclick = () => { BC.l3 = null; $('bc-l3').hidden = true; };
  // name tags on the pitch open the player card here, not in the engine's hidden Copilot panel
  openTalk = (p) => bcOpenPlayer(p);
  onMatchEvent(bcOnEvent);
  onPrediction(bcOnCall);
  MCX.onMoment(bcOnMoment);
  setInterval(bcTick, 250);
  // wait for the engine to load its players, then open a match
  bcBindPanes();
  const wait = setInterval(() => { if (players.length && $('load').hidden) { clearInterval(wait); const q = new URLSearchParams(location.search); bcNewMatch(q.get('seed')); } }, 200);
}

function bcTick() {
  bcHeader();
  if (!S.started) { bcStrip({ storylines: [] }); bcMini(null); bcDrawL3(); return; }
  const P = predNow();
  bcCaption(P); bcWild(P); bcDrawReason(); bcDrawCall(); bcDrawL3();
  bcSample(P);
  bcStrip(P); bcMini(P);
  bcPaintPane(P);
}
function bcPaintPane(P) {
  if (BC.pane === 'focus') bcPaintFocus(P);
  else if (BC.pane === 'win') bcPaintWin(P);
  else if (BC.pane === 'script') bcPaintScript(P);
  else if (BC.pane === 'players') bcPaintPlayers();
  else if (BC.pane === 'calls') bcPaintCalls();
  else if (BC.pane === 'desk') bcPaintDesk(P);
}
function bcPaintAll() { bcPaintFocus(); bcPaintWin(); bcPaintScript(); bcPaintPlayers(); bcPaintCalls(); bcPaintDesk(); }

// win-probability series, sampled every half match minute, for the trend chart
function bcSample(P) {
  const k = Math.floor(S.mclock / 30);
  if (k === BC.lastSample) return; BC.lastSample = k;
  BC.series.push({ m: S.mclock / 60, h: P.result.home, d: P.result.draw, a: P.result.away });
  if (BC.series.length > 400) BC.series.shift();
}
