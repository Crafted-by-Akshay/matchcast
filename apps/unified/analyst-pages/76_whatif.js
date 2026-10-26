// What if studio (Analyst page "What if", route whatif or whatif.<clip id>). Pre-rendered re-runs of a fixture: the same seed plays
// it twice, untouched and with one change at a minute (services/simulation/run.cjs, whatif/README.md). A clip plays on a top-down
// pitch with play, pause, scrub, speed, a telestrator overlay and the outcome over the seeds. Every number is a simulated estimate.
ICONS.whatif = 'M4 19h16M7 15l4-4 3 3 5-6';
const WI_RATE = 20;   // match seconds per real second at 1x: a three-minute clip plays in about ten seconds
const WI = { index: null, clip: null, t: 0, playing: false, speed: 1, view: 'side', tele: true, raf: 0, last: 0 };

async function wiLoad() {
  if (WI.index) return WI.index;
  try { WI.index = await (await fetch('data/whatif/index.json')).json(); } catch (e) { WI.index = { clips: [] }; }
  return WI.index;
}
const wiAvg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const wiTeamOf = (c) => (c.change.kind === 'move' ? (c.change.pi < 11 ? 0 : 1) : c.change.ti);
const wiColour = (c, side) => c.teams[side === 0 ? 'home' : 'away'].color;

// outcome after the change, averaged over the seeds; how often the changed side's xG margin improved
function wiOutcome(c) {
  const k = wiTeamOf(c), o = 1 - k, P = c.pairs, n = P.length;
  const row = (f) => ({ mine: wiAvg(P.map((p) => f(p.base, k))), what: wiAvg(P.map((p) => f(p.what, k))), oppBase: wiAvg(P.map((p) => f(p.base, o))), oppWhat: wiAvg(P.map((p) => f(p.what, o))) });
  const better = P.filter((p) => (p.what.xg[k] - p.what.xg[o]) > (p.base.xg[k] - p.base.xg[o])).length;
  return { k, o, n, goals: row((a, i) => a.score[i]), shots: row((a, i) => a.shots[i]), xg: row((a, i) => a.xg[i]), better };
}

const wiClock = (t) => { const s = Math.floor(t), m = Math.floor(s / 60); return m + '′ ' + String(s % 60).padStart(2, '0') + '″'; };
const wiIdx = (c, t) => Math.min(c.track.base.length - 1, Math.max(0, t - c.track.base[0].t));
// the mover's attacking direction: +1 when his own goalkeeper defends x = 0 in the first sample
function wiFwd(c) { const gk = c.track.base[0].p[wiTeamOf(c) ? 11 : 0]; return gk && gk[0] > 52 ? -1 : 1; }

function wiDots(pref, n, fill) {
  let s = '';
  for (let i = 0; i < n; i++) s += '<circle id="wi-' + pref + '-' + i + '" r="2.2" fill="' + fill(i) + '" stroke="var(--surface)" stroke-width=".4"/>';
  return s;
}

// the telestrator: the requested move as an arrow and a target ring, the mover's run so far, and his name
function wiTele(c) {
  if (c.change.kind !== 'move') return '<g id="wi-tele"></g>';   // a formation change has no single player to point at
  const pi = c.change.pi, t0 = c.track.base[0].t, i0 = Math.round(c.change.minute * 60 - t0), i = wiIdx(c, WI.t);
  // the engine moves a player in his own team's frame; an away player's frame is turned round, so his dy points the other way on the pitch
  const from = c.track.base[i0].p[pi], f = wiFwd(c), dyWorld = pi < 11 ? c.change.dy : -c.change.dy, to = [from[0] + f * c.change.dx, from[1] + dyWorld];
  const run = c.track.what.slice(i0, i + 1).map((s) => s.p[pi]);
  const trail = run.length > 1 ? '<polyline points="' + run.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ') + '" fill="none" stroke="' + wiColour(c, wiTeamOf(c)) + '" stroke-width=".9" stroke-opacity=".85"/>' : '';
  const arrow = '<defs><marker id="wi-head" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4z" fill="var(--warn)"/></marker></defs>' +
    '<line x1="' + from[0].toFixed(1) + '" y1="' + from[1].toFixed(1) + '" x2="' + to[0].toFixed(1) + '" y2="' + to[1].toFixed(1) + '" stroke="var(--warn)" stroke-width=".8" stroke-dasharray="2 1" marker-end="url(#wi-head)"/>' +
    '<circle cx="' + to[0].toFixed(1) + '" cy="' + to[1].toFixed(1) + '" r="4" fill="none" stroke="var(--warn)" stroke-width=".5" stroke-dasharray="1 1"/>';
  return '<g id="wi-tele">' + arrow + trail + '<text x="' + (from[0] + 2.5).toFixed(1) + '" y="' + (from[1] - 2.5).toFixed(1) + '" style="font-size:2.4px;fill:var(--text);font-weight:600">' + esc(c.track.names[pi]) + '</text></g>';
}

