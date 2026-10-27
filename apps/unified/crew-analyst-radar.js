/* Analyst live view: a player radar card (AB#501, view 8).
   Six measures for one player, each shown as its share of the best player in the match on that measure:
   passes, progressive passes (10 m or more toward the opponent's goal, the view-6 rule on attack_x), shots, xG (the expected goals of the
   player's shots), ball wins (the turnovers the player makes), and distance covered in metres.
   The first five come from the events, which name the player. Distance comes from the live position samples (maps.js), one a second.
   Each measure is scaled by the best player on it, so a full radar means the best in the match on every measure. Pick a player from the list.
   The match is the browser simulator, so the panel says Simulated.
   Registered with window.MC.analysis as the kind "radar" (params: player, a name or an index into the match's roster). Its citations are the
   events behind the player's passes, shots and ball wins. */
const ALR = (() => {
  const GAIN = 10;
  const AX = [['Passes', 'pass'], ['Progressive', 'prog'], ['Shots', 'shot'], ['xG', 'xg'], ['Ball wins', 'win'], ['Distance', 'dist']];
  const css = '[data-radar] select{width:100%;max-width:360px;margin:4px 0 8px}'
    + '[data-radar] .rd-wrap{display:grid;grid-template-columns:minmax(180px,260px) 1fr;gap:12px;align-items:start}'
    + '@media (max-width:560px){[data-radar] .rd-wrap{grid-template-columns:1fr}}'
    + '[data-radar] svg{display:block;width:100%;height:auto;max-width:300px;margin:0 auto}'
    + '[data-radar] .rd-grid{fill:none;stroke:var(--line);stroke-width:0.4}'
    + '[data-radar] .rd-axis{stroke:var(--line);stroke-width:0.4}'
    + '[data-radar] .rd-shape{fill:var(--accent);fill-opacity:0.25;stroke:var(--accent);stroke-width:0.8;stroke-linejoin:round}'
    + '[data-radar] .rd-label{font-size:4px;fill:var(--muted);text-anchor:middle}'
    + '[data-radar] table{width:100%;font-size:12px;border-collapse:collapse}[data-radar] td,[data-radar] th{padding:3px 6px;border-bottom:1px solid var(--line);text-align:left}';

  let styled = false;
  const states = new WeakMap();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const num = (v) => v != null && v !== '' && Number.isFinite(+v);
  const rootOf = (t) => t.closest('#al') || t.closest('[data-mc-analysis]');
  function stateFor(root) {
    const k = root || document.getElementById('al');
    if (!k) return { player: null };
    let s = states.get(k);
    if (!s) { s = { player: null }; states.set(k, s); }
    return s;
  }
  function ensureStyle() {
    if (styled) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); styled = true;
  }

  // a pass's gain toward the opponent's goal, in metres, in the direction its side attacks (attack_x); null without the positions or direction
  function gainOf(e) {
    const d = e.data || {};
    if (!num(d.attack_x) || !num(d.x0) || !num(d.x1) || !num(d.y0) || !num(d.y1)) return null;
    // rounded to a micro-metre, as the progressive view does: float noise can turn a true 10 m gain into 9.999999999999998 and miss it
    return Math.round((+d.x1 - +d.x0) * (+d.attack_x === 105 ? 1 : -1) * 1e6) / 1e6;
  }

  // each roster slot's six measures: the first five from the events by player name, distance from the position samples
  function valuesOf(r, m) {
    const byName = new Map();
    const get = (name) => { let s = byName.get(name); if (!s) { s = { pass: 0, prog: 0, shot: 0, xg: 0, win: 0, ids: [] }; byName.set(name, s); } return s; };
    for (const e of r.events) {
      if (!e.player) continue;
      const s = get(e.player);
      if (e.type === 'pass') { s.pass++; s.ids.push(e.id); const g = gainOf(e); if (g != null && g >= GAIN) s.prog++; }
      else if (e.type === 'shot') { s.shot++; s.xg += num(e.data && e.data.xg) ? +e.data.xg : 0; s.ids.push(e.id); }
      else if (e.type === 'turnover') { s.win++; s.ids.push(e.id); }
    }
    const dist = new Array(m.pids.length).fill(0);
    let prev = null;
    for (const fr of m.frames) {
      if (prev) for (let i = 0; i < dist.length; i++) { const a = prev.p[i], b = fr.p[i]; if (a && b) dist[i] += Math.hypot(b[0] - a[0], b[1] - a[1]); }
      prev = fr;
    }
    return m.pids.map((q, i) => {
      const s = byName.get(q.name) || { pass: 0, prog: 0, shot: 0, xg: 0, win: 0, ids: [] };
      return { pass: s.pass, prog: s.prog, shot: s.shot, xg: s.xg, win: s.win, dist: dist[i], ids: s.ids };
    });
  }
  // the best value on each measure across the match, so a share is a player's value over it
  function bestOf(vals) {
    const best = {};
    for (const [, key] of AX) best[key] = vals.reduce((mx, v) => Math.max(mx, v[key]), 0);
    return best;
  }
  const share = (v, best) => (best > 0 ? v / best : 0);
  // the player with the most events behind the first three measures, the default pick
  const busiest = (vals) => vals.reduce((bi, v, i) => ((v.pass + v.shot + v.win) > (vals[bi].pass + vals[bi].shot + vals[bi].win) ? i : bi), 0);
  const fmt = (key, v) => (key === 'xg' ? v.toFixed(2) : key === 'dist' ? Math.round(v) + ' m' : String(v));

  function radarSvg(vals, best, p) {
    const C = 50, R = 34;
    const pt = (k, f) => { const a = -Math.PI / 2 + k * Math.PI / 3; return [C + Math.cos(a) * R * f, C + Math.sin(a) * R * f]; };
    const ring = (f) => AX.map((_, k) => pt(k, f).map((x) => x.toFixed(2)).join(',')).join(' ');
    const grid = [0.25, 0.5, 0.75, 1].map((f) => '<polygon class="rd-grid" points="' + ring(f) + '"/>').join('');
    const axes = AX.map((_, k) => { const [x, y] = pt(k, 1); return '<line class="rd-axis" x1="' + C + '" y1="' + C + '" x2="' + x.toFixed(2) + '" y2="' + y.toFixed(2) + '"/>'; }).join('');
    const pts = AX.map(([, key], k) => pt(k, Math.min(1, share(vals[p][key], best[key]))).map((x) => x.toFixed(2)).join(',')).join(' ');
    const labels = AX.map(([name], k) => { const [x, y] = pt(k, 1.22); return '<text class="rd-label" x="' + x.toFixed(2) + '" y="' + (y + 1).toFixed(2) + '">' + esc(name) + '</text>'; }).join('');
    return '<svg data-map="radar" viewBox="0 0 100 100" role="img" aria-label="' + esc('Radar for the selected player, simulated match') + '">'
      + grid + axes + '<polygon class="rd-shape" data-radar-shape points="' + pts + '"/>' + labels + '</svg>';
  }
  function readout(vals, best, p) {
    const rows = AX.map(([name, key]) => '<tr><th scope="row">' + esc(name) + '</th><td>' + esc(fmt(key, vals[p][key])) + '</td><td>' + Math.round(share(vals[p][key], best[key]) * 100) + '%</td></tr>').join('');
    return '<table><thead><tr><th scope="col">Measure</th><th scope="col">Player</th><th scope="col">Share of best</th></tr></thead><tbody data-radar-rows>' + rows + '</tbody></table>';
  }

  function panel(r, cl, root) {
    ensureStyle();
    const st = stateFor(root);
    const head = '<section data-panel="radar" data-radar><h3>Player radar <small>Simulated · six measures, each against the best player in this match</small></h3>';
    const m = typeof MAPS !== 'undefined' ? MAPS.match() : null;
    if (!r) return head + '<p class="empty">Needs the live match first.</p></section>';
    if (!m) return head + '<p class="empty">Start the match in Watch. Its players appear here as it plays.</p></section>';
    const vals = valuesOf(r, m), best = bestOf(vals);
    const p = st.player == null ? busiest(vals) : Math.min(st.player, vals.length - 1);
    const opts = m.pids.map((q, i) => '<option value="' + i + '"' + (i === p ? ' selected' : '') + '>' + esc(q.num + ' ' + q.name + ' · ' + (i < 11 ? cl[0] : cl[1])) + '</option>').join('');
    return head
      + '<label>Player <select data-focus-id="radar-player" data-radar-player>' + opts + '</select></label>'
      + '<div class="rd-wrap"><div data-radar-svg>' + radarSvg(vals, best, p) + '</div><div data-radar-table>' + readout(vals, best, p) + '</div></div>'
      + '<p class="m">Passes, shots, xG and ball wins come from the events, which name the player. Progressive passes follow view 6: 10 m or more toward the opponent\'s goal. Distance is the metres between the player\'s position samples, one a second. The value next to each measure is the best player\'s on it, so the radar is full only at the best.</p>'
      + '</section>';
  }

  // moves the radar to the player at index p, in the panel already on the page
  function place(root, p) {
    const r = typeof AG !== 'undefined' ? AG.run : null, el = root && root.querySelector('[data-panel="radar"]');
    const m = typeof MAPS !== 'undefined' ? MAPS.match() : null;
    if (!r || !m || !el) return;
    const vals = valuesOf(r, m), best = bestOf(vals), t = Math.min(Math.max(0, p), vals.length - 1);
    const svgBox = el.querySelector('[data-radar-svg]'); if (svgBox) svgBox.innerHTML = radarSvg(vals, best, t);
    const tableBox = el.querySelector('[data-radar-table]'); if (tableBox) tableBox.innerHTML = readout(vals, best, t);
    const sel = el.querySelector('[data-radar-player]'); if (sel) sel.value = String(t);
  }

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.hasAttribute || !t.hasAttribute('data-radar-player')) return;
    const root = rootOf(t);
    if (!root) return;
    stateFor(root).player = +t.value;
    place(root, +t.value);
  });

  // the Ask lane's card: params.player is a name or a roster index; the citations are the events behind the player's passes, shots and ball wins
  ALX.register('radar', (container, params, r) => {
    if (!r) { container.textContent = 'Needs the live match first.'; return []; }
    const m = typeof MAPS !== 'undefined' ? MAPS.match() : null;
    const st = stateFor(container);
    if (m && params && params.player != null) {
      const byName = m.pids.findIndex((q) => q.name === String(params.player));
      st.player = byName >= 0 ? byName : (num(params.player) ? +params.player : st.player);
    }
    ALX.setHtml(container, panel(r, [r.names.home, r.names.away], container));
    if (!m) return [];
    const vals = valuesOf(r, m), p = st.player == null ? busiest(vals) : Math.min(st.player, vals.length - 1);
    return vals[p].ids;
  });

  return { panel, valuesOf };
})();
