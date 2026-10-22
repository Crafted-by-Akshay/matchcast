// ---- unified shell hook: Broadcast ----
MCS.view = 'broadcast';
MCS.progress('Loading the stadium and players');
// called by the desk once the players have loaded (replaces bcNewMatch(seed) at boot)
function bcEmbedStart(q) {
  MCS.progress('Setting up the match');
  const go = () => { if (q.get('seed')) { MCS.apply(q); bcNewMatch(q.get('seed')); } else bcNewMatch(); MCS.started(); };
  if (MCS.clubs.ready) go(); else MCS.clubs.load.then(go);
}
$('bc-new').addEventListener('click', () => MCS.started());
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
    let dy = q[4] - p.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); p.yaw += dy * k;
  });
  const kb = snap ? 1 : Math.min(1, dt * 14);
  ball.p.x += (f.ball[0] - ball.p.x) * kb; ball.p.y += (f.ball[1] - ball.p.y) * kb; ball.p.z += (f.ball[2] - ball.p.z) * kb;
}