function wiStage(c) {
  const n = c.track.base[0].p.length, home = (i) => (i < 11 ? wiColour(c, 0) : wiColour(c, 1));
  if (WI.view === 'over') {
    const inner = wiDots('L', n, () => 'none') + wiDots('R', n, home) + (WI.tele ? wiTele(c) : '');
    return pitch(inner, { title: 'Overlay: untouched run (ring) and what if (solid)' });
  }
  return '<div class="grid"><div class="s6">' + card('Untouched run', 'The simulator\'s own re-run of the same seed with no change. It is not the recorded match.', pitch(wiDots('L', n, home), { title: 'Untouched run' })) + '</div>' +
    '<div class="s6">' + card('What if', 'The same seed, one change at minute ' + c.change.minute, pitch(wiDots('R', n, home) + (WI.tele ? wiTele(c) : ''), { title: 'What if' })) + '</div></div>';
}

function wiPlain(c, o) {
  const name = c.track.names[c.change.pi] || '', dx = c.change.dx, dy = c.change.dy;
  const what = c.change.kind === 'move'
    ? name + ' moved ' + Math.abs(dx) + ' m ' + (dx < 0 ? 'deeper' : dx > 0 ? 'higher' : '') + (dy ? ' and ' + Math.abs(dy) + ' m ' + (dy < 0 ? 'left' : 'right') : '')
    : c.teams[c.change.ti ? 'away' : 'home'].club + ' switched to ' + c.change.form;
  return 'Over ' + o.n + ' simulated seeds, from minute ' + c.change.minute + ': ' + what + '. The changed side averaged ' + fmt(o.xg.what, 2) +
    ' xG after that minute, against ' + fmt(o.xg.mine, 2) + ' in the untouched run. Its xG margin was better in ' + o.better + ' of ' + o.n +
    ' seeds. Simulated estimates, not facts about the recorded match.';
}

function wiTable(c, o) {
  const rows = [['Goals (changed side)', o.goals.mine, o.goals.what], ['Goals (opponent)', o.goals.oppBase, o.goals.oppWhat],
    ['Shots (changed side)', o.shots.mine, o.shots.what], ['xG (changed side)', o.xg.mine, o.xg.what], ['xG (opponent)', o.xg.oppBase, o.xg.oppWhat]];
  return '<table><thead><tr><th>After minute ' + c.change.minute + ', averaged over ' + o.n + ' seeds</th><th>Untouched run</th><th>What if</th></tr></thead><tbody>' +
    rows.map(([l, a, b]) => '<tr><th>' + l + '</th><td>' + fmt(a, 2) + '</td><td>' + fmt(b, 2) + '</td></tr>').join('') + '</tbody></table>';
}

function wiPage(el) {
  const clips = WI.index.clips;
  if (!clips.length) { el.innerHTML = pgHead('What if', 'No what-if runs are published yet.'); return; }
  const cur = clips.find((x) => x.id === WI.clip) || clips[0];
  WI.current = cur;
  const o = wiOutcome(cur);
  el.innerHTML = pgHead('What if', 'Simulated estimates. The same seed plays the fixture twice; one change at one minute. The untouched run is the simulator\'s own re-run in the reference browser. Another browser can give a different result for the same seed, so read the direction of the change, not the exact score.') +
    '<div class="grid"><div class="s12">' + card(esc(cur.label), esc(cur.teams.home.club) + ' v ' + esc(cur.teams.away.club) + ' · seed ' + esc(cur.fixture.seed) + ' · ' + o.n + ' seeds',
      '<div class="key"><label class="field">Clip<select id="wi-clip">' + clips.map((x) => '<option value="' + x.id + '"' + (x.id === cur.id ? ' selected' : '') + '>' + esc(x.label) + '</option>').join('') + '</select></label>' +
      '<label class="field">View<select id="wi-view"><option value="side"' + (WI.view === 'side' ? ' selected' : '') + '>Side by side</option><option value="over"' + (WI.view === 'over' ? ' selected' : '') + '>Overlay</option></select></label>' +
      '<label class="field"><input type="checkbox" id="wi-tele-on"' + (WI.tele ? ' checked' : '') + '> Telestrator</label></div>' +
      '<div class="wi-controls" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0"><button id="wi-play" class="btn">' + (WI.playing ? 'Pause' : 'Play') + '</button>' +
      '<input id="wi-scrub" type="range" min="0" max="' + (cur.track.base.length - 1) + '" step="1" value="' + wiIdx(cur, WI.t) + '" aria-label="Clip time" style="flex:1 1 200px">' +
      '<span id="wi-time" class="mono">' + wiClock(WI.t) + '</span><label class="field">Speed<select id="wi-speed">' + [0.5, 1, 2].map((s) => '<option value="' + s + '"' + (WI.speed === s ? ' selected' : '') + '>' + s + '×</option>').join('') + '</select></label></div>' +
      '<div id="wi-body">' + wiStage(cur) + '</div>') + '</div>' +
    '<div class="s6">' + card('Outcome after the change', 'Simulated estimates. The untouched run and the what if use the same seeds.', wiTable(cur, o)) + '</div>' +
    '<div class="s6">' + card('In plain words', 'Written from the numbers, no model text', '<p>' + esc(wiPlain(cur, o)) + '</p>') + '</div></div>';
  wiBind(el);
  wiDraw();
}

