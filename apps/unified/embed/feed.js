// ---- unified shell hook: the continuous commentary feed (Watch and Broadcast). The shell posts the feed (feed.js: every moment, key event and quiet-stretch summary).
// The newest line shows at once; the list keeps the last 40 with the label of who wrote each line and the agents that made it. Lines never stop while a match runs.
(() => {
  const st = document.createElement('style');
  st.textContent = '#mcf{position:fixed;left:calc(14px + env(safe-area-inset-left,0px));bottom:calc(14px + env(safe-area-inset-bottom,0px));width:min(380px,calc(100% - 28px));z-index:31;font:13px/1.35 system-ui,sans-serif;color:#e8eefc;background:rgba(10,20,40,.92);border:1px solid rgba(140,194,255,.28);border-radius:10px;overflow:hidden}'
    + '#mcf-head{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 10px;font:700 11px system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#8CC2FF}'
    + '#mcf-sound{padding:0 10px 6px;font:600 11px system-ui,sans-serif;color:#F5B942}#mcf-sound[hidden]{display:none}'
    + '#mcf-tog{min-height:28px;padding:2px 8px;border-radius:6px;border:1px solid rgba(140,194,255,.4);background:transparent;color:#e8eefc;font:600 11px system-ui,sans-serif;cursor:pointer}'
    + '#mcf-top{padding:0 10px 8px;font-weight:600}#mcf-top .m,#mcf li .m{color:#8CC2FF;font-variant-numeric:tabular-nums;margin-right:6px}'
    + '#mcf-list{list-style:none;margin:0;padding:0 10px 10px;max-height:40vh;overflow:auto;display:grid;gap:6px;border-top:1px solid rgba(140,194,255,.2);padding-top:8px}#mcf-list[hidden]{display:none}'
    + '#mcf li{border-left:2px solid rgba(140,194,255,.4);padding-left:8px}#mcf li.big,#mcf-top.big{border-left-color:#F5B942}#mcf li.live{border-left-color:#5BD19A}'
    + '#mcf .src{display:inline-block;margin-left:6px;font:600 10px ui-monospace,monospace;color:#c9d6f0;border:1px solid rgba(140,194,255,.35);border-radius:4px;padding:0 4px}'
    + '#mcf .chain{display:block;margin-top:2px;font:10px ui-monospace,monospace;color:#8793ad}'
    + '#mcf-top:not(.big) b{color:#fff}#mcf-top.big b{color:#F5B942}'
    + '@media (min-width:561px){#bc-view #mcf{left:auto;right:calc(14px + env(safe-area-inset-right,0px));width:min(360px,calc(100% - 28px));max-height:30vh;overflow:auto}}'
    + '@media (max-width:560px){#mcf{left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom,0px));width:auto}#mcf-head{padding:4px 8px}#mcf-top{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 8px 6px}#mcf-tog{min-height:44px;min-width:44px}}';
  document.head.appendChild(st);
  const box = document.createElement('section');
  box.id = 'mcf'; box.setAttribute('aria-label', 'Live commentary');
  box.innerHTML = '<div id="mcf-head"><span>Live commentary</span><button type="button" id="mcf-tog" aria-expanded="false" aria-controls="mcf-list">All lines</button></div><div id="mcf-sound">Sound is off. Click Voice: off in the top bar to hear the booth.</div><div id="mcf-top" aria-live="polite"></div><ol id="mcf-list" hidden></ol>';
  (document.getElementById('bc-view') || document.body).append(box);
  const top = box.querySelector('#mcf-top'), list = box.querySelector('#mcf-list'), tog = box.querySelector('#mcf-tog'), sound = box.querySelector('#mcf-sound');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const mins = (m) => Math.floor(+m || 0) + "'";
  // one line: minute, text, who wrote it, and (in the list) the agents that made it
  const row = (x, withChain) => '<span class="m">' + mins(x.minute) + '</span>' + esc(x.text)
    + '<span class="src" title="' + esc(x.label || '') + '">' + esc(x.source === 'live' ? 'Live agents' : 'Rules') + '</span>'
    + (withChain ? '<span class="chain">' + esc((x.chain || []).join(' › ')) + (x.source === 'live' ? '' : ' · checked in page') + '</span>' : '');
  const draw = (items) => {
    if (!items.length) { top.textContent = ''; list.innerHTML = ''; return; }
    const last = items[items.length - 1];
    top.className = last.tone === 'big' ? 'big' : '';
    top.innerHTML = '<span class="m">' + mins(last.minute) + '</span><b>' + esc(last.text) + '</b>';
    list.innerHTML = items.slice().reverse().map((x) => '<li class="' + (x.tone === 'big' ? 'big ' : '') + (x.source === 'live' ? 'live' : '') + '">' + row(x, true) + '</li>').join('');
  };
  tog.addEventListener('click', () => { list.hidden = !list.hidden; tog.setAttribute('aria-expanded', String(!list.hidden)); tog.textContent = list.hidden ? 'All lines' : 'Hide lines'; });
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.src !== 'matchcast-shell') return;
    if (d.type === 'voice-state') { sound.hidden = !!d.on; return; }   // the hint shows until the shell says Voice is on
    if (d.type !== 'feed-lines') return;
    draw(Array.isArray(d.items) ? d.items : []);
  });
  window.parent.postMessage({ src: 'matchcast', type: 'feed-ready' }, '*');   // asks the shell for the Voice state once on load
  window.MCFeed = { get shown() { return list.children.length; }, get top() { return top.textContent; } };
})();
