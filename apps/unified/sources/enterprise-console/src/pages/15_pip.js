// ---- Picture-in-picture match replay. A floating window on desktop, a bottom sheet on phones. It replays m.frames on a
// 2D canvas (world coordinates, as tracked). It sits on document.body, so it keeps playing while the console changes page.
// Public: pipOpen(matchId, {start, play}), pipClose(), pipToggle(matchId). Read only, so there is no permission gate.
const pip_KEY = 'mce.pip';
const pip_RATE = 2; // match minutes per real second at 1x
const pip_TOP = 52; // the top bar is 52px; the window never sits under it
const pip_TITLE = 38; // title bar height, kept on screen when dragged
const pip_S = { open: false, id: null, m: null, goals: [], evs: [], end: 0, t: 0, play: false, speed: '1', min: false, compact: false, cols: ['#2458C6', '#E8833A'], root: null, cv: null, cw: 0, ch: 0, dpr: 1, raf: 0, last: 0, geo: null, drag: null };

(function pip_css() {
  const st = document.createElement('style');
  st.id = 'pip-style';
  st.textContent = [
    '.pip-win{position:fixed;z-index:25;display:flex;flex-direction:column;min-width:0;overflow:hidden;background:var(--surface);color:var(--ink);border:1px solid var(--line-2);border-radius:var(--r);box-shadow:0 16px 44px rgba(8,16,12,.28)}',
    '.pip-win.pip-min{height:auto!important}',
    '.pip-bar{display:flex;align-items:center;gap:8px;flex:none;min-height:' + pip_TITLE + 'px;padding:0 6px 0 12px;background:var(--top);color:var(--top-ink);cursor:move;touch-action:none;user-select:none}',
    '.pip-tt{font:700 14px/1 var(--f-disp);letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}',
    '.pip-id{font:500 11px/1.2 var(--f-mono);color:var(--top-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
    '.pip-sp{flex:1;min-width:4px}',
    '.pip-btn{background:none;border:0;color:var(--top-ink);width:28px;height:28px;border-radius:6px;font-size:14px;line-height:1;flex:none;display:grid;place-items:center;padding:0}',
    '.pip-btn:hover{background:rgba(255,255,255,.12)}',
    '.pip-body{flex:1;min-height:0;display:flex;flex-direction:column;gap:6px;padding:8px 10px 8px}',
    '.pip-win.pip-min .pip-body,.pip-win.pip-min .pip-grip{display:none}',
    '.pip-score{display:flex;align-items:center;justify-content:center;gap:10px;flex:none;font:700 22px/1 var(--f-disp);letter-spacing:.03em;font-variant-numeric:tabular-nums}',
    '.pip-tm{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:40%;overflow:hidden;white-space:nowrap}',
    '.pip-tm i{width:10px;height:10px;border-radius:2px;flex:none}',
    '.pip-tm b{overflow:hidden;text-overflow:ellipsis}',
    '.pip-sc{min-width:4.6ch;text-align:center}',
    '.pip-clk{display:flex;justify-content:center;gap:8px;flex:none;font:500 11.5px/1.2 var(--f-mono);color:var(--muted)}',
    '.pip-stage{flex:1;min-height:40px;position:relative}',
    '.pip-cv{position:absolute;inset:0;width:100%;height:100%;display:block;border-radius:6px}',
    '.pip-ctl{display:flex;align-items:center;gap:8px;flex:none}',
    '.pip-play{min-width:68px}',
    '.pip-scrub{flex:1;min-width:0;accent-color:var(--accent);margin:0}',
    '.pip-row{display:flex;align-items:center;gap:8px;flex:none;flex-wrap:wrap}',
    '.pip-row .seg button{min-height:30px;padding:0 9px}',
    '.pip-ev{flex:1 1 150px;min-width:0;max-width:100%;min-height:30px;background:var(--surface);border:1px solid var(--line-2);border-radius:6px;padding:0 6px;font-size:12.5px;color:var(--ink)}',
    '.pip-foot{flex:none;font-size:11px;line-height:1.4;color:var(--muted);padding-right:16px}',
    '.pip-win.pip-compact .pip-foot{display:none}',
    '.pip-none{flex:1;display:grid;place-items:center;text-align:center;color:var(--muted);font-size:13px;padding:16px}',
    '.pip-grip{position:absolute;right:0;bottom:0;width:20px;height:20px;cursor:nwse-resize;touch-action:none;background:linear-gradient(135deg,transparent 0 52%,var(--line-2) 52% 60%,transparent 60% 70%,var(--line-2) 70% 78%,transparent 78%)}',
    '@media (max-width:640px){.pip-win{left:0!important;right:0!important;top:auto!important;bottom:0!important;width:100%!important;height:66vh!important;border-radius:12px 12px 0 0;border-bottom:0}.pip-win.pip-min{height:auto!important}.pip-bar{cursor:default}.pip-grip{display:none}}'
  ].join('\n');
  document.head.appendChild(st);
})();