function wiRedraw(el) { el.querySelector('#wi-body').innerHTML = wiStage(WI.current); wiDraw(); }

// redraw the frame at WI.t: positions interpolated between samples, the telestrator on top
function wiDraw() {
  const c = WI.current; if (!c || !document.getElementById('wi-time')) return;
  const i = wiIdx(c, WI.t), a = Math.floor(i), b = Math.min(a + 1, c.track.base.length - 1), f = i - a;
  const put = (pref, arm) => c.track.base[0].p.forEach((_, k) => {
    const el = document.getElementById('wi-' + pref + '-' + k); if (!el) return;
    const p = c.track[arm];
    el.setAttribute('cx', (p[a].p[k][0] + (p[b].p[k][0] - p[a].p[k][0]) * f).toFixed(2));
    el.setAttribute('cy', (p[a].p[k][1] + (p[b].p[k][1] - p[a].p[k][1]) * f).toFixed(2));
  });
  put('L', 'base'); put('R', 'what');
  const tele = document.getElementById('wi-tele'); if (tele) tele.outerHTML = wiTele(c);
  document.getElementById('wi-time').textContent = wiClock(WI.t);
  const sc = document.getElementById('wi-scrub'); if (sc) sc.value = String(i);
}

function wiTick(ts) {
  if (!WI.playing) return;
  const c = WI.current, dt = WI.last ? (ts - WI.last) / 1000 : 0; WI.last = ts;
  WI.t = Math.min(c.track.to, WI.t + dt * WI.speed * WI_RATE);
  if (WI.t >= c.track.to) WI.playing = false;
  wiDraw();
  if (WI.playing) WI.raf = requestAnimationFrame(wiTick);
  else { WI.last = 0; const bt = document.getElementById('wi-play'); if (bt) bt.textContent = 'Play'; }
}

function wiBind(el) {
  const cur = WI.current, on = (id, fn) => { const x = el.querySelector('#' + id); if (x) x.onchange = x.onclick = fn; };
  if (WI.t < cur.track.base[0].t || WI.t > cur.track.to) WI.t = cur.track.base[0].t;
  on('wi-clip', () => { WI.clip = el.querySelector('#wi-clip').value; WI.playing = false; cancelAnimationFrame(WI.raf); WI.t = 0; go('whatif', WI.clip); });
  on('wi-view', () => { WI.view = el.querySelector('#wi-view').value; wiRedraw(el); });
  on('wi-tele-on', () => { WI.tele = el.querySelector('#wi-tele-on').checked; wiRedraw(el); });
  on('wi-speed', () => { WI.speed = +el.querySelector('#wi-speed').value; });
  on('wi-play', () => {
    if (WI.playing) { WI.playing = false; cancelAnimationFrame(WI.raf); el.querySelector('#wi-play').textContent = 'Play'; return; }
    if (WI.t >= cur.track.to - 0.01) WI.t = cur.track.base[0].t;
    WI.playing = true; el.querySelector('#wi-play').textContent = 'Pause'; WI.last = 0; WI.raf = requestAnimationFrame(wiTick);
  });
  const sc = el.querySelector('#wi-scrub'); if (sc) sc.oninput = () => { WI.t = cur.track.base[0].t + +sc.value; wiDraw(); };
}

page({ id: 'whatif', title: 'What if', render(el, arg) {
  WI.clip = arg || WI.clip;
  el.innerHTML = pgHead('What if', 'Loading the what-if runs…');
  wiLoad().then(() => { if (R.page === 'whatif') wiPage(el); });
} });
