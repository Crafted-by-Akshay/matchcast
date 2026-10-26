/* Analyst live view: PPDA per club over time (AB#501, view 5).
   PPDA is the passes a club allows per defensive action in its pressing zone: the 60% of the pitch nearest the opponent's goal, which is
   the part of the pitch from 42 m out from the club's own goal. Counted in five-minute blocks from AG.run.events:
   passes allowed = the opponent's passes that start in the zone;
   defensive actions = the club's ball wins (turnover events) that happen in the zone.
   The events carry no tackle or interception positions, so defensive actions are ball wins only, and the panel says so.
   A club's zone follows its attack direction (attack_x, from Watch's events). A block with no ball win in the zone has no PPDA.
   Lower is more pressing. A scrubber and a Play button move through the blocks. The match is the browser simulator, so the panel says Simulated.
   Registered with window.MC.analysis as the kind "ppda". */
const ALP = (() => {
  const BLOCK = 5, ZONE = 42, PLAY_MS = 9000;
  const css = '[data-ppda] input[type="range"],[data-mc-analysis] input[type="range"]{width:100%;margin:6px 0 4px}'
    + '[data-ppda] .pp-controls{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}[data-ppda] .pp-controls label{flex:1 1 220px;font-size:12px;color:var(--muted)}'
    + '[data-ppda] svg{display:block;width:100%;height:auto;max-width:100%;margin:4px 0}'
    + '[data-ppda] .pp-line{fill:none;stroke:var(--side);stroke-width:1;stroke-linejoin:round}'
    + '[data-ppda] .pp-dot{fill:var(--side)}'
    + '[data-ppda] .pp-play{stroke:var(--text);stroke-width:0.5;stroke-dasharray:1 1}';

  let styled = false;
  const states = new WeakMap();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const f2 = (x) => (+x || 0).toFixed(2);
  const num = (v) => v != null && v !== '' && Number.isFinite(+v);
  const sideOf = (r, team) => (team === r.names.hk ? 0 : team === r.names.ak ? 1 : -1);
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const rootOf = (t) => t.closest('#al') || t.closest('[data-mc-analysis]');
  function stateFor(root) {
    const k = root || document.getElementById('al');
    if (!k) return { block: null, token: 0 };
    let s = states.get(k);
    if (!s) { s = { block: null, token: 0 }; states.set(k, s); }
    return s;
  }
  function ensureStyle() {
    if (styled) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); styled = true;
  }

  // a club's attack direction at minute m: its latest event at or before m, else its earliest (a club's first pass can come before its first event)
  function attackAt(list, m) {
    if (!list || !list.length) return null;
    let a = list[0].attack;
    for (const p of list) { if (p.minute <= m) a = p.attack; else break; }
    return a;
  }
  // is x inside the club's pressing zone, given its attack direction (105: own goal at 0, so x from 42 up; 0: own goal at 105, so x up to 63)
  const inZone = (attack, x) => (attack === 105 ? x >= ZONE : attack === 0 ? x <= 105 - ZONE : false);

  // per block: passes allowed by each club, and ball wins each club has in its zone. Block b covers minutes (5(b-1), 5b], b from 1
  function series(r) {
    const last = r.events.length ? r.events[r.events.length - 1].minute : 0, B = Math.max(1, Math.ceil(last / BLOCK));
    const dirs = [[], []];
    for (const e of r.events) {
      const s = sideOf(r, e.team);
      if (s >= 0 && e.data && num(e.data.attack_x)) dirs[s].push({ minute: e.minute, attack: +e.data.attack_x });
    }
    const allowed = [], wins = [], ids = [];
    for (let b = 0; b < B; b++) { allowed.push([0, 0]); wins.push([0, 0]); ids.push([]); }
    for (const e of r.events) {
      const s = sideOf(r, e.team);
      if (s < 0) continue;
      const b = Math.min(B - 1, Math.max(0, Math.ceil(e.minute / BLOCK) - 1));
      if (e.type === 'pass' && e.data && num(e.data.x0)) {
        const opp = 1 - s, a = attackAt(dirs[opp], e.minute);   // the opponent presses from its own zone, so its direction decides the zone
        if (a != null && inZone(a, +e.data.x0)) { allowed[b][opp]++; ids[b].push(e.id); }
      } else if (e.type === 'turnover' && e.data && num(e.data.x)) {
        const a = attackAt(dirs[s], e.minute);
        if (a != null && inZone(a, +e.data.x)) { wins[b][s]++; ids[b].push(e.id); }
      }
    }
    return { B, allowed, wins, ids };
  }
  const ppda = (s, b, k) => (s.wins[b][k] > 0 ? s.allowed[b][k] / s.wins[b][k] : null);
  const label = (b) => (b * BLOCK) - BLOCK + "–" + (b * BLOCK) + "'";
  function statusText(cl, s, b) {
    const v = [0, 1].map((k) => ppda(s, b, k));
    const part = (k) => cl[k] + ' ' + (v[k] == null ? '–' : f2(v[k])) + ' (' + s.allowed[b][k] + ' passes allowed, ' + s.wins[b][k] + ' ball wins in its zone)';
    return 'Minutes ' + label(b + 1) + ': ' + part(0) + '; ' + part(1) + '.';
  }
  const geo = (s) => {
    const top = Math.max(4, ...[0, 1].flatMap((k) => s.wins.map((_, b) => ppda(s, b, k) || 0)));
    return {
      X: (b) => 4 + (s.B > 1 ? (b / (s.B - 1)) * 92 : 46),
      Y: (v) => 36 - (Math.min(v, top) / top) * 30,
    };
  };

  function panel(r, cl, root) {
    ensureStyle();
    const st = stateFor(root);
    const head = '<section data-panel="ppda" data-ppda><h3>PPDA by club <small>Simulated · passes allowed per ball win in the pressing zone, five-minute blocks</small></h3>';
    if (!r || !r.events.length) return head + '<p class="empty">No match events yet.</p></section>';
    const s = series(r), b = st.block == null ? s.B - 1 : Math.min(st.block, s.B - 1), g = geo(s);
    const lines = [0, 1].map((k) => {
      const pts = [];
      for (let i = 0; i < s.B; i++) { const v = ppda(s, i, k); if (v != null) pts.push(g.X(i).toFixed(2) + ',' + g.Y(v).toFixed(2)); }
      return '<polyline class="pp-line" data-side="' + k + '" points="' + pts.join(' ') + '"/>'
        + pts.map((p) => '<circle class="pp-dot" data-side="' + k + '" cx="' + p.split(',')[0] + '" cy="' + p.split(',')[1] + '" r="0.9"/>').join('');
    }).join('');
    const status = statusText(cl, s, b);
    return head
      + '<div class="key"><span data-side="0">' + esc(cl[0]) + '</span><span data-side="1">' + esc(cl[1]) + '</span></div>'
      + '<svg data-map="ppda" viewBox="0 0 100 40" role="img" aria-label="' + esc('PPDA by club, simulated match. ' + status) + '">' + lines
      + '<line data-playhead class="pp-play" x1="' + g.X(b).toFixed(2) + '" x2="' + g.X(b).toFixed(2) + '" y1="0" y2="40"/></svg>'
      + '<p class="m" data-ppda-status role="status">' + esc(status) + '</p>'
      + '<div class="pp-controls"><button type="button" data-focus-id="ppda-play" data-ppda-play>Play the match</button>'
      + '<label>Block <input type="range" data-focus-id="ppda-scrub" data-ppda-scrub min="0" max="' + (s.B - 1) + '" step="1" value="' + b + '" aria-valuetext="' + esc(status) + '"></label></div>'
      + '<p class="m">A club\'s PPDA is the other side\'s passes that start in its zone, divided by its own ball wins in that zone. Ball wins are the only defensive actions here: the events carry no tackle or interception positions. Lower is more pressing.</p>'
      + '</section>';
  }

  // moves the playhead, the scrubber and the status to block b, in the panel already on the page
  function place(root, b) {
    const r = typeof AG !== 'undefined' ? AG.run : null, el = root && root.querySelector('[data-panel="ppda"]');
    if (!r || !el) return;
    const s = series(r), cl = [r.names.home, r.names.away], g = geo(s), t = Math.min(Math.max(0, b), s.B - 1), status = statusText(cl, s, t);
    el.querySelectorAll('[data-playhead]').forEach((l) => { l.setAttribute('x1', g.X(t).toFixed(2)); l.setAttribute('x2', g.X(t).toFixed(2)); });
    const svg = el.querySelector('svg[data-map="ppda"]'); if (svg) svg.setAttribute('aria-label', 'PPDA by club, simulated match. ' + status);
    const out = el.querySelector('[data-ppda-status]'); if (out) out.textContent = status;
    const sc = el.querySelector('[data-ppda-scrub]'); if (sc) { sc.value = String(t); sc.setAttribute('aria-valuetext', status); }
  }
  // the blocks from the start, one per step, over PLAY_MS; the scrubber then follows the latest block again
  function play(root) {
    const r = typeof AG !== 'undefined' ? AG.run : null;
    if (!r) return;
    const st = stateFor(root), s = series(r), tok = ++st.token;
    if (reduced()) { st.block = null; place(root, s.B - 1); return; }
    const t0 = performance.now();
    const step = (now) => {
      if (tok !== st.token) return;
      const b = Math.min(s.B - 1, Math.floor(((now - t0) / PLAY_MS) * s.B));
      place(root, b);
      if (b < s.B - 1) requestAnimationFrame(step);
      else { st.block = null; place(root, s.B - 1); }
    };
    place(root, 0);
    requestAnimationFrame(step);
  }

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.hasAttribute || !t.hasAttribute('data-ppda-scrub')) return;
    const root = rootOf(t);
    if (!root) return;
    stateFor(root).block = +t.value;
    place(root, +t.value);
  });
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-ppda-play]') : null;
    if (!t) return;
    const root = rootOf(t);
    if (root) play(root);
  });

  // the Ask lane's card: the panel, and the citations are the passes and ball wins counted in the block on the playhead
  ALX.register('ppda', (container, params, r) => {
    if (!r) { container.textContent = 'Needs the live match first.'; return []; }
    ALX.setHtml(container, panel(r, [r.names.home, r.names.away], container));
    const s = series(r), b = stateFor(container).block;
    return s.ids[b == null ? s.B - 1 : Math.min(b, s.B - 1)];
  });

  return { panel, series, label };
})();