// ---- helpers
function pip_tok(name, fb) { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb; } catch (e) { return fb; } }
function pip_phone() { try { return matchMedia('(max-width: 640px)').matches; } catch (e) { return false; } }
function pip_ink(hex) { const v = parseInt(String(hex).slice(1), 16); const l = (v >> 16) * 0.299 + ((v >> 8) & 255) * 0.587 + (v & 255) * 0.114; return l > 150 ? '#13201A' : '#FFFFFF'; }
function pip_load() { try { const g = JSON.parse(localStorage.getItem(pip_KEY) || 'null'); return g && typeof g === 'object' ? g : null; } catch (e) { return null; } }
function pip_save() { try { const g = pip_S.geo; localStorage.setItem(pip_KEY, JSON.stringify({ x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.w), h: Math.round(g.h) })); } catch (e) {} }
// keeps size between 280x200 and the viewport, and the title bar on screen
function pip_clamp(g) {
  const vw = innerWidth, vh = innerHeight;
  const w = clamp(+g.w || 400, 280, Math.max(280, vw));
  const h = clamp(+g.h || 420, 200, Math.max(200, vh - pip_TOP));
  const x = clamp(+g.x || 0, 0, Math.max(0, vw - w));
  const y = clamp(+g.y || 0, pip_TOP, Math.max(pip_TOP, vh - pip_TITLE));
  return { x, y, w, h };
}
function pip_apply() {
  const S = pip_S, el = S.root; if (!el) return;
  if (pip_phone()) { el.style.left = ''; el.style.top = ''; el.style.width = ''; el.style.height = ''; S.compact = false; }
  else { const g = S.geo; el.style.left = g.x + 'px'; el.style.top = g.y + 'px'; el.style.width = g.w + 'px'; el.style.height = g.h + 'px'; S.compact = g.h < 320; }
  el.classList.toggle('pip-compact', S.compact);
}
// frame lookup: the last frame at or before t, and the next one
function pip_q(fr, t) {
  const n = fr.length;
  if (t <= fr[0].m) return { a: fr[0], b: null, k: 0 };
  if (t >= fr[n - 1].m) return { a: fr[n - 1], b: null, k: 0 };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (fr[mid].m <= t) lo = mid; else hi = mid; }
  const a = fr[lo], b = fr[hi];
  return { a, b, k: (t - a.m) / ((b.m - a.m) || 1) };
}
function pip_lerp(pa, pb, k) { if (!pa || !pb) return pa || pb || null; return [pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k]; }
// interpolate inside one half. Across the half-time flip (f changes) positions are not blended: the nearer frame is used.
function pip_pick(q, get) {
  if (!q.b || q.a.f === q.b.f) return pip_lerp(get(q.a), q.b ? get(q.b) : null, q.k);
  return get(q.k < 0.5 ? q.a : q.b);
}
function pip_events(m) { return (m.events || []).filter((e) => e.type === 'goal' || e.type === 'shot').sort((a, b) => a.minute - b.minute); }
// running score from the goal events: each goal carries the scoreline after it ("h-a")
function pip_score(t) {
  let s = [0, 0];
  for (const g of pip_S.goals) { if (g.minute > t) break; const p = String(g.score || '').split('-').map(Number); if (p.length === 2 && isFinite(p[0]) && isFinite(p[1])) s = p; }
  return s;
}
function pip_phase(t, f) { if (t >= pip_S.end) return 'Full time'; if (t < 0.05) return 'Kick-off'; return f === 1 ? '2nd half' : '1st half'; }

