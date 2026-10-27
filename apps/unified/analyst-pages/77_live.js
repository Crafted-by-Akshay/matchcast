// Live maps (Analyst page "Live maps"): the Watch match as it plays. The shell forwards Watch's pitch frames (four a second) and
// its events to this page; one position sample is kept per match second, and the heatmaps, average positions and pass network
// are built from those samples the same way as for a finished match. Simulated, one match at a time.
const LIVE = { key: null, roster: null, frames: [], events: [], seen: new Set(), last: -1, halfEnd: 0 };
const LIVE_HALF_CLOCK = 45 * 60;   // Watch's clock starts the second half at 45:00 (setup.js), so it goes back at half-time
const liveKey = (s) => [s.h, s.a, s.seed, s.st, s.month, s.kick, s.half].join('|');
function liveReset(key) { LIVE.key = key; LIVE.roster = null; LIVE.frames = []; LIVE.events = []; LIVE.seen = new Set(); LIVE.last = -1; LIVE.halfEnd = 0; }

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.src !== 'matchcast-shell' || !d.setup) return;
  const key = liveKey(d.setup);
  if (d.type === 'live-start') { liveReset(key); LIVE.roster = d.roster; return; }
  if (LIVE.key !== key) liveReset(key);
  if (d.type === 'live-frame' && d.frame && d.frame.players && d.frame.players.length) {
    // order by half, then the clock: the clock goes back to 45:00 at half-time, which is not a new kick-off (as maps.js)
    const half = d.frame.half || 1, sec = Math.floor(d.frame.mclock || 0), order = half * 1e6 + sec;
    if (order === LIVE.last) return;
    if (order < LIVE.last) { const roster = LIVE.roster; liveReset(key); LIVE.roster = roster; }   // a new kick-off in the same half; the roster stays
    LIVE.last = order;
    if (half === 1) LIVE.halfEnd = sec;
    const t = half === 1 ? sec : (LIVE.halfEnd || LIVE_HALF_CLOCK) + Math.max(0, sec - LIVE_HALF_CLOCK);   // one match timeline
    LIVE.frames.push({ t, f: half - 1, p: d.frame.players.map((q) => [q[0], q[1]]) });
  }
  if (d.type === 'live-batch' && Array.isArray(d.batch)) {
    for (const ev of d.batch) {
      const id = ev.simT + ':' + ev.type + ':' + (ev.player || '');
      if (LIVE.seen.has(id)) continue;
      LIVE.seen.add(id); LIVE.events.push(ev);
    }
  }
});

// the live match in the shape the heatmap and pass-network code reads (a season match has the same fields)
function liveMatch() {
  const r = LIVE.roster; if (!r) return null;
  return {
    id: 'LIVE', home: r.teams[0], away: r.teams[1], live: true,
    pids: r.players.map((p, i) => ({ name: p.name, team: p.team, num: i < 11 ? i + 1 : i - 10 })),
    frames: LIVE.frames, events: LIVE.events,
  };
}

function liveBody(m) {
  const minutes = Math.floor((LIVE.frames.length ? LIVE.frames[LIVE.frames.length - 1].t : 0) / 60);
  if (!m.frames.length) return '<div class="empty">Waiting for kick-off in Watch. Each match second adds a position sample, and the maps fill in.</div>';
  const idx = (k) => m.pids.map((p, i) => (p.team === k ? i : -1)).filter((i) => i >= 0);
  const pass = (k) => mcNetwork(m, k);
  const avg = pitch(mcAvgPos(m).filter(Boolean).map((p) => { const home = p.i < 11; const x = home ? p.x : 105 - p.x, y = home ? p.y : 68 - p.y; return '<g><circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.3" fill="' + mcc(m, p.pid.team) + '" stroke="var(--surface)" stroke-width=".4"/><title>' + esc(p.pid.name) + '</title></g>'; }).join(''), { title: 'Average positions' });
  return '<div class="grid"><div class="s6">' + card(esc(m.home) + ' heatmap', 'Time in each zone, both halves, attacking →. Live: one sample per match second.', hmMap(m, idx(m.home), mcc(m, m.home), m.home + ' heatmap')) + '</div>' +
    '<div class="s6">' + card(esc(m.away) + ' heatmap', 'Each side attacks right.', hmMap(m, idx(m.away), mcc(m, m.away), m.away + ' heatmap')) + '</div>' +
    '<div class="s6">' + card('Average positions', 'Each player’s average spot so far, attacking →', avg) + '</div>' +
    '<div class="s6">' + card('Pass network', 'Passes so far (three or more between a pair)', '<div class="grid"><div class="s6">' + pass(m.home) + '</div><div class="s6">' + pass(m.away) + '</div></div>') + '</div>' +
    '<div class="s12">' + card('Player heatmap', 'Pick a player. Stay is how far, on average, he strays from his average spot.', '<label class="field">Player<select id="lv-sel">' + m.pids.map((p, i) => '<option value="' + i + '"' + (i === HM.p ? ' selected' : '') + '>' + esc(p.num + ' ' + p.name + ' · ' + clubName(p.team)) + '</option>').join('') + '</select></label><div id="lv-player" style="margin-top:10px">' + hmPlayer(m, HM.p) + '</div>') + '</div>' +
    '<p class="note">Live from Watch · ' + minutes + '′ sampled · ' + LIVE.events.length + ' events · simulated match, synthetic squads</p></div>';
}

// the player picker keeps its choice when the maps redraw
function liveBind(body, m) {
  const sel = body.querySelector('#lv-sel'); if (!sel) return;
  sel.onchange = () => { HM.p = +sel.value; body.querySelector('#lv-player').innerHTML = hmPlayer(m, HM.p); };
}

// a console opened mid-match has no roster yet: ask the shell for the last Watch start
if (window.parent !== window) window.parent.postMessage({ src: 'matchcast', view: 'analyst', type: 'live-request' }, '*');

let LIVE_TIMER = 0;
ICONS['live-maps'] = 'M4 5l5-2 6 2 5-2v16l-5 2-6-2-5 2zM9 3v16M15 5v16';
page({ id: 'live-maps', title: 'Live maps', render(el) {
  const m = liveMatch();
  el.innerHTML = pgHead('Live maps', 'Watch’s match as it plays: positions, passes and zones. Simulated.') + '<div id="lv-body">' + (m ? liveBody(m) : '<div class="empty">Start the match in Watch. Its positions and passes appear here as it plays.</div>') + '</div>';
  const body = el.querySelector('#lv-body');
  if (m) liveBind(body, m);
  clearInterval(LIVE_TIMER);
  LIVE_TIMER = setInterval(() => {
    if (R.page !== 'live-maps') { clearInterval(LIVE_TIMER); return; }
    const mm = liveMatch(), cur = document.getElementById('lv-body');
    if (!mm || !cur || !mm.frames.length) return;
    if (cur.querySelector('#lv-sel') && cur.querySelector('#lv-sel') === document.activeElement) return;   // do not redraw under the picker
    cur.innerHTML = liveBody(mm); liveBind(cur, mm);
  }, 3000);
} });
