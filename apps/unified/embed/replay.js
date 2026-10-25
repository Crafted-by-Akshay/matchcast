// ---- instant replay (Broadcast): the desk keeps the last minute of Watch's frames and can play the last 10 to 30 seconds back,
// at normal or half speed, then returns to live. Only the positions are replayed: clock, score and stats stay live, and events and the agents are not replayed.
// Appended after broadcast.js in the same module (see build.py), so CONS, S and consumerStep are in scope.
// A capture listener on window sees Watch's frames before the desk's own handler: it buffers each one and, while a replay plays, swallows it.
const BUF = [], BUF_SEC = 60, RP = { on: false };
(() => {
  if (!window.MC_CONSUMER) return;
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.src !== 'matchcast-shell' || d.type !== 'frame') return;
    BUF.push({ at: performance.now(), frame: d.frame });
    while (BUF.length && BUF[0].at < performance.now() - BUF_SEC * 1000) BUF.shift();
    if (RP.on) e.stopImmediatePropagation();
  }, true);
  const bar = document.createElement('div');
  bar.id = 'mc-replay'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Instant replay');
  bar.style.cssText = 'position:absolute;left:10px;top:44px;z-index:8;max-width:60%;flex-wrap:wrap;display:flex;gap:6px;align-items:center;padding:6px 8px;background:rgba(10,20,40,.92);border-radius:6px;font:600 12px system-ui,sans-serif;color:#e8eefc';
  bar.innerHTML = '<span>Instant replay</span>'
    + [10, 20, 30].map((n) => '<button type="button" data-sec="' + n + '" style="padding:4px 8px;border-radius:4px;border:1px solid #3aa0ff;background:#12294a;color:#fff;font:inherit;cursor:pointer">Last ' + n + ' s</button>').join('')
    + '<label style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="mc-replay-slow">Slow-mo</label>'
    + '<button type="button" id="mc-replay-live" hidden style="padding:4px 8px;border-radius:4px;border:1px solid #ff4d4d;background:#4a1212;color:#fff;font:inherit;cursor:pointer">Back to live</button>';
  const tag = document.createElement('div');
  tag.id = 'mc-replay-tag'; tag.setAttribute('role', 'status'); tag.hidden = true; tag.textContent = 'REPLAY';
  tag.style.cssText = 'position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:9;padding:6px 14px;border-radius:999px;background:#c62828;color:#fff;font:800 13px system-ui,sans-serif;letter-spacing:.12em';
  // the desk hides every direct child of body except its own roots (bc.css), so the controls sit inside the live view
  // the bar is a row of the desk when the desk is up (desk-panels.js, which runs first); otherwise it floats over the live view. The tag always floats.
  const slot = document.getElementById('mc-replay-slot');
  if (slot) { bar.style.cssText += ';position:static;box-sizing:border-box;width:100%;max-width:none;flex-wrap:wrap'; slot.append(bar); } else (document.getElementById('bc-view') || document.body).append(bar);
  (document.getElementById('bc-view') || document.body).append(tag);
