// ---- DAT-11 task 277 (events): while Vision is on, each pass the pixel tracker derives (possession moving to a team-mate) is sent to the shell,
// which posts it as a contract `pass` event on the separate stream `<session>.vision` (docs/architecture/09 rule 4). Engine truth is never
// touched: the positions are the tracker's own (pixel-derived) track positions, taken from a short history near the pass times.
// Passes to the other team and carries are not sent (no interception or carry rules are built); they are counted in mcVisEvents().
(() => {
  const HIST = 24, stats = { sent: 0, skipped_other_team: 0, skipped_no_position: 0 };
  const hist = new Map();   // player index -> [{t, x, y}] newest last
  let lastT = -1;
  const near = (pid, t) => {
    const h = hist.get(pid); if (!h || !h.length) return null;
    let best = h[0]; for (const s of h) if (Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
    return Math.abs(best.t - t) <= 3 ? best : null;
  };
  const m = (v, hi) => Math.round(Math.max(0, Math.min(hi, v)) * 100) / 100;
  // the tracker's new passes (VIS.passes entries) as shell events; mcVisDerive lets a test feed it passes without waiting for the slow software-GL tracker
  const derive = (passes) => {
    const batch = [];
    for (const ev of passes) {
      if (ev.t <= lastT) continue;
      lastT = Math.max(lastT, ev.t);
      const a = players[ev.from], b = players[ev.to];
      if (!ev.ok) { stats.skipped_other_team++; continue; }
      const s = near(ev.from, ev.t0), e = near(ev.to, ev.t);
      if (!s || !e) { stats.skipped_no_position++; continue; }
      batch.push({ type: 'pass', minute: +ENV.minute.toFixed(2), team: a.T.key, from: a.name, to: b.name, start: { x: m(s.x, 105), y: m(s.y, 68) }, end: { x: m(e.x, 105), y: m(e.y, 68) } });
    }
    return batch;
  };
  window.mcVisDerive = (passes) => { const batch = derive(passes); stats.sent += batch.length; if (batch.length) MCS.send({ type: 'vision-events', batch }); return batch.length; };
  window.mcVisEvents = () => Object.assign({ derived: typeof VIS === 'undefined' ? 0 : VIS.passes.length, tracked: hist.size, now: S.t, pids: [...hist.keys()] }, stats);
  setInterval(() => {
    if (typeof VIS === 'undefined' || !VIS.on || !players.length) return;
    for (const k of VIS.tracks) {
      if (k.pid < 0 || k.missT > 0 || k.hits < 2) continue;
      let h = hist.get(k.pid); if (!h) hist.set(k.pid, h = []);
      h.push({ t: S.t, x: k.x, y: k.y }); if (h.length > HIST) h.shift();
    }
    if (!VIS.passes.length) { lastT = -1; return; }
    const batch = derive(VIS.passes);
    if (batch.length) { stats.sent += batch.length; MCS.send({ type: 'vision-events', batch }); }
  }, 500);
})();
// Vision is on by default in Watch: the pixel tracker runs from kick-off, and its passes reach the agents' .vision stream. The viewer can still turn it off with the Vision button.
(() => {
  const go = setInterval(() => {
    if (!window.__mc || !window.__mc.vis || !$('load') || !$('load').hidden) return;
    clearInterval(go);
    if (window.__mcHeadless) return;   // engine specs drive frame() in bulk with no GPU: a pixel capture per frame costs seconds each
    if (!window.__mc.vis.VIS.on) window.__mc.vis.toggle(true);
    if (narrow()) { $('visp').hidden = true; const b = $('visb'); if (b) b.setAttribute('aria-pressed', 'false'); }   // phone: the tracker runs, the panel stays closed until asked for (UX review, finding 1)
  }, 300);
})();
// Phone (≤ 640 px): the Vision panel would cover most of the pitch, so the Vision button and the panel's close button only show or hide the panel.
// The tracker keeps running for the agents; a desktop viewer still turns it off with the same button.
function narrow() { return window.matchMedia('(max-width:640px)').matches; }
(() => {
  const panelOnly = (e) => {
    const v = window.__mc && window.__mc.vis, vp = $('visp');
    if (!narrow() || !v || !v.VIS.on || !vp) return;
    e.stopImmediatePropagation(); e.preventDefault();
    vp.hidden = !vp.hidden;
    const b = $('visb'); if (b) b.setAttribute('aria-pressed', vp.hidden ? 'false' : 'true');
  };
  for (const id of ['visb', 'visp-x']) { const el = $(id); if (el) el.addEventListener('click', panelOnly, true); }
})();
// Vision throttle: a capture reads the GPU back, which on a slow machine stalls the frame loop. The tracker's period (VIS.period, in match seconds) is stretched so that captures use about a tenth of the wall time, up to 3 s, and eases back to 0.2 s when they are cheap. The panel's "Hz" shows the period actually in use.
(() => {
  const BASE = 0.2, MAX = 3, SHARE = 0.1;
  let prev = null;
  window.mcVisThrottle = () => {
    if (typeof VIS === 'undefined' || !VIS.cost) return null;
    const c = VIS.cost, now = { ms: c.cap + c.cls + c.det, n: c.n };
    const fresh = prev && now.n > prev.n;
    const per = fresh ? (now.ms - prev.ms) / (now.n - prev.n) : 0;   // wall ms one capture job costs
    prev = now;
    if (!fresh) return VIS.period;   // nothing captured since the last look (or the counters were reset)
    const want = Math.min(MAX, Math.max(BASE, (per / 1000 / SHARE) * Math.max(S.speed, 0.25)));   // VIS.acc advances by wall time x playback speed
    VIS.period += (want - VIS.period) * 0.5;
    return VIS.period;
  };
  setInterval(window.mcVisThrottle, 2000);
})();
