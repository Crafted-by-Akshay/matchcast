// ---- unified shell hook: Broadcast ----
MCS.view = 'broadcast';
MCS.progress('Loading the stadium and players');
// called by the desk once the players have loaded (replaces bcNewMatch(seed) at boot)
function bcEmbedStart(q) {
  MCS.progress('Setting up the match');
  const go = () => { if (q.get('seed')) { MCS.apply(q); bcNewMatch(q.get('seed')); } else bcNewMatch(); MCS.started(); };
  if (MCS.clubs.ready) go(); else MCS.clubs.load.then(go);
}
$('bc-new').addEventListener('click', () => setTimeout(() => MCS.started(), 0));   // after the desk's own handler has set the new seed
MCS.loop();

// the shared score: while Watch runs the shared match, the scoreboard shows Watch's score and minute.
// The pitch still runs the desk's own engine, so its goals can differ until the single-engine refactor.
let shellFeed = null;
window.addEventListener('message', (e) => { const d = e.data || {}; if (d.src === 'matchcast-shell' && d.type === 'feed') shellFeed = d; });
const bcHeaderOwn = bcHeader;
bcHeader = function () {
  bcHeaderOwn();
  if (shellFeed && shellFeed.on) { $('bc-score').textContent = shellFeed.score.join('–'); $('bc-clk').textContent = shellFeed.over ? 'FT' : shellFeed.minute + "'"; }
};

// ---- EXP-2: consumer mode. Inside the unified app Broadcast does not simulate. Its pitch, score, clock and stats come from Watch's frames,
// and Watch's events are replayed onto its own event bus, so the desk (odds, calls, focus board, lower-thirds) reads the same match.
window.MC_CONSUMER = MCS.framed;
const CONS = { frame: null, at: 0, n: 0 };
if (window.MC_CONSUMER) {
  const wait = document.createElement('div');
  wait.id = 'mc-wait'; wait.setAttribute('role', 'status'); wait.textContent = 'Waiting for Watch to kick off';
  wait.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:50;padding:6px 12px;border-radius:999px;background:#17283F;border:1px solid #F5B942;color:#E8EEF7;font:600 12px Inter,system-ui,sans-serif';
  document.body.appendChild(wait);
  for (const id of ['bc-pp', 'bc-speed']) { const el = $(id); if (el) { el.disabled = true; el.title = 'Watch runs the match; use its controls'; } }
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.src !== 'matchcast-shell') return;
    if (d.type === 'frame') { CONS.frame = d.frame; CONS.at = performance.now(); CONS.n++; wait.hidden = true; S.paused = !!d.frame.paused; S.speed = d.frame.speed || 1; if (S.paused || !S.started) consumerStep(0.016, true); }   // paused: the sim loop is idle, so apply the frame at once
    if (d.type === 'events') {
      for (const ev of d.batch) {
        const { type, ...rest } = ev;
        // the explain and fan modules read the pass in flight from S.passInfo, so rebuild it from the event
        if (type === 'pass' || type === 'throw_in') {
          const by = (n) => players.find((q) => q.name === n && q.T.key === ev.team);
          S.passInfo = { from: by(ev.player), to: by(ev.to), kind: ev.kind || 'throw-in', pq: ev.quality, diff: ev.difficulty, t: S.t, done: false };
        }
        try { dataEvent(type, rest); } catch (err) { console.error(err); }
      }
    }
  });
}
// one consumer step: move everything toward Watch's latest frame (called from stepSim, so the desk's own per-tick modules still run)
function consumerStep(dt, snap) {
  const f = CONS.frame; if (!f) return;
  const k = snap ? 1 : Math.min(1, dt * 10), age = snap ? 0 : Math.min(0.5, (performance.now() - CONS.at) / 1000);
  S.clock += dt; S.t += dt;
  S.mclock = snap || Math.abs(S.mclock - f.mclock) > 5 ? f.mclock : S.mclock + (f.mclock - S.mclock) * Math.min(1, dt * 4);
  ENV.minute = S.mclock / 60;
  S.half = f.half; S.ht = f.ht; S.over = f.over; S.score[0] = f.score[0]; S.score[1] = f.score[1];
  Object.assign(STATS, f.stats);
  f.players.forEach((q, i) => {
    const p = players[i]; if (!p || p.off) return;
    p.pos2.x += (q[0] + q[2] * age - p.pos2.x) * k; p.pos2.y += (q[1] + q[3] * age - p.pos2.y) * k;
    p.vel.set(q[2], q[3]);
    // the action pose (kick, slide, header, dive, celebration): take Watch's, then run its clock here because the desk does not step the match
    const a = q[5];
    if (a) { a.plan = { lofted: a.lofted }; if (snap || !p.act || p.act.type !== a.type || Math.abs(p.act.t - a.t) > 0.35) p.act = a; }
    else if (p.act && (snap || p.act.t >= p.act.dur * 0.9)) p.act = null;
    if (p.act && !snap) { p.act.t += dt; if (p.act.t >= p.act.dur) p.act = null; }
    let dy = q[4] - p.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); p.yaw += dy * k;
  });
  const kb = snap ? 1 : Math.min(1, dt * 14);
  ball.p.x += (f.ball[0] - ball.p.x) * kb; ball.p.y += (f.ball[1] - ball.p.y) * kb; ball.p.z += (f.ball[2] - ball.p.z) * kb;
}

// ---- lower-third and teleprompter (EXP-7): only lines the shell has approved for air reach here
const mcL3 = document.createElement('div');
mcL3.id = 'mc-l3'; mcL3.setAttribute('role', 'status'); mcL3.hidden = true;
mcL3.style.cssText = 'position:absolute;left:12px;bottom:100px;max-width:60%;padding:10px 16px;background:rgba(10,20,40,.92);color:#fff;border-left:4px solid #3aa0ff;font:600 15px system-ui,sans-serif;z-index:10;border-radius:4px';
const mcTele = document.createElement('ol');
mcTele.id = 'mc-tele'; mcTele.setAttribute('aria-label', 'Teleprompter: approved lines');
mcTele.style.cssText = 'position:absolute;right:10px;top:44px;width:280px;margin:0;padding:8px 8px 8px 28px;background:rgba(10,20,40,.85);color:#e8eefc;font:13px system-ui,sans-serif;border-radius:4px;max-height:40%;overflow:auto;z-index:10'; mcTele.hidden = true;
// bc.css hides every direct child of body except #bc, #stage and #load, so on-air graphics sit inside the live view
(document.getElementById('bc-view') || document.body).append(mcL3, mcTele);
let mcL3Timer = 0; const mcAired = [];
window.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.src !== 'matchcast-shell' || d.type !== 'air' || !d.line) return;
  const l = d.line; if (mcAired.some((x) => x.id === l.id)) return;
  mcAired.push(l); if (mcAired.length > 5) mcAired.shift();
  mcL3.textContent = (l.alert ? 'ALERT · ' + l.alert + (l.verdict === 'verified' ? ' · verified' : '') + ' · ' : '') + Math.floor(l.minute) + "' " + l.text; mcL3.hidden = false;
  mcL3.style.borderLeftColor = l.alert ? '#ff4d4d' : '#3aa0ff';
  mcL3.dataset.alert = l.alert || '';
  clearTimeout(mcL3Timer); mcL3Timer = setTimeout(() => { mcL3.hidden = true; }, 8000);
  mcTele.hidden = false; mcTele.innerHTML = ''; for (const x of mcAired.slice().reverse()) { const li = document.createElement('li'); li.textContent = x.text; mcTele.append(li); }
});
