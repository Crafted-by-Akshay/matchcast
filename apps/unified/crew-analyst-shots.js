/* Analyst live view: the xG shot map and shot replay (AB#501, the shot panel of crew-analyst.js, moved here).
   Every dot is one shot in AG.run.events, sized by its xG and filled by its outcome. Tap a dot, or a shot in the list (Enter works too), and the
   team's passes in its build-up play back on the pitch, then the shot with its outcome and xG. The build-up is the run of passes by the shooting
   team back to the other side's last pass or turnover, within 20 seconds. Chance bands are this view's own cut-offs, not the engine's.
   The match is the browser simulator, so the panel says Simulated. */
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
  const css = '#al .xg-list{list-style:none;margin:8px 0 0;padding:0;max-height:16em;overflow-y:auto}'
    + '#al .xg-list li{border-top:1px solid var(--line);padding:0}#al .xg-list li:first-child{border-top:0}'
    + '#al .xg-list button{width:100%;text-align:left;border:0;border-radius:0;background:transparent;min-height:36px;padding:6px 4px}'
    + '#al .xg-list button[aria-pressed="true"]{background:var(--bg3);font-weight:700}'
    + '#al [data-shot-pick]{cursor:pointer}'
    + '#al [data-replay] [data-pass]{stroke:var(--side);stroke-width:0.8;stroke-linecap:round}'
    + '#al [data-replay] [data-ball]{fill:#fff;stroke:var(--side);stroke-width:0.4}'
    + '#al [data-replay] [data-ring]{fill:none;stroke:var(--warn);stroke-width:0.5}'
    + '#al [data-replay] text{font:600 3px var(--font,system-ui,sans-serif);fill:var(--text)}';

  let sel = -1, selRun = null, replay = false, token = 0, styled = false;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const f2 = (x) => (+x || 0).toFixed(2);
  const mn = (m) => Math.floor(+m || 0) + "'";
  const num = (v) => v != null && v !== '' && Number.isFinite(+v);
  const sideOf = (r, team) => (team === r.names.hk ? 0 : team === r.names.ak ? 1 : -1);
  const fav = (side, f) => (side === f ? ' data-fav="1"' : '');
  const fateOf = (d) => FATE[d.fate] || 'Missed';
  const band = (xg) => (xg >= 0.2 ? 'high chance' : xg >= 0.05 ? 'medium chance' : 'low chance');
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function shots(r) {
    const out = [];
    if (r) r.events.forEach((e, i) => { if (e.type === 'shot' && e.data && num(e.data.x) && num(e.data.y) && sideOf(r, e.team) >= 0) out.push(i); });
    return out;
  }
  // the shooting team's passes since the other side last passed or lost the ball (the same possession), at most MAX_PASSES, oldest first
  function buildUp(r, i) {
    const shot = r.events[i], out = [];
    for (let k = i - 1; k >= 0 && out.length < MAX_PASSES; k--) {
      const e = r.events[k];
      if (shot.minute - e.minute > BEFORE_MIN) break;
      if (e.team !== shot.team && (e.type === 'pass' || e.type === 'turnover')) break;
      if (e.type === 'pass' && e.team === shot.team && e.data && num(e.data.x0) && num(e.data.y0) && num(e.data.x1) && num(e.data.y1)) out.unshift(e);
    }
    return out;
  }
  function statusFor(r, i) {
    const e = r.events[i], d = e.data, n = buildUp(r, i).length;
    return 'Replay: ' + mn(e.minute) + ' ' + (e.player || 'shot') + ', ' + fateOf(d) + ', xG ' + f2(d.xg) + ' (' + band(+d.xg || 0) + '). '
      + (n ? n + (n === 1 ? ' pass' : ' passes') + ' in this build-up.' : 'No passes in this build-up.');
  }

  // the svg layer: one line per build-up pass (drawn by its dash offset), a ball, and a ring and label at the shot
  function layers(g, r, i) {
    const e = r.events[i], ps = buildUp(r, i), s = sideOf(r, e.team), sx = +e.data.x, sy = +e.data.y;
    const lines = ps.map((p) => '<line data-pass pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1" x1="' + (+p.data.x0).toFixed(1) + '" y1="' + (+p.data.y0).toFixed(1)
      + '" x2="' + (+p.data.x1).toFixed(1) + '" y2="' + (+p.data.y1).toFixed(1) + '"/>').join('');
    const right = sx > 80, lx = right ? sx - 2 : sx + 2, ly = sy < 8 ? sy + 4 : sy - 2;
    g.setAttribute('data-side', String(s));
    g.innerHTML = lines + '<circle data-ball r="1.3" cx="' + (ps.length ? (+ps[0].data.x0).toFixed(1) : sx.toFixed(1)) + '" cy="' + (ps.length ? (+ps[0].data.y0).toFixed(1) : sy.toFixed(1)) + '"/>'
      + '<circle data-ring r="3.4" cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" opacity="0"/>'
      + '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="' + (right ? 'end' : 'start') + '" opacity="0">' + esc(fateOf(e.data) + ' · xG ' + f2(e.data.xg)) + '</text>';
  }
  // where the replay is at `el` milliseconds: passes drawn one after another, then the ball at the shot and the label
  function place(g, r, i, el) {
    const e = r.events[i], ps = buildUp(r, i), n = ps.length, tail = n * PASS_MS;
    const k = Math.min(n - 1, Math.floor(el / PASS_MS)), f = Math.min(1, (el - k * PASS_MS) / PASS_MS), done = el >= tail;
    g.querySelectorAll('[data-pass]').forEach((ln, j) => ln.setAttribute('stroke-dashoffset', String(j < k || done ? 0 : j === k ? 1 - f : 1)));
    let bx = +e.data.x, by = +e.data.y;
    if (!done && n) { const p = ps[k]; bx = +p.data.x0 + (+p.data.x1 - +p.data.x0) * f; by = +p.data.y0 + (+p.data.y1 - +p.data.y0) * f; }
    const ball = g.querySelector('[data-ball]');
    ball.setAttribute('cx', bx.toFixed(1)); ball.setAttribute('cy', by.toFixed(1));
    g.querySelectorAll('[data-ring], text').forEach((o) => o.setAttribute('opacity', done ? '1' : '0'));
  }
  function setStatus(text) { const s = document.querySelector('#al [data-replay-status]'); if (s) s.textContent = text; }
  function cancel() { token++; }
  function play(g, r, i) {
    const tok = token, total = buildUp(r, i).length * PASS_MS + END_MS, t0 = performance.now();
    setStatus('Replaying the build-up.');
    const step = (now) => {
      if (tok !== token) return;
      const el = Math.min(now - t0, total);
      place(g, r, i, el);
      if (el < total) requestAnimationFrame(step); else setStatus(statusFor(r, i));
    };
    requestAnimationFrame(step);
  }

  // the panel, a string like the rest of the live view. Its svg replay layer is filled by mounted(), after the view is in the page
  function panel(r, cl, f) {
    if (!styled) { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); styled = true; }
    let h = '<section data-panel="shots"><h3>xG shot map <small>Simulated · tap a shot to replay its build-up</small></h3>';
    const idx = shots(r);
    if (!idx.length) return h + '<p class="empty">No shots yet.</p></section>';
    const n = [0, 0], xg = [0, 0]; let goals = 0, saves = 0;
    for (const i of idx) { const e = r.events[i], s = sideOf(r, e.team); n[s]++; xg[s] += +e.data.xg || 0; if (e.data.fate === 'goal') goals++; else if (e.data.fate === 'save') saves++; }
    const sum = 'Shot map, simulated match. ' + idx.length + ' shots: ' + cl[0] + ' ' + n[0] + ', ' + cl[1] + ' ' + n[1] + '. Total xG ' + cl[0] + ' ' + f2(xg[0]) + ', ' + cl[1] + ' ' + f2(xg[1]) + '. '
      + goals + (goals === 1 ? ' goal' : ' goals') + '. Dot size is the shot\'s xG; filled is a goal, half filled a save, hollow off target. Tap a shot to replay its build-up.';
    const dots = idx.map((i) => {
      const e = r.events[i], d = e.data, s = sideOf(r, e.team), op = d.fate === 'goal' ? 1 : d.fate === 'save' ? 0.5 : 0.12;
      return '<circle data-shot-pick="' + i + '" data-fate="' + esc(d.fate || 'miss') + '"' + (d.fate === 'save' ? ' stroke-dasharray="1 0.7"' : '') + ' data-xg="' + f2(d.xg) + '" data-side="' + s + '"' + fav(s, f)
        + ' cx="' + Math.max(0, Math.min(105, +d.x)).toFixed(1) + '" cy="' + Math.max(0, Math.min(68, +d.y)).toFixed(1) + '" r="' + (1 + 4.2 * Math.sqrt(Math.max(0, +d.xg || 0))).toFixed(2)
        + '" fill="var(--side)" fill-opacity="' + op + '" stroke="var(--side)" stroke-width="' + (s === f ? 0.9 : 0.4) + '"><title>' + esc(mn(e.minute) + ' ' + (e.player || '') + ' xG ' + f2(d.xg) + ' ' + (d.fate || '')) + '</title></circle>';
    }).join('');
    const list = idx.map((i) => {
      const e = r.events[i], d = e.data, s = sideOf(r, e.team);
      return '<li><button type="button" data-shot-pick="' + i + '" data-side="' + s + '" aria-pressed="' + (i === sel) + '">' + esc(mn(e.minute)) + ' <b>' + esc(e.player || '') + '</b> · ' + esc(cl[s]) + ' · xG ' + f2(d.xg) + ' · ' + fateOf(d) + ' · ' + band(+d.xg || 0) + '</button></li>';
    }).join('');
    const st = sel >= 0 && r.events[sel] && r.events[sel].type === 'shot' ? statusFor(r, sel) : IDLE;
    h += '<div class="key"><span data-side="0"' + fav(0, f) + '>' + esc(cl[0]) + ' · ' + n[0] + ' shots · xG ' + f2(xg[0]) + '</span><span data-side="1"' + fav(1, f) + '>' + esc(cl[1]) + ' · ' + n[1] + ' shots · xG ' + f2(xg[1]) + '</span></div>'
      + '<svg data-map="shots" viewBox="0 0 105 68" role="img" aria-label="' + esc(sum) + '">' + PITCH + '<g data-replay></g>' + dots + '</svg>'
      + '<p class="m" data-replay-status>' + esc(st) + '</p>'
      + '<ol class="xg-list" data-shots>' + list + '</ol>'
      + '<p class="m">Key: ' + goals + ' filled (goal), ' + saves + ' half filled with a dashed edge (save), ' + (idx.length - goals - saves) + ' hollow (off target). Chance bands: under 0.05 xG low, 0.05 to 0.2 medium, 0.2 and over high. Build-up passes are the shooting side\'s passes in the 20 seconds before the shot, from the event log.</p>';
    return h + '</section>';
  }

  // after the view is in the page: start the replay for a shot that was just tapped, or draw a finished one that the page has not drawn yet
  function mounted(root) {
    const g = root && root.querySelector('svg[data-map="shots"] [data-replay]');
    const r = typeof AG !== 'undefined' ? AG.run : null;
    if (!g) return;
    if (r && selRun !== r.key) { sel = -1; selRun = null; }
    if (!r || sel < 0 || !r.events[sel] || r.events[sel].type !== 'shot') { cancel(); g.innerHTML = ''; return; }
    if (!replay && g.dataset.run === r.key && g.dataset.shot === String(sel)) return;   // already showing (or still playing)
    const again = replay; replay = false;
    cancel();
    g.dataset.run = r.key; g.dataset.shot = String(sel);
    layers(g, r, sel);
    const total = buildUp(r, sel).length * PASS_MS + END_MS;
    if (again && !reduced()) play(g, r, sel); else place(g, r, sel, total);
  }

  // a tap or Enter on a shot (dot or list button): the view redraws, and this shot's replay starts
  function pick(i) {
    const r = typeof AG !== 'undefined' ? AG.run : null;
    if (!r || !r.events[i]) return;
    sel = i; selRun = r.key; replay = true;
    if (typeof ALV !== 'undefined') ALV.render();
  }
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('#al [data-shot-pick]') : null;
    if (t) pick(+t.getAttribute('data-shot-pick'));
  });

  return { panel, mounted, pick, buildUp, shots };
})();