// ---- drawing: pitch lines drawn with the theme tokens, players in the kit colours, the ball in white
function pip_draw(q) {
  const S = pip_S, cv = S.cv; if (!cv || !S.m) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), cw = cv.clientWidth, ch = cv.clientHeight;
  if (!cw || !ch) return;
  if (cw !== S.cw || ch !== S.ch || dpr !== S.dpr) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); S.cw = cw; S.ch = ch; S.dpr = dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cw, ch);
  const pad = 6; let pw = cw - pad * 2, ph = pw * 68 / 105;
  if (ph > ch - pad * 2) { ph = ch - pad * 2; pw = ph * 105 / 68; }
  const ox = (cw - pw) / 2, oy = (ch - ph) / 2, s = pw / 105;
  const X = (x) => ox + x * s, Y = (y) => oy + y * s;
  const line = pip_tok('--pitch-line', '#A9C4B1');
  g.fillStyle = pip_tok('--pitch', '#E4F0E7'); g.fillRect(ox, oy, pw, ph);
  g.strokeStyle = line; g.fillStyle = line; g.lineWidth = 1.2;
  g.strokeRect(X(0), Y(0), 105 * s, 68 * s);
  g.beginPath(); g.moveTo(X(52.5), Y(0)); g.lineTo(X(52.5), Y(68)); g.stroke();
  g.beginPath(); g.arc(X(52.5), Y(34), 9.15 * s, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(X(52.5), Y(34), 1.6, 0, Math.PI * 2); g.fill();
  g.strokeRect(X(0), Y(13.84), 16.5 * s, 40.32 * s); g.strokeRect(X(88.5), Y(13.84), 16.5 * s, 40.32 * s);
  g.strokeRect(X(0), Y(24.84), 5.5 * s, 18.32 * s); g.strokeRect(X(99.5), Y(24.84), 5.5 * s, 18.32 * s);
  g.beginPath(); g.arc(X(11), Y(34), 9.15 * s, -0.927, 0.927); g.stroke();
  g.beginPath(); g.arc(X(94), Y(34), 9.15 * s, Math.PI - 0.927, Math.PI + 0.927); g.stroke();
  const fr = S.m.frames || [];
  const R = clamp(2.2 * s, 6.5, 12), fs = Math.max(8, Math.round(R * 1.05));
  const ring = pip_tok('--surface', '#FFFFFF'), mono = pip_tok('--f-mono', 'monospace');
  for (let i = 0; i < 22; i++) {
    const p = pip_pick(q, (f) => (f.p ? f.p[i] : null)); if (!p) continue;
    const c = i < 11 ? S.cols[0] : S.cols[1], meta = (S.m.pids || [])[i] || {};
    g.beginPath(); g.arc(X(p[0]), Y(p[1]), R, 0, Math.PI * 2); g.fillStyle = c; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = ring; g.stroke();
    g.fillStyle = pip_ink(c); g.font = '600 ' + fs + 'px ' + mono; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(meta.num == null ? '' : meta.num), X(p[0]), Y(p[1]) + 0.5);
  }
  const b = pip_pick(q, (f) => f.b);
  if (b && fr.length) { const r = Math.max(2.6, 0.9 * s); g.beginPath(); g.arc(X(b[0]), Y(b[1]), r, 0, Math.PI * 2); g.fillStyle = '#FFFFFF'; g.fill(); g.strokeStyle = '#13201A'; g.lineWidth = 1; g.stroke(); }
}

// one frame: draw (unless minimised) and update the readouts
function pip_frame() {
  const S = pip_S, el = S.root; if (!el || !S.m) return;
  const fr = S.m.frames || []; if (!fr.length) return;
  const q = pip_q(fr, S.t);
  if (!S.min) pip_draw(q);
  const sc = pip_score(S.t);
  const q1 = (sel) => el.querySelector(sel);
  q1('.pip-sc').textContent = sc[0] + ' \u2013 ' + sc[1];
  q1('.pip-ck').textContent = Math.floor(S.t) + "'";
  q1('.pip-ph').textContent = pip_phase(S.t, q.a.f);
  q1('.pip-play').textContent = S.play ? 'Pause' : 'Play';
  const scrub = q1('.pip-scrub'); if (scrub && document.activeElement !== scrub) scrub.value = S.t.toFixed(1);
}

function pip_loop(ts) {
  const S = pip_S; if (!S.open) return;
  const dt = S.last ? Math.min(0.25, (ts - S.last) / 1000) : 0; S.last = ts;
  if (S.play && S.m) {
    S.t += dt * pip_RATE * (+S.speed || 1);
    if (S.t >= S.end) { S.t = S.end; S.play = false; }
  }
  pip_frame();
  S.raf = requestAnimationFrame(pip_loop);
}

