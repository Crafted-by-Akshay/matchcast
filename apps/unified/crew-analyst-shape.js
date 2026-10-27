/* Analyst live view: defensive line, team shape and compactness over time (AB#501, view 7).
   Built from the shell's live position samples (maps.js: Watch's pitch frames, one per match second), not from events:
   the events carry only the one player each acts with, so they cannot give a shape.
   For each sample and side, the outfield players are the side's eleven less its keeper (the least-advanced player, nearest its own goal):
   defensive line: the mean distance of the outfield players from their own goal, in metres;
   width: the highest minus the lowest y of the outfield players, in metres;
   compactness: the mean distance of the outfield players from their centroid, in metres (smaller is tighter).
   Each minute is the mean of its samples. A playhead moves through the minutes (scrubber and Play): the pitch shows the players at the
   playhead minute's last sample, with each side's defensive line drawn across the pitch.
   The positions are simulated, so the panel says Simulated. Registered with window.MC.analysis as the kind "shape" (the Ask lane's card);
   it cites no events, because positions are not event ids. */
const ALS = (() => {
  const PLAY_MS = 12000;
  const css = '[data-shape] input[type="range"],[data-mc-analysis] input[type="range"]{width:100%;margin:6px 0 4px}'
    + '[data-shape] .sh-controls{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}[data-shape] .sh-controls label{flex:1 1 220px;font-size:12px;color:var(--muted)}'
    + '[data-shape] svg{display:block;width:100%;height:auto;max-width:100%;margin:4px 0}'
    + '[data-shape] .sh-pitch{fill:none;stroke:var(--line);stroke-width:0.5}'
    + '[data-shape] .sh-line{fill:none;stroke:var(--side);stroke-width:0.8;stroke-dasharray:2 1.5}'
    + '[data-shape] .sh-dot{fill:var(--side)}'
    + '[data-shape] .sh-series{fill:none;stroke:var(--side);stroke-width:1;stroke-linejoin:round}'
    + '[data-shape] .sh-play{stroke:var(--text);stroke-width:0.5;stroke-dasharray:1 1}';
  const PITCH = '<rect class="sh-pitch" x="0.5" y="0.5" width="104" height="67"/><line class="sh-pitch" x1="52.5" y1="0.5" x2="52.5" y2="67.5"/>';

  let styled = false;
  const states = new WeakMap();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const rootOf = (t) => t.closest('#al') || t.closest('[data-mc-analysis]');
  function stateFor(root) {
    const k = root || document.getElementById('al');
    if (!k) return { minute: null, token: 0 };
    let s = states.get(k);
    if (!s) { s = { minute: null, token: 0 }; states.set(k, s); }
    return s;
  }
  function ensureStyle() {
    if (styled) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); styled = true;
  }

  // a player's position in the side's attack direction (the goal it attacks is at x 105), as maps.js has it
  const atkOf = (fr, i) => {
    const q = fr.p[i]; if (!q) return null;
    const flip = i < 11 ? fr.f === 1 : fr.f === 0;
    return flip ? [105 - q[0], 68 - q[1]] : q;
  };
  // a side's line, width and compactness in one sample; side 0 is the first eleven, side 1 the second
  function shapeOf(fr, s) {
    const pts = [];
    for (let i = s === 0 ? 0 : 11; i < (s === 0 ? 11 : 22); i++) { const q = atkOf(fr, i); if (q) pts.push(q); }
    if (pts.length < 2) return null;
    pts.sort((a, b) => a[0] - b[0]);
    const out = pts.slice(1);   // the least-advanced player is the keeper
    const n = out.length;
    const line = out.reduce((t, q) => t + q[0], 0) / n;
    const ys = out.map((q) => q[1]);
    const width = Math.max(...ys) - Math.min(...ys);
    const cx = out.reduce((t, q) => t + q[0], 0) / n, cy = ys.reduce((t, y) => t + y, 0) / n;
    const comp = out.reduce((t, q) => t + Math.hypot(q[0] - cx, q[1] - cy), 0) / n;
    return { line, width, comp };
  }

  // the match by minute: each side's mean line, width and compactness over the minute's samples; last[m] is the sample the pitch draws
  function series(m) {
    const T = m.frames.length ? Math.floor(m.frames[m.frames.length - 1].t / 60) : 0;
    const acc = [0, 1].map(() => Array.from({ length: T + 1 }, () => ({ n: 0, line: 0, width: 0, comp: 0 })));
    const last = Array.from({ length: T + 1 }, () => -1);
    m.frames.forEach((fr, idx) => {
      const mi = Math.floor((fr.t || 0) / 60);
      if (mi > T) return;
      last[mi] = idx;
      for (const s of [0, 1]) {
        const v = shapeOf(fr, s); if (!v) continue;
        const a = acc[s][mi]; a.n++; a.line += v.line; a.width += v.width; a.comp += v.comp;
      }
    });
    const mins = acc.map((row) => row.map((a) => (a.n ? { line: a.line / a.n, width: a.width / a.n, comp: a.comp / a.n } : null)));
    return { T, mins, last, brk: m.brk };   // brk: the minute the second half's clock starts at 45:00 (maps.js)
  }
  const round = (v) => (v == null ? '–' : Math.round(v) + ' m');
  // a minute as a broadcaster says it: the first half 1' to 45', added time 45+k'; the second half from its kick-off 2nd half 45'
  const minuteName = (t, brk) => {
    if (brk == null || t < brk) return t < 45 ? (t + 1) + "'" : '45+' + (t - 44) + "'";
    const c = 45 + (t - brk);
    return c < 90 ? '2nd half ' + c + "'" : '2nd half 90+' + (c - 89) + "'";
  };
  const statusText = (cl, sr, t) => {
    const part = (k) => { const v = sr.mins[k][t]; return cl[k] + ' line ' + round(v && v.line) + ', width ' + round(v && v.width) + ', compactness ' + round(v && v.comp); };
    return minuteName(t, sr.brk) + ': ' + part(0) + '; ' + part(1) + '.';
  };
  // the defensive line across the pitch, in real coordinates: side 0 attacks toward 105 in the first half, side 1 in the second
  const lineX = (s, fr, L) => ((s === 0 ? fr.f === 1 : fr.f === 0) ? 105 - L : L);

  function pitchSvg(m, sr, t, sideCl) {
    const fr = sr.last[t] >= 0 ? m.frames[sr.last[t]] : null;
    if (!fr) return '';
    const dots = fr.p.map((q, i) => (q ? '<circle class="sh-dot" data-side="' + (i < 11 ? 0 : 1) + '" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="1.4"/>' : '')).join('');
    const lines = [0, 1].map((s) => {
      const v = sr.mins[s][t]; if (!v) return '';
      const x = lineX(s, fr, v.line).toFixed(1);
      return '<line class="sh-line" data-side="' + s + '" x1="' + x + '" y1="0" x2="' + x + '" y2="68"/>';
    }).join('');
    return '<svg data-map="shape" viewBox="0 0 105 68" role="img" aria-label="' + esc('Players and defensive lines at ' + minuteName(t, sr.brk) + ', simulated match. ' + statusText(sideCl, sr, t)) + '">' + PITCH + lines + '<g data-dots>' + dots + '</g></svg>';
  }
  // one small chart over the minutes for a field of the series
  function chart(sr, field, t, label) {
    const top = Math.max(10, ...[0, 1].flatMap((s) => sr.mins[s].map((v) => (v ? v[field] : 0))));
    const X = (i) => 4 + (sr.T > 0 ? (i / sr.T) * 92 : 46), Y = (v) => 36 - (Math.min(v, top) / top) * 30;
    const lines = [0, 1].map((s) => {
      const pts = [];
      for (let i = 0; i <= sr.T; i++) { const v = sr.mins[s][i]; if (v) pts.push(X(i).toFixed(2) + ',' + Y(v[field]).toFixed(2)); }
      return '<polyline class="sh-series" data-side="' + s + '" points="' + pts.join(' ') + '"/>';
    }).join('');
    return '<figure><figcaption>' + esc(label) + '</figcaption><svg viewBox="0 0 100 40" role="img" aria-label="' + esc(label + ' over the match, simulated') + '">' + lines
      + '<line data-playhead class="sh-play" x1="' + X(t).toFixed(2) + '" x2="' + X(t).toFixed(2) + '" y1="0" y2="40"/></svg></figure>';
  }

  function panel(r, cl, root) {
    ensureStyle();
    const st = stateFor(root);
    const head = '<section data-panel="shape" data-shape><h3>Defensive line and shape <small>Simulated · from the live positions, one sample a second, averaged by minute</small></h3>';
    const m = typeof MAPS !== 'undefined' ? MAPS.match() : null;
    if (!r || !m || !m.frames.length) return head + '<p class="empty">Start the match in Watch. Its positions appear here as it plays.</p></section>';
    const sr = series(m), t = st.minute == null ? sr.T : Math.min(st.minute, sr.T), status = statusText(cl, sr, t);
    return head
      + '<div class="key"><span data-side="0">' + esc(cl[0]) + '</span><span data-side="1">' + esc(cl[1]) + '</span></div>'
      + '<div data-pitch>' + pitchSvg(m, sr, t, cl) + '</div>'
      + '<p class="m" data-shape-status role="status">' + esc(status) + '</p>'
      + '<div data-charts>' + chart(sr, 'line', t, 'Defensive line height') + chart(sr, 'comp', t, 'Compactness') + '</div>'
      + '<div class="sh-controls"><button type="button" data-focus-id="shape-play" data-shape-play>Play the match</button>'
      + '<label>Minute <input type="range" data-focus-id="shape-scrub" data-shape-scrub min="0" max="' + sr.T + '" step="1" value="' + t + '" aria-valuetext="' + esc(status) + '"></label></div>'
      + '<p class="m">Each side\'s outfield players, its keeper left out. The line is the mean distance of those players from their own goal. Width is the spread across the pitch, and compactness the mean distance from their centre. Lower compactness is tighter. The events do not record positions, so these come from the live samples only.</p>'
      + '</section>';
  }

  // moves the playhead to minute t, in the panel already on the page
  function place(root, t0) {
    const r = typeof AG !== 'undefined' ? AG.run : null, el = root && root.querySelector('[data-panel="shape"]');
    const m = typeof MAPS !== 'undefined' ? MAPS.match() : null;
    if (!r || !m || !el) return;
    const cl = [r.names.home, r.names.away], sr = series(m), t = Math.min(Math.max(0, Math.floor(t0)), sr.T), status = statusText(cl, sr, t);
    const pitch = el.querySelector('[data-pitch]'); if (pitch) pitch.innerHTML = pitchSvg(m, sr, t, cl);
    const charts = el.querySelector('[data-charts]'); if (charts) charts.innerHTML = chart(sr, 'line', t, 'Defensive line height') + chart(sr, 'comp', t, 'Compactness');
    const out = el.querySelector('[data-shape-status]'); if (out && out.textContent !== status) out.textContent = status;
    const sc = el.querySelector('[data-shape-scrub]'); if (sc) { sc.value = String(t); sc.setAttribute('aria-valuetext', status); }
  }
  // the match from minute 0, one minute per step over PLAY_MS; the scrubber then follows the latest minute again
  function play(root) {
    const r = typeof AG !== 'undefined' ? AG.run : null, m = typeof MAPS !== 'undefined' ? MAPS.match() : null;
    if (!r || !m) return;
    const st = stateFor(root), T = series(m).T, tok = ++st.token;
    if (reduced()) { st.minute = null; place(root, T); return; }
    const t0 = performance.now();
    const step = (now) => {
      if (tok !== st.token) return;
      const t = Math.min(T, Math.floor(((now - t0) / PLAY_MS) * T));
      place(root, t);
      if (t < T) requestAnimationFrame(step);
      else { st.minute = null; place(root, T); }
    };
    place(root, 0);
    requestAnimationFrame(step);
  }

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.hasAttribute || !t.hasAttribute('data-shape-scrub')) return;
    const root = rootOf(t);
    if (!root) return;
    // a scrub ends a running Play, so the animation does not overwrite the thumb on its next frame
    const st = stateFor(root); st.token++; st.minute = +t.value;
    place(root, +t.value);
  });
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-shape-play]') : null;
    if (!t) return;
    const root = rootOf(t);
    if (root) play(root);
  });

  // the Ask lane's card: the panel, with no citations (positions are not event ids)
  ALX.register('shape', (container, params, r) => {
    if (!r) { container.textContent = 'Needs the live match first.'; return []; }
    ALX.setHtml(container, panel(r, [r.names.home, r.names.away], container));
    return { status: typeof MAPS !== 'undefined' && MAPS.match() ? 'ok' : 'empty', ids: [] };
  });

  return { panel, series };
})();
