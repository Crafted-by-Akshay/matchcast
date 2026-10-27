/* Analyst live view: momentum and pressure over the match (AB#501, view 4).
   Counted from AG.run.events at every whole minute, over the rolling five minutes before it (minute - 5, minute]:
   Momentum: each club's shot xG in that window, and the net of the two, drawn as an area above or below the line.
   Pressure: each club's ball wins, the turnover events the log credits to that club, drawn as two lines.
   A scrubber and a play button move a playhead through the match; the status line says what the window held at that minute.
   The events do not record possession or territory, so neither is shown. The match is the browser simulator, so the panel says Simulated.
   Registered with window.MC.analysis as the kind "momentum" (the Ask lane's card), through ALX.register. */
const ALM = (() => {
  const WIN = 5, PLAY_MS = 12000;
  const css = '[data-momentum] input[type="range"],[data-mc-analysis] input[type="range"]{width:100%;margin:6px 0 4px}'
    + '[data-momentum] .mo-controls{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}[data-momentum] .mo-controls label{flex:1 1 220px;font-size:12px;color:var(--muted)}'
    + '[data-momentum] svg{display:block;width:100%;height:auto;max-width:100%;margin:4px 0}'
    + '[data-momentum] .mo-zero{stroke:var(--line);stroke-width:0.4}[data-momentum] .mo-play{stroke:var(--text);stroke-width:0.5;stroke-dasharray:1 1}'
    + '[data-momentum] .mo-area{fill:var(--accent);fill-opacity:.35;stroke:var(--accent);stroke-width:0.4}'
    + '[data-momentum] .mo-line{fill:none;stroke:var(--side);stroke-width:0.9;stroke-linejoin:round}';

  let styled = false;
  const states = new WeakMap();   // per panel (the live view, or a card's container): the minute the scrubber is on, null for the latest
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const f2 = (x) => (+x || 0).toFixed(2);
  const sideOf = (r, team) => (team === r.names.hk ? 0 : team === r.names.ak ? 1 : -1);
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

  // the per-minute series: index m holds the window (m - WIN, m]; m runs from 0 to the last whole minute of the log
  function series(r) {
    const last = r.events.length ? r.events[r.events.length - 1].minute : 0, M = Math.max(1, Math.ceil(last));
    const xg = [], wins = [];
    for (let m = 0; m <= M; m++) {
      const x = [0, 0], w = [0, 0];
      for (const e of r.events) {
        if (e.minute <= m - WIN || e.minute > m) continue;
        const s = sideOf(r, e.team);
        if (s < 0) continue;
        if (e.type === 'shot' && e.data) x[s] += +e.data.xg || 0;
        else if (e.type === 'turnover') w[s]++;
      }
      xg.push(x); wins.push(w);
    }
    return { M, xg, wins };
  }
  // the events behind a minute's window: its shots and turnovers, cited by id
  function citesAt(r, m) {
    const ids = [];
    for (const e of r.events) if (e.minute > m - WIN && e.minute <= m && (e.type === 'shot' || e.type === 'turnover') && sideOf(r, e.team) >= 0) ids.push(e.id);
    return ids;
  }
  const geo = (s) => {
    const scale = Math.max(0.5, ...s.xg.map((v) => Math.abs(v[0] - v[1])));
    const maxW = Math.max(1, ...s.wins.map((v) => Math.max(v[0], v[1])));
    return {
      X: (t) => 2 + (t / s.M) * 96,
      Yn: (v) => 25 - (v / scale) * 22,
      Yw: (v) => 38 - (v / maxW) * 30,
    };
  };
  function statusText(cl, s, m) {
    const x = s.xg[m], w = s.wins[m];
    return 'At ' + m + "' (last " + WIN + ' minutes): ' + cl[0] + ' ' + f2(x[0]) + ' xG, ' + cl[1] + ' ' + f2(x[1]) + ' xG. Ball wins ' + w[0] + ' to ' + w[1] + '.';
  }

  // the panel, built whole. A scrub or a play step moves the playhead and the status in place (place), so the control keeps its focus and drag
  function panel(r, cl, root) {
    ensureStyle();
    const st = stateFor(root);
    const head = '<section data-panel="momentum" data-momentum><h3>Momentum and pressure <small>Simulated · rolling five minutes, counted from the events</small></h3>';
    if (!r || !r.events.length) return head + '<p class="empty">No match events yet.</p></section>';
    const s = series(r), m = st.minute == null ? s.M : Math.min(st.minute, s.M), g = geo(s);
    const net = s.xg.map((v, t) => g.X(t).toFixed(2) + ',' + g.Yn(v[0] - v[1]).toFixed(2)).join(' ');
    const area = 'M' + g.X(0).toFixed(2) + ',25 L' + net + ' L' + g.X(s.M).toFixed(2) + ',25 Z';
    const lines = [0, 1].map((k) => '<polyline class="mo-line" data-side="' + k + '" points="' + s.wins.map((v, t) => g.X(t).toFixed(2) + ',' + g.Yw(v[k]).toFixed(2)).join(' ') + '"/>').join('');
    const status = statusText(cl, s, m);
    return head
      + '<div class="key"><span data-side="0">' + esc(cl[0]) + '</span><span data-side="1">' + esc(cl[1]) + '</span></div>'
      + '<svg data-map="momentum" viewBox="0 0 100 50" role="img" aria-label="' + esc('Momentum, simulated match. ' + status) + '">'
      + '<line class="mo-zero" x1="0" x2="100" y1="25" y2="25"/><path class="mo-area" d="' + area + '"/>'
      + '<line data-playhead class="mo-play" x1="' + g.X(m).toFixed(2) + '" x2="' + g.X(m).toFixed(2) + '" y1="0" y2="50"/></svg>'
      + '<svg data-map="pressure" viewBox="0 0 100 40" role="img" aria-label="Ball wins per club, rolling five minutes, simulated match">' + lines
      + '<line data-playhead class="mo-play" x1="' + g.X(m).toFixed(2) + '" x2="' + g.X(m).toFixed(2) + '" y1="0" y2="40"/></svg>'
      + '<p class="m" data-momentum-status role="status">' + esc(status) + '</p>'
      + '<div class="mo-controls"><button type="button" data-focus-id="momentum-play" data-momentum-play>Play the match</button>'
      + '<label>Match minute <input type="range" data-focus-id="momentum-scrub" data-momentum-scrub min="0" max="' + s.M + '" step="1" value="' + m + '" aria-valuetext="' + esc(status) + '"></label></div>'
      + '<p class="m">Above the line, the first club leads on shot xG in the window; below it, the second does. Pressure counts ball wins: turnover events, credited to the club the log names. The events do not record possession or territory, so neither is shown.</p>'
      + '</section>';
  }

  // moves the playhead, the scrubber and the status to minute m, in the panel already on the page
  function place(root, m) {
    const r = typeof AG !== 'undefined' ? AG.run : null, panelEl = root && root.querySelector('[data-panel="momentum"]');
    if (!r || !panelEl) return;
    const s = series(r), cl = [r.names.home, r.names.away], g = geo(s), t = Math.min(Math.max(0, m), s.M), status = statusText(cl, s, t);
    panelEl.querySelectorAll('[data-playhead]').forEach((l) => { l.setAttribute('x1', g.X(t).toFixed(2)); l.setAttribute('x2', g.X(t).toFixed(2)); });
    const out = panelEl.querySelector('[data-momentum-status]'); if (out) out.textContent = status;
    const sc = panelEl.querySelector('[data-momentum-scrub]'); if (sc) { sc.value = String(t); sc.setAttribute('aria-valuetext', status); }
  }
  // the match from the start, one minute per step, over PLAY_MS; the scrubber then follows the latest minute again
  function play(root) {
    const r = typeof AG !== 'undefined' ? AG.run : null;
    if (!r) return;
    const st = stateFor(root), s = series(r), tok = ++st.token;
    if (reduced()) { st.minute = null; place(root, s.M); return; }
    const t0 = performance.now();
    const step = (now) => {
      if (tok !== st.token) return;
      const m = Math.min(s.M, Math.floor(((now - t0) / PLAY_MS) * s.M));
      place(root, m);
      if (m < s.M) requestAnimationFrame(step);
      else { st.minute = null; place(root, s.M); }
    };
    place(root, 0);
    requestAnimationFrame(step);
  }

  // a scrub moves the playhead in place (no redraw, so a drag goes on); the play button starts the sweep
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.hasAttribute || !t.hasAttribute('data-momentum-scrub')) return;
    const root = rootOf(t);
    if (!root) return;
    stateFor(root).minute = +t.value;
    place(root, +t.value);
  });
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-momentum-play]') : null;
    if (!t) return;
    const root = rootOf(t);
    if (root) play(root);
  });

  // the Ask lane's card: the panel, and the citations are the shots and ball wins in the window at the minute on the playhead
  ALX.register('momentum', (container, params, r) => {
    if (!r) { container.textContent = 'Needs the live match first.'; return []; }
    ALX.setHtml(container, panel(r, [r.names.home, r.names.away], container));
    const s = series(r), m = stateFor(container).minute;
    return citesAt(r, m == null ? s.M : Math.min(m, s.M));
  });

  return { panel, citesAt, series };
})();
