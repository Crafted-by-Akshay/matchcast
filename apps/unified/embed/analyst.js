// ---- unified shell hook: Analyst. Routes to the season fixture the shell picked, and takes live matches sent from Watch or Broadcast at full time.
(() => {
  const framed = window.parent !== window;
  const send = (msg) => { if (framed) window.parent.postMessage(Object.assign({ src: 'matchcast', view: 'analyst' }, msg), '*'); };
  send({ type: 'progress', text: 'Loading 28 season matches' });
  const wait = setInterval(() => { if (D.matches.length) { clearInterval(wait); send({ type: 'ready' }); } }, 200);
  // the Watch links in this console point at the Watch app beside it (../watch/), so they work on their own too; inside the shell they open the Watch view
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href="../watch/index.html"]');
    if (a && framed) { e.preventDefault(); send({ type: 'open', view: 'watch' }); }
  });
  // the live score from Watch, while Watch runs the shared match (a small pill, so the console shows one match everywhere)
  const placePill = () => {
    const el = document.getElementById('mc-live'); if (!el) return;
    const onLive = typeof R !== 'undefined' && R.page === 'live';
    const cop = document.getElementById('copbtn'), copOpen = !!cop && cop.getAttribute('aria-expanded') === 'true';   // the Copilot drawer owns the bottom right corner while it is open
    el.hidden = !el.dataset.on || onLive || copOpen || window.innerWidth <= 820;
  };
  setInterval(placePill, 700);
  const livePill = (msg) => {
    let el = document.getElementById('mc-live');
    if (!el) { el = document.createElement('div'); el.id = 'mc-live'; el.setAttribute('role', 'status');
      // bottom right, clear of the nav; it hides on the Live match page (which shows the same score) and on phones (the shell's match bar shows it)
      el.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:50;padding:6px 10px;border-radius:999px;background:#17283F;border:1px solid #FF7A2E;color:#E8EEF7;font:600 12px Inter,system-ui,sans-serif';
      document.body.appendChild(el); }
    el.hidden = !msg.on;
    el.dataset.on = msg.on ? '1' : '';
    placePill();
    if (msg.on) {
      el.textContent = 'Live from Watch · ' + msg.score.join('–') + ' · ' + (msg.over ? 'full time' : msg.minute + "'");
      el.title = 'Last five events: ' + (msg.last || []).map((x) => Math.floor(x.minute) + "' " + x.type + (x.player ? ' ' + x.player : '')).join(' | ');
      el.dataset.last = JSON.stringify(msg.last || []);
    }
  };
  // Ask the match: the shell answers from the api or the rules, and the Ask page waits for the answer
  const asks = new Map(); let askN = 0;
  window.mcAskShell = (q) => new Promise((res) => {
    if (!framed) { res({ text: 'Ask works in the MatchCast shell.', verdict: 'abstained' }); return; }
    const id = ++askN; asks.set(id, res);
    send({ type: 'ask', id, q });
    setTimeout(() => { if (asks.delete(id)) res({ text: 'The agents did not answer in time. Try again.', verdict: 'abstained', note: 'timeout' }); }, 15000);
  });
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.src !== 'matchcast-shell') return;
    if (d.type === 'answer') { const res = asks.get(d.id); if (res) { asks.delete(d.id); res(d.answer || {}); } return; }
    if (d.type === 'feed') { livePill(d); window.MC_FEED = d; if (window.mcLiveRefresh) window.mcLiveRefresh(); return; }
    if (d.type === 'indices') { window.MC_INDICES = d.data; if (typeof idxRefresh === 'function') idxRefresh(); return; }
    if (d.type === 'vision') { window.MC_VISION = d.report; if (typeof visRefresh === 'function') visRefresh(); return; }
    if (!D.matches.length) return;
    if (d.type === 'route') go(d.page, d.arg);
    if (d.type === 'import' && d.dataset) {
      const n = D.matches.length;
      mcImport({ name: 'live-match.json', text: async () => JSON.stringify(d.dataset) }).then(() => { const im = D.matches.length > n ? D.matches.filter((x) => x.imported && !x.recap).pop() : null; if (d.recap && im) im.recap = d.recap; });   // lets the match page fetch the full-time recap
    }
  });
})();
