// ---- unified shell hook: Analyst. Routes to the season fixture the shell picked, and takes live matches sent from Watch or Broadcast at full time.
(() => {
  const framed = window.parent !== window;
  const send = (msg) => { if (framed) window.parent.postMessage(Object.assign({ src: 'matchcast', view: 'analyst' }, msg), '*'); };
  send({ type: 'progress', text: 'Loading 28 season matches' });
  const wait = setInterval(() => { if (D.matches.length) { clearInterval(wait); send({ type: 'ready' }); } }, 200);
  // the Watch links in this console open the Watch view of the shell, not the separate artifact
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href*="claude.ai/artifact/SSjrndFyoFUViaVZ6TzyFX"]');
    if (a && framed) { e.preventDefault(); send({ type: 'open', view: 'watch' }); }
  });
  // the live score from Watch, while Watch runs the shared match (a small pill, so the console shows one match everywhere)
  const livePill = (msg) => {
    let el = document.getElementById('mc-live');
    if (!el) { el = document.createElement('div'); el.id = 'mc-live'; el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:50;padding:6px 10px;border-radius:999px;background:#17283F;border:1px solid #FF7A2E;color:#E8EEF7;font:600 12px Inter,system-ui,sans-serif';
      document.body.appendChild(el); }
    el.hidden = !msg.on;
    if (msg.on) {
      el.textContent = 'Live from Watch · ' + msg.score.join('–') + ' · ' + (msg.over ? 'full time' : msg.minute + "'");
      el.title = 'Last five events: ' + (msg.last || []).map((x) => Math.floor(x.minute) + "' " + x.type + (x.player ? ' ' + x.player : '')).join(' | ');
      el.dataset.last = JSON.stringify(msg.last || []);
    }
  };
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.src !== 'matchcast-shell') return;
    if (d.type === 'feed') { livePill(d); return; }
    if (!D.matches.length) return;
    if (d.type === 'route') go(d.page, d.arg);
    if (d.type === 'import' && d.dataset) {
      const n = D.matches.length;
      mcImport({ name: 'live-match.json', text: async () => JSON.stringify(d.dataset) }).then(() => { if (d.recap && D.matches.length > n) D.matches[D.matches.length - 1].recap = d.recap; });   // lets the match page fetch the full-time recap
    }
  });
})();