function pip_playToggle() {
  const S = pip_S; if (!S.m || !(S.m.frames || []).length) return;
  if (!S.play && S.t >= S.end) S.t = 0;
  S.play = !S.play; pip_frame();
}

// ---- window markup and behaviour
function pip_build(m) {
  const S = pip_S, hasT = (m.frames || []).length > 0, cols = S.cols;
  const el = document.createElement('section');
  el.className = 'pip-win'; el.id = 'pip-win'; el.tabIndex = -1; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Match replay: ' + m.title);
  const opts = S.evs.map((e) => {
    const t = Math.floor(e.minute) + "'";
    const txt = e.type === 'goal' ? t + ' Goal \u00b7 ' + (e.player || '') + ' \u00b7 ' + (e.score || '') : t + ' Shot \u00b7 ' + (e.player || '') + ' \u00b7 xG ' + fmt(e.xg || 0, 2);
    return '<option value="' + e.minute + '">' + esc(txt) + '</option>';
  }).join('');
  const end = hasT ? (m.frames[m.frames.length - 1].m) : 0;
  const body = hasT
    ? '<div class="pip-stage"><canvas class="pip-cv" role="img" aria-label="Pitch replay from tracking data"></canvas></div>' +
      '<div class="pip-ctl"><button class="btn sm pip-play" type="button" aria-label="Play or pause">Pause</button>' +
      '<input class="pip-scrub" type="range" min="0" max="' + end + '" step="0.1" value="0" aria-label="Match minute"></div>' +
      '<div class="pip-row">' + seg('pip-speed', [['0.5', '0.5x'], ['1', '1x'], ['2', '2x']], S.speed) +
      '<select class="pip-ev" aria-label="Jump to a goal or shot"><option value="">Jump to a goal or shot</option>' + opts + '</select></div>'
    : '<div class="pip-none">This match has no tracking data (imported from Watch). The replay needs tracking frames. The event views in the Match centre still work.</div>';
  el.innerHTML =
    '<div class="pip-bar" data-pip-drag><span class="pip-tt">Match replay</span><span class="pip-id" title="' + esc(m.title) + '">' + esc(m.id) + ' \u00b7 ' + esc(m.title) + '</span><span class="pip-sp"></span>' +
      '<button class="pip-btn" type="button" data-pip-act="min" aria-label="Minimise" title="Minimise">\u2013</button>' +
      '<button class="pip-btn" type="button" data-pip-act="close" aria-label="Close replay" title="Close">\u2715</button></div>' +
    '<div class="pip-body">' +
      '<div class="pip-score"><span class="pip-tm" title="' + esc(clubName(m.home)) + '"><i style="background:' + cols[0] + '"></i><b>' + esc(m.home) + '</b></span><span class="pip-sc"></span><span class="pip-tm" title="' + esc(clubName(m.away)) + '"><b>' + esc(m.away) + '</b><i style="background:' + cols[1] + '"></i></span></div>' +
      '<div class="pip-clk"><span class="pip-ck"></span><span class="pip-ph"></span></div>' +
      body +
      '<div class="pip-foot">Replay from tracking data. The live 3D match runs in MatchCast Watch. <a href="https://claude.ai/artifact/SSjrndFyoFUViaVZ6TzyFX" target="_blank" rel="noopener">Open MatchCast Watch \u2197</a></div>' +
    '</div>' +
    '<div class="pip-grip" data-pip-grip title="Drag to resize" aria-hidden="true"></div>';
  return el;
}

