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
