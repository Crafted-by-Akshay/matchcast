/* Analyst live view: the xG shot map and shot replay (AB#501, the shot panel of crew-analyst.js, moved here).
   Every dot is one shot in AG.run.events, sized by its xG and filled by its outcome. Tap a dot, or a shot in the list (Enter works too), and the
   team's passes in its build-up play back on the pitch, then the shot with its outcome and xG. The build-up is the shooting team's passes back to the
   other side's last pass or turnover, within 20 seconds; the replay draws the last eight of them. Chance bands are this view's own cut-offs, not the engine's.
   The match is the browser simulator, so the panel says Simulated.
   window.MC.analysis.render(kind, params, container) draws the same panel into any container for the Ask lane (kind "shot_map"; other kinds are
   Planned until their view lands). Params are optional: team ("home", "away" or a club name) and window ({from, to} in match minutes).
   Each panel (the live view, and each card) keeps its own selection and replay, so two panels never share one. */
const ALX = (() => {
  const BEFORE_MIN = 1 / 3;   // 20 seconds; event minutes are rounded to 0.1 (MCC.event), so the build-up is read by its place in the log
  const MAX_PASSES = 8;
  const PASS_MS = 380, END_MS = 900;
  const IDLE = 'Tap a shot to replay the passes that led to it.';
  const FATE = { goal: 'Goal', save: 'Saved', miss: 'Missed' };
  const PITCH = '<rect x="0.5" y="0.5" width="104" height="67" fill="none" stroke="var(--line)" stroke-width="0.5"/><line x1="52.5" y1="0.5" x2="52.5" y2="67.5" stroke="var(--line)" stroke-width="0.5"/>'
    + '<circle cx="52.5" cy="34" r="9.15" fill="none" stroke="var(--line)" stroke-width="0.5"/>'
    + '<rect x="0.5" y="13.85" width="16.5" height="40.3" fill="none" stroke="var(--line)" stroke-width="0.5"/><rect x="88" y="13.85" width="16.5" height="40.3" fill="none" stroke="var(--line)" stroke-width="0.5"/>'
    + '<rect x="0.5" y="24.85" width="5.5" height="18.3" fill="none" stroke="var(--line)" stroke-width="0.5"/><rect x="99" y="24.85" width="5.5" height="18.3" fill="none" stroke="var(--line)" stroke-width="0.5"/>';
  // the live view styles its own panels under #al (crew-analyst.js); a card carries the same look under [data-mc-analysis]
  const css = '#al .xg-list,[data-mc-analysis] .xg-list{list-style:none;margin:8px 0 0;padding:0;max-height:16em;overflow-y:auto}'
    + '#al .xg-list li,[data-mc-analysis] .xg-list li{border-top:1px solid var(--line);padding:0}#al .xg-list li:first-child,[data-mc-analysis] .xg-list li:first-child{border-top:0}'
    + '#al .xg-list button,[data-mc-analysis] .xg-list button{width:100%;text-align:left;border:0;border-radius:0;background:transparent;min-height:36px;padding:6px 4px;font:inherit;font-size:12px;color:var(--text,inherit)}'
    + '#al .xg-list button[aria-pressed="true"],[data-mc-analysis] .xg-list button[aria-pressed="true"]{background:var(--bg3);font-weight:700}'
    + '[data-shot-pick]{cursor:pointer}'
    + '[data-replay] [data-pass]{stroke:var(--side);stroke-width:0.8;stroke-linecap:round}'
    + '[data-replay] [data-ball]{fill:#fff;stroke:var(--side);stroke-width:0.4}'
    + '[data-replay] [data-ring]{fill:none;stroke:var(--warn);stroke-width:0.5}'
    + '[data-replay] text{font:600 3px var(--font,system-ui,sans-serif);fill:var(--text)}'
    + '[data-mc-analysis]{font:13px/1.45 var(--font,system-ui,sans-serif);color:var(--text)}'
    + '[data-mc-analysis] section{background:var(--bg2);border:1px solid var(--line);border-radius:var(--r,12px);padding:10px 12px}'
    + '[data-mc-analysis] h3{margin:0 0 6px;font-size:13px}[data-mc-analysis] h3 small{font-weight:400;color:var(--muted);font-size:12px}'
    + '[data-mc-analysis] .m{color:var(--muted);font-size:12px}[data-mc-analysis] .empty{color:var(--muted)}'
    + '[data-mc-analysis] svg{display:block;width:100%;height:auto;max-width:100%}'
    + '[data-mc-analysis] [data-side="0"]{--side:var(--accent)}[data-mc-analysis] [data-side="1"]{--side:var(--hot)}'
    + '[data-mc-analysis] .key{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}[data-mc-analysis] .key span{font-size:12px;padding:2px 9px;border-radius:999px;border:1px solid var(--side);color:var(--text)}'
    + '[data-mc-analysis] [data-fav="1"]{font-weight:700}';

  let styled = false;
  const states = new WeakMap(), cards = new WeakMap();   // per panel: its selection and replay; per card container: its params
  const detached = { sel: -1, selEvents: null, replay: false, token: 0, playKey: '', playT0: 0 };   // only before the live view exists
  // the live view is keyed by #al; a card by its container
  const keyOf = (root) => root || document.getElementById('al');
  function stateFor(root) {
    const k = keyOf(root);
    if (!k) return detached;
    let s = states.get(k);
    if (!s) { s = { sel: -1, selEvents: null, replay: false, token: 0, playKey: '', playT0: 0 }; states.set(k, s); }
    return s;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const f2 = (x) => (+x || 0).toFixed(2);
  const mn = (m) => Math.floor(+m || 0) + "'";
  const num = (v) => v != null && v !== '' && Number.isFinite(+v);
  const sideOf = (r, team) => (team === r.names.hk ? 0 : team === r.names.ak ? 1 : -1);
  const fav = (side, f) => (side === f ? ' data-fav="1"' : '');
  const fateOf = (d) => FATE[d.fate] || 'Missed';
  const band = (xg) => (xg >= 0.2 ? 'high chance' : xg >= 0.05 ? 'medium chance' : 'low chance');
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // the shots to draw: params.team ("home", "away" or a club name) and params.window ({from, to}, match minutes) narrow them; with no params, every shot
  function shots(r, params) {
    const p = params || {}, out = [];
    if (!r) return out;   // before the first match, the live view has no run yet
    const want = p.team == null ? -1 : (p.team === 'home' || p.team === r.names.home) ? 0 : (p.team === 'away' || p.team === r.names.away) ? 1 : 2;
    if (want === 2) return out;
    const w = p.window;
    r.events.forEach((e, i) => {
      if (e.type !== 'shot' || !e.data || !num(e.data.x) || !num(e.data.y)) return;
      const s = sideOf(r, e.team);
      if (s < 0 || (want >= 0 && s !== want)) return;
      if (w && (e.minute < w.from || e.minute > w.to)) return;
      out.push(i);
    });
    return out;
  }
  // every pass of the shooting team's build-up, oldest first: back to the other side's last pass or turnover, within BEFORE_MIN
  function buildUp(r, i) {
    const shot = r.events[i], out = [];
    for (let k = i - 1; k >= 0; k--) {
      const e = r.events[k];
      if (shot.minute - e.minute > BEFORE_MIN) break;
      if (e.team !== shot.team && (e.type === 'pass' || e.type === 'turnover')) break;
      if (e.type === 'pass' && e.team === shot.team && e.data && num(e.data.x0) && num(e.data.y0) && num(e.data.x1) && num(e.data.y1)) out.unshift(e);
    }
    return out;
  }
  // the passes the replay draws: the last MAX_PASSES of the build-up
  const passesOf = (r, i) => buildUp(r, i).slice(-MAX_PASSES);
  function statusFor(r, i) {
    const e = r.events[i], d = e.data, n = buildUp(r, i).length;
    const passes = n === 0 ? 'No passes in this build-up.'
      : n > MAX_PASSES ? 'Showing the last ' + MAX_PASSES + ' of ' + n + ' passes in this build-up.'
      : n + (n === 1 ? ' pass' : ' passes') + ' in this build-up.';
    return 'Replay: ' + mn(e.minute) + ' ' + (e.player || 'shot') + ', ' + fateOf(d) + ', xG ' + f2(d.xg) + ' (' + band(+d.xg || 0) + '). ' + passes;
  }

  // the svg layer: one line per drawn build-up pass (drawn by its dash offset), a ball, and a ring and label at the shot
  function layers(g, r, i) {
    const e = r.events[i], ps = passesOf(r, i), s = sideOf(r, e.team), sx = +e.data.x, sy = +e.data.y;
    const lines = ps.map((p) => '<line data-pass pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1" x1="' + (+p.data.x0).toFixed(1) + '" y1="' + (+p.data.y0).toFixed(1)
      + '" x2="' + (+p.data.x1).toFixed(1) + '" y2="' + (+p.data.y1).toFixed(1) + '"/>').join('');
    const right = sx > 80, lx = right ? sx - 2 : sx + 2, ly = sy < 8 ? sy + 4 : sy - 2;
    const bx = ps.length ? +ps[0].data.x0 : sx, by = ps.length ? +ps[0].data.y0 : sy;
    g.setAttribute('data-side', String(s));
    g.innerHTML = lines + '<circle data-ball r="1.3" cx="' + bx.toFixed(1) + '" cy="' + by.toFixed(1) + '"/>'
      + '<circle data-ring r="3.4" cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" opacity="0"/>'
      + '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="' + (right ? 'end' : 'start') + '" opacity="0">' + esc(fateOf(e.data) + ' · xG ' + f2(e.data.xg)) + '</text>';
  }
  // where the replay is at `el` milliseconds: passes drawn one after another, then the ball at the shot and the label
  function place(g, r, i, el) {
    const e = r.events[i], ps = passesOf(r, i), n = ps.length, tail = n * PASS_MS;
    const k = Math.min(n - 1, Math.floor(el / PASS_MS)), f = Math.min(1, (el - k * PASS_MS) / PASS_MS), done = el >= tail;
    g.querySelectorAll('[data-pass]').forEach((ln, j) => ln.setAttribute('stroke-dashoffset', String(j < k || done ? 0 : j === k ? 1 - f : 1)));
    let bx = +e.data.x, by = +e.data.y;
    if (!done && n) { const p = ps[k]; bx = +p.data.x0 + (+p.data.x1 - +p.data.x0) * f; by = +p.data.y0 + (+p.data.y1 - +p.data.y0) * f; }
    const ball = g.querySelector('[data-ball]');
    ball.setAttribute('cx', bx.toFixed(1)); ball.setAttribute('cy', by.toFixed(1));
    g.querySelectorAll('[data-ring], text').forEach((o) => o.setAttribute('opacity', done ? '1' : '0'));
  }
  function setStatus(g, text) { const sec = g.closest('section'), s = sec && sec.querySelector('[data-replay-status]'); if (s) s.textContent = text; }
  // t0 is when the replay started, so a redraw part-way through (a new batch of events) carries on from the same moment
  function play(g, r, i, s, t0) {
    const tok = s.token, total = passesOf(r, i).length * PASS_MS + END_MS;
    setStatus(g, 'Replaying the build-up.');
    const step = (now) => {
      if (tok !== s.token) return;
      const el = Math.max(0, Math.min(now - t0, total));
      place(g, r, i, el);
      if (el < total) requestAnimationFrame(step);
      else { s.playKey = ''; setStatus(g, statusFor(r, i)); }
    };
    requestAnimationFrame(step);
  }

  function ensureStyle() {
    if (styled) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); styled = true;
  }
  // the panel, a string like the rest of the live view. Its svg replay layer is filled by mounted(), after the view is in the page
  function panel(r, cl, f, params, root) {
    ensureStyle();
    const s = stateFor(root);
    let h = '<section data-panel="shots"><h3>xG shot map <small>Simulated · tap a shot to replay its build-up</small></h3>';
    const idx = shots(r, params);
    if (!idx.length) return h + '<p class="empty">No shots yet.</p></section>';
    const n = [0, 0], xg = [0, 0]; let goals = 0, saves = 0;
    for (const i of idx) { const e = r.events[i], sd = sideOf(r, e.team); n[sd]++; xg[sd] += +e.data.xg || 0; if (e.data.fate === 'goal') goals++; else if (e.data.fate === 'save') saves++; }
    const sum = 'Shot map, simulated match. ' + idx.length + ' shots: ' + cl[0] + ' ' + n[0] + ', ' + cl[1] + ' ' + n[1] + '. Total xG ' + cl[0] + ' ' + f2(xg[0]) + ', ' + cl[1] + ' ' + f2(xg[1]) + '. '
      + goals + (goals === 1 ? ' goal' : ' goals') + '. Dot size is the shot\'s xG; filled is a goal, half filled a save, hollow off target. Tap a shot to replay its build-up.';
    const dots = idx.map((i) => {
      const e = r.events[i], d = e.data, sd = sideOf(r, e.team), op = d.fate === 'goal' ? 1 : d.fate === 'save' ? 0.5 : 0.12;
      return '<circle data-shot-pick="' + i + '" data-fate="' + esc(d.fate || 'miss') + '"' + (d.fate === 'save' ? ' stroke-dasharray="1 0.7"' : '') + ' data-xg="' + f2(d.xg) + '" data-side="' + sd + '"' + fav(sd, f)
        + ' cx="' + Math.max(0, Math.min(105, +d.x)).toFixed(1) + '" cy="' + Math.max(0, Math.min(68, +d.y)).toFixed(1) + '" r="' + (1 + 4.2 * Math.sqrt(Math.max(0, +d.xg || 0))).toFixed(2)
        + '" fill="var(--side)" fill-opacity="' + op + '" stroke="var(--side)" stroke-width="' + (sd === f ? 0.9 : 0.4) + '"><title>' + esc(mn(e.minute) + ' ' + (e.player || '') + ' xG ' + f2(d.xg) + ' ' + (d.fate || '')) + '</title></circle>';
    }).join('');
    const list = idx.map((i) => {
      const e = r.events[i], d = e.data, sd = sideOf(r, e.team);
      return '<li><button type="button" data-shot-pick="' + i + '" data-focus-id="shot-' + i + '" data-side="' + sd + '" aria-pressed="' + (i === s.sel) + '">' + esc(mn(e.minute)) + ' <b>' + esc(e.player || '') + '</b> · ' + esc(cl[sd]) + ' · xG ' + f2(d.xg) + ' · ' + fateOf(d) + ' · ' + band(+d.xg || 0) + '</button></li>';
    }).join('');
    const st = s.sel >= 0 && r.events[s.sel] && r.events[s.sel].type === 'shot' && idx.includes(s.sel) ? statusFor(r, s.sel) : IDLE;
    h += '<div class="key"><span data-side="0"' + fav(0, f) + '>' + esc(cl[0]) + ' · ' + n[0] + ' shots · xG ' + f2(xg[0]) + '</span><span data-side="1"' + fav(1, f) + '>' + esc(cl[1]) + ' · ' + n[1] + ' shots · xG ' + f2(xg[1]) + '</span></div>'
      + '<svg data-map="shots" viewBox="0 0 105 68" role="img" aria-label="' + esc(sum) + '">' + PITCH + '<g data-replay></g>' + dots + '</svg>'
      + '<p class="m" data-replay-status role="status">' + esc(st) + '</p>'
      + '<ol class="xg-list" data-shots>' + list + '</ol>'
      + '<p class="m">Key: ' + goals + ' filled (goal), ' + saves + ' half filled with a dashed edge (save), ' + (idx.length - goals - saves) + ' hollow (off target). Chance bands: under 0.05 xG low, 0.05 to 0.2 medium, 0.2 and over high. Build-up passes are the shooting side\'s passes in the 20 seconds before the shot, from the event log, the last eight drawn.</p>';
    return h + '</section>';
  }

  // replaces a panel's html. Keyboard focus (on an element marked data-focus-id) and the shot list's scroll position survive the redraw
  function setHtml(root, html) {
    const f = document.activeElement, id = f && root.contains(f) && f.getAttribute ? f.getAttribute('data-focus-id') : null;
    const before = root.querySelector('.xg-list'), top = before ? before.scrollTop : 0;
    root.innerHTML = html;
    const after = root.querySelector('.xg-list');
    if (after) after.scrollTop = top;
    if (id !== null) { const b = root.querySelector('[data-focus-id="' + id + '"]'); if (b) b.focus(); }
  }

  // after a panel is in the page: draw the shot's replay layer. A redraw during a replay resumes it; a tap starts it again; otherwise the finished state
  function mounted(root) {
    const g = root && root.querySelector('svg[data-map="shots"] [data-replay]');
    const r = typeof AG !== 'undefined' ? AG.run : null;
    if (!g) return;
    const s = stateFor(root), params = cards.get(keyOf(root)) || {};
    if (r && s.selEvents !== r.events) { s.sel = -1; s.selEvents = null; }
    if (!r || s.sel < 0 || !r.events[s.sel] || r.events[s.sel].type !== 'shot' || !shots(r, params).includes(s.sel)) { s.token++; g.innerHTML = ''; return; }
    if (!s.replay && g.dataset.run === r.key && g.dataset.shot === String(s.sel)) return;   // already showing (or still playing)
    const again = s.replay, now = performance.now(), key = r.key + ':' + s.sel, total = passesOf(r, s.sel).length * PASS_MS + END_MS;
    s.replay = false;
    g.dataset.run = r.key; g.dataset.shot = String(s.sel);
    layers(g, r, s.sel);
    s.token++;
    if (!reduced()) {
      if (again) { s.playKey = key; s.playT0 = now; play(g, r, s.sel, s, now); return; }
      if (s.playKey === key && now - s.playT0 < total) { play(g, r, s.sel, s, s.playT0); return; }
    }
    place(g, r, s.sel, total);
  }

  // a tap or Enter on a shot (dot or list button). The panel redraws and this shot's replay starts
  function pick(i, root) {
    const r = typeof AG !== 'undefined' ? AG.run : null;
    if (!r || !r.events[i]) return;
    const s = stateFor(root);
    s.sel = i; s.selEvents = r.events; s.replay = true;
    if (root) renderInto(root, cards.get(root) || {});
    else if (typeof ALV !== 'undefined') ALV.render();
  }
  // a card (any container): the same panel, drawn with the params it was asked for
  function renderInto(root, params) {
    const r = typeof AG !== 'undefined' ? AG.run : null;
    ensureStyle();
    if (!r) { root.textContent = 'Needs the live match first.'; return; }
    setHtml(root, panel(r, [r.names.home, r.names.away], 0, params, root));
    mounted(root);
  }

  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-shot-pick]') : null;
    if (!t) return;
    const inLive = !!t.closest('#al');
    const root = inLive ? null : t.closest('[data-mc-analysis]');
    if (!inLive && !root) return;
    pick(+t.getAttribute('data-shot-pick'), root);
  });

  // the card kinds: each draws into its container and returns the ids of the events it read
  const kinds = {
    shot_map(container, params, r) {
      renderInto(container, params);
      return r ? shots(r, params).map((i) => r.events[i].id) : [];
    },
  };
  // a view (crew-analyst-momentum.js, ...) adds its kind: fn(container, params, r) draws and returns the citation ids
  function register(kind, fn) { kinds[kind] = fn; }

  // window.MC.analysis: the Ask lane's cards. Unknown kinds are Planned, not drawn
  window.MC = window.MC || {};
  const prevAnalysis = window.MC.analysis || null;   // the layers loaded before this one (maps.js is loaded after it and chains back here)
  window.MC.analysis = {
    render(kind, params, container) {
      if (!container) return { kind, status: 'empty', citations: [] };
      const fn = kinds[kind];
      if (!fn && prevAnalysis) return prevAnalysis.render(kind, params, container);
      if (!fn) { container.textContent = 'Planned: this view is not built yet.'; return { kind, status: 'planned', citations: [] }; }
      const r = typeof AG !== 'undefined' ? AG.run : null;
      container.setAttribute('data-mc-analysis', kind);
      cards.set(container, params || {});
      const ids = fn(container, params || {}, r);
      return { kind, status: !r ? 'empty' : ids.length ? 'ok' : 'empty', citations: ids };
    }
  };

  return { panel, mounted, setHtml, pick, buildUp, shots, register };
})();