function pip_bind(el) {
  const S = pip_S;
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { pipClose(); return; }
    if (e.key === ' ' && e.target === el) { e.preventDefault(); pip_playToggle(); }
  });
  el.querySelector('[data-pip-act="close"]').onclick = () => pipClose();
  el.querySelector('[data-pip-act="min"]').onclick = (e) => {
    S.min = !S.min; el.classList.toggle('pip-min', S.min);
    e.currentTarget.textContent = S.min ? '+' : '\u2013';
    e.currentTarget.setAttribute('aria-label', S.min ? 'Restore' : 'Minimise');
    e.currentTarget.title = S.min ? 'Restore' : 'Minimise';
    pip_frame();
  };
  const play = el.querySelector('.pip-play'); if (play) play.onclick = () => pip_playToggle();
  const scrub = el.querySelector('.pip-scrub');
  if (scrub) scrub.oninput = () => { S.t = clamp(+scrub.value, 0, S.end); pip_frame(); };
  el.querySelectorAll('#pip-speed button').forEach((b) => {
    b.onclick = () => { S.speed = b.dataset.v; el.querySelectorAll('#pip-speed button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); };
  });
  const ev = el.querySelector('.pip-ev');
  if (ev) ev.onchange = () => { if (ev.value === '') return; S.t = clamp(+ev.value, 0, S.end); ev.value = ''; pip_frame(); };
  // move by the title bar (desktop only; on phones the sheet stays put)
  el.querySelector('[data-pip-drag]').addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || pip_phone() || e.target.closest('button')) return;
    S.drag = { mode: 'move', x0: e.clientX, y0: e.clientY, gx: S.geo.x, gy: S.geo.y }; e.preventDefault();
  });
  el.querySelector('[data-pip-grip]').addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || pip_phone()) return;
    S.drag = { mode: 'size', x0: e.clientX, y0: e.clientY, gw: S.geo.w, gh: S.geo.h }; e.preventDefault(); e.stopPropagation();
  });
}
document.addEventListener('pointermove', (e) => {
  const S = pip_S, d = S.drag; if (!d || !S.root) return;
  const g = S.geo;
  if (d.mode === 'move') { S.geo = pip_clamp({ x: d.gx + e.clientX - d.x0, y: d.gy + e.clientY - d.y0, w: g.w, h: g.h }); }
  else { g.w = clamp(d.gw + e.clientX - d.x0, 280, Math.max(280, innerWidth - g.x)); g.h = clamp(d.gh + e.clientY - d.y0, 200, Math.max(200, innerHeight - g.y)); }
  pip_apply();
});
function pip_end() { const S = pip_S; if (!S.drag) return; S.drag = null; if (S.root && !pip_phone()) pip_save(); }
document.addEventListener('pointerup', pip_end);
document.addEventListener('pointercancel', pip_end);
window.addEventListener('resize', () => { const S = pip_S; if (!S.root) return; if (!pip_phone()) S.geo = pip_clamp(S.geo); pip_apply(); });
// any element with data-pip-open opens the window (survives page re-renders, so one listener on the document is enough)
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-pip-open]'); if (!b) return;
  e.preventDefault(); pipOpen(b.dataset.pipOpen);
});

// ---- public API
function pipOpen(matchId, opts) {
  const S = pip_S; opts = opts || {};
  const id = matchId || R.lastMatch || ((D.matches[D.matches.length - 1]) || {}).id;
  const m = id ? D.match(id) : null;
  if (!m) { toast('That match is not in the library.'); return; }
  if (S.open && S.id === m.id) { if (opts.start != null) { S.t = clamp(+opts.start || 0, 0, S.end); pip_frame(); } return; }
  if (S.open) pipClose();
  const fr = m.frames || [];
  S.open = true; S.id = m.id; S.m = m;
  S.goals = (m.events || []).filter((e) => e.type === 'goal').sort((a, b) => a.minute - b.minute);
  S.evs = pip_events(m);
  S.end = fr.length ? fr[fr.length - 1].m : 0;
  S.t = clamp(opts.start != null ? +opts.start || 0 : 0, 0, S.end);
  S.play = fr.length > 0 && opts.play !== false;
  S.min = false; S.cols = pairCols(m.home, m.away);
  const dflt = { x: innerWidth - 416, y: innerHeight - 436, w: 400, h: 420 };
  S.geo = pip_clamp(Object.assign(dflt, pip_load() || {}));
  S.root = pip_build(m); document.body.appendChild(S.root);
  pip_bind(S.root); S.cv = S.root.querySelector('.pip-cv');
  S.cw = 0; S.ch = 0; pip_apply(); pip_frame();
  S.last = 0; S.raf = requestAnimationFrame(pip_loop);
}
function pipClose() {
  const S = pip_S; if (!S.open) return;
  S.open = false; cancelAnimationFrame(S.raf); S.raf = 0; S.drag = null;
  if (S.root) S.root.remove();
  S.root = null; S.cv = null; S.id = null; S.m = null; S.goals = []; S.evs = []; S.min = false;
}
function pipToggle(matchId) { const S = pip_S; if (S.open && (!matchId || S.id === matchId)) pipClose(); else pipOpen(matchId); }
