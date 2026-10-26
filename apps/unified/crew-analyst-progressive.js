/* Analyst live view: progressive passes on the pitch (AB#501, view 6).
   A pass is progressive when it moves the ball at least 10 m toward the opponent's goal. The gain comes from the events alone:
   the pass's x change, taken in the direction its side attacks (attack_x on the event, 105 or 0). A pass with no attack direction is left out.
   The panel draws each progressive pass up to the minute on the playhead as an arrow on the pitch, coloured by side,
   and counts each side's progressive passes against all its passes with a known attack direction.
   Carries (the ball moving on foot) are not in the event log, so they are not drawn, and the panel says so.
   A scrubber and a Play button move the playhead through the match. The match is the browser simulator, so the panel says Simulated.
   Registered with window.MC.analysis as the kind "progressive" (the Ask lane's card), through ALX.register. */
const ALG = (() => {
  const GAIN = 10, PLAY_MS = 9000;
  const css = '[data-progressive] input[type="range"],[data-mc-analysis] input[type="range"]{width:100%;margin:6px 0 4px}'
    + '[data-progressive] .pg-controls{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}[data-progressive] .pg-controls label{flex:1 1 220px;font-size:12px;color:var(--muted)}'
    + '[data-progressive] svg{display:block;width:100%;height:auto;max-width:100%;margin:4px 0}'
    + '[data-progressive] .pg-pitch{fill:none;stroke:var(--line);stroke-width:0.5}'
    + '[data-progressive] .pg-arrow{fill:none;stroke:var(--side);stroke-width:0.9;stroke-linecap:round}'
    + '[data-progressive] .pg-tip{fill:var(--side)}';
  const PITCH = '<rect class="pg-pitch" x="0.5" y="0.5" width="104" height="67"/><line class="pg-pitch" x1="52.5" y1="0.5" x2="52.5" y2="67.5"/>';

  let styled = false;
  const states = new WeakMap();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const num = (v) => v != null && v !== '' && Number.isFinite(+v);
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

  // the last minute of the match, the top of the scrubber
  const lastMinute = (r) => Math.ceil(r.events.reduce((mx, e) => Math.max(mx, e.minute || 0), 0));

  // every pass with a side, a known attack direction and positions, in event order; gain is metres toward the opponent's goal
  function passesOf(r) {
    const out = [];
    for (const e of r.events) {
      const s = sideOf(r, e.team);
      if (s < 0 || e.type !== 'pass' || !e.data) continue;
      const d = e.data;
      if (!num(d.attack_x) || !num(d.x0) || !num(d.x1) || !num(d.y0) || !num(d.y1)) continue;
      const dir = +d.attack_x === 105 ? 1 : -1;
      // rounded to a micro-metre: float noise can turn a true 10 m gain into 9.999999999999998 and miss it, but a tenth of a metre would count 9.96 as 10
      out.push({ id: e.id, minute: e.minute, side: s, x0: +d.x0, y0: +d.y0, x1: +d.x1, y1: +d.y1, gain: Math.round((+d.x1 - +d.x0) * dir * 1e6) / 1e6 });
    }
    return out;
  }

  // the passes up to minute m: each side's passes, its progressive ones, and those progressive passes to draw
  function counts(r, m) {
    const tot = [0, 0], prog = [0, 0], shown = [];
    for (const p of passesOf(r)) {
      if (p.minute > m) continue;
      tot[p.side]++;
      if (p.gain >= GAIN) { prog[p.side]++; shown.push(p); }
    }
    return { tot, prog, shown };
  }
  const statusText = (cl, c, m) => {
    const part = (k) => cl[k] + ' ' + c.prog[k] + ' progressive of ' + c.tot[k] + ' passes';
    return 'Up to ' + m + "': " + part(0) + '; ' + part(1) + '.';
  };
  const arrows = (shown) => shown.map((p) => '<line class="pg-arrow" data-side="' + p.side + '" x1="' + p.x0.toFixed(1) + '" y1="' + p.y0.toFixed(1)
    + '" x2="' + p.x1.toFixed(1) + '" y2="' + p.y1.toFixed(1) + '"/><circle class="pg-tip" data-side="' + p.side + '" cx="' + p.x1.toFixed(1)
    + '" cy="' + p.y1.toFixed(1) + '" r="0.8"/>').join('');

  function panel(r, cl, root) {
    ensureStyle();
    const st = stateFor(root);
    const head = '<section data-panel="progressive" data-progressive><h3>Progressive passes <small>Simulated · passes that move the ball 10 m or more toward the opponent\'s goal</small></h3>';
    if (!r || !r.events.length) return head + '<p class="empty">No match events yet.</p></section>';
    const top = lastMinute(r), m = st.minute == null ? top : Math.min(st.minute, top);
    const c = counts(r, m), status = statusText(cl, c, m);
    return head
      + '<div class="key"><span data-side="0">' + esc(cl[0]) + '</span><span data-side="1">' + esc(cl[1]) + '</span></div>'
      + '<svg data-map="progressive" viewBox="0 0 105 68" role="img" aria-label="' + esc('Progressive passes, simulated match. ' + status) + '">' + PITCH + '<g data-arrows>' + arrows(c.shown) + '</g></svg>'
      + '<p class="m" data-progressive-status role="status">' + esc(status) + '</p>'
      + '<div class="pg-controls"><button type="button" data-focus-id="progressive-play" data-progressive-play>Play the match</button>'
      + '<label>Minute <input type="range" data-focus-id="progressive-scrub" data-progressive-scrub min="0" max="' + top + '" step="1" value="' + m + '" aria-valuetext="' + esc(status) + '"></label></div>'
      + '<p class="m">A pass counts as progressive when it moves the ball 10 m or more toward the opponent\'s goal. Carries, the ball moving on foot, are not in the event log, so they are not drawn. Passes count only when Watch gives their attack direction and positions.</p>'
      + '</section>';
  }

  // moves the playhead to minute m, in the panel already on the page
  function place(root, m) {
    const r = typeof AG !== 'undefined' ? AG.run : null, el = root && root.querySelector('[data-panel="progressive"]');
    if (!r || !el) return;
    const cl = [r.names.home, r.names.away], top = lastMinute(r), t = Math.min(Math.max(0, Math.floor(m)), top);
    const c = counts(r, t), status = statusText(cl, c, t);
    const g = el.querySelector('[data-arrows]'); if (g) g.innerHTML = arrows(c.shown);
    const svg = el.querySelector('svg[data-map="progressive"]'); if (svg) svg.setAttribute('aria-label', 'Progressive passes, simulated match. ' + status);
    const out = el.querySelector('[data-progressive-status]'); if (out && out.textContent !== status) out.textContent = status;
    const sc = el.querySelector('[data-progressive-scrub]'); if (sc) { sc.value = String(t); sc.setAttribute('aria-valuetext', status); }
  }
  // the match from the start, one minute per step, over PLAY_MS; the scrubber then follows the latest minute again
  function play(root) {
    const r = typeof AG !== 'undefined' ? AG.run : null;
    if (!r) return;
    const st = stateFor(root), top = lastMinute(r), tok = ++st.token;
    if (reduced()) { st.minute = null; place(root, top); return; }
    const t0 = performance.now();
    const step = (now) => {
      if (tok !== st.token) return;
      const m = Math.min(top, Math.floor(((now - t0) / PLAY_MS) * top));
      place(root, m);
      if (m < top) requestAnimationFrame(step);
      else { st.minute = null; place(root, top); }
    };
    place(root, 0);
    requestAnimationFrame(step);
  }

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.hasAttribute || !t.hasAttribute('data-progressive-scrub')) return;
    const root = rootOf(t);
    if (!root) return;
    // a scrub ends a running Play, so the animation does not overwrite the thumb on its next frame
    const st = stateFor(root); st.token++; st.minute = +t.value;
    place(root, +t.value);
  });
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-progressive-play]') : null;
    if (!t) return;
    const root = rootOf(t);
    if (root) play(root);
  });

  // the Ask lane's card: the panel, and the citations are the progressive passes drawn up to the playhead
  ALX.register('progressive', (container, params, r) => {
    if (!r) { container.textContent = 'Needs the live match first.'; return []; }
    ALX.setHtml(container, panel(r, [r.names.home, r.names.away], container));
    const st = stateFor(container), top = lastMinute(r), m = st.minute == null ? top : Math.min(st.minute, top);
    return counts(r, m).shown.map((p) => p.id);
  });

  return { panel, counts, lastMinute };
})();
