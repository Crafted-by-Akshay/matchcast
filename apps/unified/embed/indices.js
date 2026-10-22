// ---- DAT-4 task 272: control, chaos and tempo over a rolling 5-minute window, from the match's own events (docs/metrics.md).
// A JavaScript port of packages/metrics/matchcast_metrics/indices.py; tests/e2e/indices-parity.spec.ts holds it to the Python results on shared golden cases.
// In the Watch build it also turns the engine's events into the metric inputs, draws a sparkline in Analyst mode, and sends the series to the shell
// for the Analyst's match page. Pass completion is inferred: a pass counts as completed unless the other team wins the ball within 6 s of it.
(() => {
  const WINDOW_MS = 300000, BINS = 8, DUELS = new Set(['slide_tackle', 'take_on', 'aerial_duel', 'duel']);
  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  const win = (ev, now, w) => ev.filter((e) => now - w < e.t_ms && e.t_ms <= now);
  const count = (ev, f) => ev.reduce((n, e) => n + (f(e) ? 1 : 0), 0);
  const tempo = (ev, now, w = WINDOW_MS) => count(win(ev, now, w), (e) => e.type === 'pass') / (w / 60000);
  const entropy = (passes) => {
    if (passes.length < 2) return 0;
    const c = new Array(BINS).fill(0);
    for (const p of passes) c[Math.floor(((Math.atan2(p.y1 - p.y0, p.x1 - p.x0) + Math.PI) / (2 * Math.PI)) * BINS) % BINS]++;
    const n = passes.length;
    return -c.reduce((s, k) => s + (k ? (k / n) * Math.log(k / n) : 0), 0) / Math.log(BINS);
  };
  const control = (ev, now, w = WINDOW_MS) => {
    const x = win(ev, now, w), passes = x.filter((e) => e.type === 'pass'), minutes = w / 60000;
    const stability = 1 - clamp((count(x, (e) => e.type === 'turnover') / minutes - 1) / 5);
    const completion = passes.length ? clamp((count(passes, (p) => p.completed) / passes.length - 0.6) / 0.32) : 0.5;
    let territory = 0.5;
    if (passes.length) {
      const teams = [...new Set(passes.map((p) => p.team))].sort();
      let lead = teams[0]; for (const t of teams) if (count(passes, (p) => p.team === t) > count(passes, (p) => p.team === lead)) lead = t;
      const ends = passes.filter((p) => p.team === lead).map((p) => Math.abs(p.x1 - (105 - p.attack_x)));
      territory = clamp((ends.reduce((s, v) => s + v, 0) / ends.length - 40) / 40);
    }
    return 100 * (0.35 * stability + 0.35 * completion + 0.3 * territory);
  };
  const chaos = (ev, now, w = WINDOW_MS) => {
    const x = win(ev, now, w), minutes = w / 60000;
    const t = clamp(count(x, (e) => e.type === 'turnover') / minutes / 6), d = clamp(count(x, (e) => DUELS.has(e.type)) / minutes / 12);
    return 100 * (0.4 * t + 0.3 * d + 0.3 * entropy(x.filter((e) => e.type === 'pass')));
  };
  const series = (ev, end, step = 60000, w = WINDOW_MS) => {
    const out = [];
    for (let t = step; t <= end; t += step) out.push({ t_ms: t, control: control(ev, t, w), chaos: chaos(ev, t, w), tempo: tempo(ev, t, w) });
    return out;
  };
  const api = { tempo, control, chaos, series, WINDOW_MS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  window.mcIndices = api;
  if (typeof onMatchEvent !== 'function') return;

  // the engine's events as metric inputs: a pass has the passer's and the receiver's position at the kick and the direction the passer's team attacks
  const ev = [];
  const byName = (n) => players.find((q) => q.name === n);
  onMatchEvent((e) => {
    const t_ms = Math.round((+e.minute || 0) * 60000);
    if (e.type === 'pass') {
      const p = byName(e.player), q = byName(e.to); if (!p || !q) return;
      ev.push({ type: 'pass', t_ms, team: e.team, completed: true, x0: p.pos2.x, y0: p.pos2.y, x1: q.pos2.x, y1: q.pos2.y, attack_x: dirOf(p.ti) > 0 ? 105 : 0 });
    } else if (e.type === 'turnover' || DUELS.has(e.type)) ev.push({ type: e.type, t_ms, team: e.team });
    if (ev.length > 6000) ev.splice(0, ev.length - 6000);
  });
  // completion is decided from the turnovers that followed, so it is applied to a copy when the numbers are read
  const view = () => ev.map((e) => (e.type === 'pass' ? Object.assign({}, e, { completed: !ev.some((o) => o.type === 'turnover' && o.team !== e.team && o.t_ms > e.t_ms && o.t_ms <= e.t_ms + 6000) }) : e));
  const nowMs = () => Math.round((ENV.minute || 0) * 60000);
  window.mcIndicesNow = () => { const v = view(), n = nowMs(); return { t_ms: n, control: control(v, n), chaos: chaos(v, n), tempo: tempo(v, n), series: series(v, n), passes: count(v, (e) => e.type === 'pass') }; };
  window.mcIndicesReset = () => { ev.length = 0; };

  // sparkline panel in Analyst mode, under the Match Pulse cards
  const box = document.createElement('div'); box.id = 'mcx-idx'; box.hidden = true;
  box.style.cssText = 'position:fixed;left:calc(14px + env(safe-area-inset-left,0px));bottom:calc(150px + env(safe-area-inset-bottom,0px));width:min(260px,calc(100% - 28px));z-index:30;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 10px;font:11px/1.4 var(--f-mono);color:var(--ink)';
  box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Control, chaos and tempo, last 5 minutes');
  document.body.appendChild(box);
  const spark = (pts, key, max, color) => {
    if (pts.length < 2) return '<span style="color:var(--muted)">too early</span>';
    const W = 120, H = 22, xs = (i) => (i / (pts.length - 1)) * W, ys = (v) => H - clamp(v / max) * (H - 2) - 1;
    return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><polyline fill="none" stroke="' + color + '" stroke-width="1.5" points="' + pts.map((p, i) => xs(i).toFixed(1) + ',' + ys(p[key]).toFixed(1)).join(' ') + '"/></svg>';
  };
  const paint = () => {
    const analyst = typeof FAN !== 'undefined' && FAN.mode === 'analyst';
    box.hidden = !analyst || !S.started; if (box.hidden) return;
    const r = window.mcIndicesNow();
    const row = (label, key, max, color, val, unit) => '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="width:52px">' + label + '</span>' + spark(r.series, key, max, color) + '<b style="width:44px;text-align:right">' + val + unit + '</b></div>';
    box.innerHTML = row('Control', 'control', 100, '#6BD08A', Math.round(r.control), '') + row('Chaos', 'chaos', 100, '#F5B942', Math.round(r.chaos), '') + row('Tempo', 'tempo', 12, '#8CC2FF', r.tempo.toFixed(1), '/m')
      + '<div style="color:var(--muted);margin-top:4px">Rolling 5 min from this match\'s events. Pass completion is inferred (no turnover within 6 s).</div>';
  };
  setInterval(paint, 2000);
  setInterval(() => { if (MCS.framed && S.started) MCS.send({ type: 'indices', data: window.mcIndicesNow() }); }, 5000);
})();