if (window.innerWidth < 480) {   // a phone-width pane keeps the bar small and clear of the teleprompter and the lower-third (the group keeps its aria-label)
  bar.querySelector('span').hidden = true;   // the slow-motion toggle stays on a phone: the phone spec keeps it on one row with the clips
  bar.querySelectorAll('button[data-sec]').forEach((b) => { b.textContent = b.dataset.sec + ' s'; });   // short labels keep the three buttons on one row
  bar.querySelectorAll('button').forEach((b) => { b.style.padding = '3px 5px'; b.style.fontSize = '12px'; });
}
  // narrow views (phones): the four on-air overlays stack instead of covering each other. Inline styles set the wide layout, so these rules need !important.
  const st = document.createElement('style');
  st.textContent = '@media (max-width:560px){'
    + '#mc-tele{left:8px!important;right:8px!important;top:8px!important;width:auto!important;max-height:2.4em!important;overflow:hidden!important}'
    + '#mc-replay{left:8px!important;right:8px!important;top:64px!important;flex-wrap:wrap!important}'
    + '#mc-replay>span{display:none}#mc-replay{gap:4px!important}#mc-replay button,#mc-replay label{white-space:nowrap;min-height:44px}#mc-replay button[data-sec]{padding:4px 5px!important}#mc-replay button[data-sec="10"]::before{content:"↺ "}'   // one row of the three clip buttons and Slow-mo (the group keeps its aria-label "Instant replay"; the arrow on the first button is the visible cue): no label breaks ("Slow- / mo"), 44 px targets, and the bar clears the lower-third in the 260 px phone stage; a heading does not fit in the 316 px content width beside them
    + '#mc-replay.rp-on button[data-sec],#mc-replay.rp-on label{display:none!important}'   // while a replay plays, "Back to live" takes the clips' place so the bar stays one row
    + '#mc-l3{left:8px!important;right:8px!important;bottom:76px!important;max-width:none!important;font-size:13px!important}'
    + '#mc-onair{left:8px!important;right:8px!important;bottom:8px!important;flex-wrap:wrap}}';
  document.head.append(st);
  const live = bar.querySelector('#mc-replay-live');
  let timer = 0;
  const stop = () => {
    clearInterval(timer); RP.on = false; tag.hidden = true; live.hidden = true; bar.classList.remove('rp-on');
    const last = BUF[BUF.length - 1]; if (last) { CONS.frame = last.frame; CONS.at = performance.now(); S.paused = !!last.frame.paused; consumerStep(0.016, true); }
  };
  // start(seconds, rate): play back from `seconds` ago at `rate` (1 or 0.5). Returns false when the buffer is shorter than a second.
  const start = (sec, rate) => {
    if (BUF.length < 2) return false;
    clearInterval(timer);
    const nowT = BUF[BUF.length - 1].at, from = Math.max(BUF[0].at, nowT - sec * 1000);
    const clip = BUF.filter((b) => b.at >= from);
    if (clip.length < 2) return false;
    RP.on = true; tag.hidden = false; live.hidden = false; bar.classList.add('rp-on'); tag.textContent = rate < 1 ? 'REPLAY · SLOW-MO' : 'REPLAY';
    const t0 = performance.now(); let i = 0;
    timer = setInterval(() => {
      const el = (performance.now() - t0) * rate + clip[0].at;
      const was = i;
      while (i < clip.length - 1 && clip[i + 1].at <= el) i++;
      if (i !== was) CONS.n++;   // a new frame for the action poses
      // positions come from the replayed frame; clock, half, score and stats stay live so events that arrive meanwhile are stamped correctly
      const lf = BUF[BUF.length - 1].frame;
      CONS.frame = Object.assign({}, clip[i].frame, { mclock: lf.mclock, half: lf.half, ht: lf.ht, over: lf.over, score: lf.score, stats: lf.stats, paused: lf.paused, speed: lf.speed }); CONS.at = performance.now();
      if (S.paused) consumerStep(0.016, true);
      if (el >= clip[clip.length - 1].at) stop();
    }, 40);
    return true;
  };
  const first = bar.querySelectorAll('button[data-sec]');
  first.forEach((b) => { b.disabled = true; b.title = 'Buffering Watch frames'; });
  const ready = setInterval(() => { if (BUF.length >= 2) { first.forEach((b) => { b.disabled = false; b.title = ''; }); clearInterval(ready); } }, 500);
  bar.addEventListener('click', (e) => { const b = e.target.closest('button[data-sec]'); if (b) start(+b.dataset.sec, bar.querySelector('#mc-replay-slow').checked ? 0.5 : 1); });
  live.addEventListener('click', stop);
  window.MCReplay = { start, stop, get playing() { return RP.on; }, get buffered() { return BUF.length ? (BUF[BUF.length - 1].at - BUF[0].at) / 1000 : 0; } };
})();
