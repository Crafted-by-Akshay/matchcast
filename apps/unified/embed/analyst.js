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
  const brand = document.querySelector('#top .brand');
  if (brand) {
    brand.setAttribute('role', 'button'); brand.setAttribute('tabindex', '0'); brand.setAttribute('aria-label', 'MatchCast home'); brand.title = 'Go to Home';
    const home = () => framed ? send({ type: 'open', view: 'home' }) : (window.location.href = '../index.html#home');
    brand.addEventListener('click', home);
    brand.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); home(); } });
  }
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

  // The full console should feel like one MatchCast product: black surfaces, restrained red accent, and a simpler Analyst overview.
  document.documentElement.setAttribute('data-theme', 'dark');
  const polish = document.createElement('style');
  polish.textContent = `
    :root[data-theme="dark"]{--bg:#080809;--surface:#111214;--surface-2:#1A1B1E;--surface-3:#242529;--ink:#F5F5F5;--ink-2:#D2D3D6;--muted:#A4A5AA;--line:#303238;--line-2:#414249;--accent:#E50914;--accent-ink:#fff;--accent-soft:#341316;--good:#55C98B;--good-soft:#10271A;--warn:#E5AA48;--warn-soft:#30230E;--bad:#F07A52;--bad-soft:#351A13;--info:#91AFFF;--info-soft:#17213A;--top:#080809;--top-ink:#F5F5F5;--top-muted:#A4A5AA;--top-line:#303238;--pitch:#153321;--pitch-line:#356447;color-scheme:dark}
    #top .brand b span{color:var(--accent)}#top #copbtn{background:var(--accent);color:#fff}#top .who{display:none!important}
    .mc-hide-nav-entry{display:none!important}
    .mc-hide-data-section{display:none!important}
    #main .pg.mc-dashboard>.pg-h{padding:20px 22px;background:linear-gradient(110deg,rgba(229,9,20,.13),transparent 64%),var(--surface);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:10px;margin-bottom:16px}
    #main .pg.mc-dashboard>.pg-h h1{font-size:34px;letter-spacing:.01em}#main .pg.mc-dashboard>.pg-h p{color:var(--muted)}
    #main .pg.mc-dashboard>.kpis{grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:10px}
    #main .pg.mc-dashboard>.kpis>.kpi{background:linear-gradient(145deg,rgba(255,255,255,.035),transparent 70%),var(--surface);border-top:2px solid rgba(229,9,20,.35)}
    #main .mc-platform-metrics{margin:0 0 18px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
    #main .mc-platform-metrics>summary,#main .mc-dashboard-tools>summary{padding:11px 14px;cursor:pointer;color:var(--ink-2);font-size:13px;font-weight:600;list-style-position:inside}
    #main .mc-platform-metrics>summary:hover,#main .mc-dashboard-tools>summary:hover{color:var(--ink);background:var(--surface-2)}
    #main .mc-platform-metrics .mc-secondary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:0 10px 10px}
    #main .mc-platform-metrics .kpi{background:var(--surface-2)}
    #main .mc-dashboard-tools{grid-column:span 12;border:1px solid var(--line);border-radius:8px;background:var(--surface);overflow:hidden}
    #main .mc-dashboard-tools .mc-q{padding:2px 12px 14px}
    #main .mc-dashboard-tools .mc-tool{background:var(--surface-2)}
    @media(max-width:900px){#main .pg.mc-dashboard>.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:560px){#main .pg.mc-dashboard>.pg-h{padding:16px}#main .pg.mc-dashboard>.pg-h h1{font-size:28px}#main .mc-platform-metrics .mc-secondary{grid-template-columns:1fr}}
  `;
  document.head.appendChild(polish);

  // Keep enterprise administration links out of the match-analysis experience.
  // The routes and their audit/access data remain intact for direct/admin use.
  const hideAdminNav = () => {
    const hiddenLabels = new Set(['users & access', 'users and access', 'audit log']);
    document.querySelectorAll('a,button,[role="link"],[role="button"],[role="menuitem"]').forEach((el) => {
      const label = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (hiddenLabels.has(label)) el.classList.add('mc-hide-nav-entry');
    });
  };
  const navObserver = new MutationObserver(hideAdminNav);
  navObserver.observe(document.body, { childList: true, subtree: true });
  hideAdminNav();

  const hideDataSection = () => {
    const label = [...document.querySelectorAll('nav h1,nav h2,nav h3,nav h4,nav h5,nav h6,nav summary,nav strong,nav b,nav div,nav span')]
      .find((el) => !el.children.length && (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === 'data');
    if (!label) return;
    const info = label.nextElementSibling;
    const text = (info && info.textContent || '').replace(/\s+/g, ' ').trim();
    if (info && /matchcast premier/i.test(text) && /players/i.test(text) && text.length < 260) {
      label.classList.add('mc-hide-data-section');
      info.classList.add('mc-hide-data-section');
    }
  };
  const dataObserver = new MutationObserver(hideDataSection);
  dataObserver.observe(document.body, { childList: true, subtree: true });
  hideDataSection();

  const polishOverview = () => {
    const pg = document.querySelector('#main > .pg');
    if (!pg || !pg.querySelector('#h-table') || pg.dataset.mcDashboard === '1') return;
    pg.dataset.mcDashboard = '1'; pg.classList.add('mc-dashboard');
    const heading = pg.querySelector('.pg-h h1'); if (heading) heading.textContent = 'Season overview';
    const kpis = pg.querySelector('.kpis');
    if (kpis && kpis.children.length > 4) {
      const all = [...kpis.children], extra = all.splice(4);
      const more = document.createElement('details'); more.className = 'mc-platform-metrics';
      const summary = document.createElement('summary'); summary.textContent = 'Platform quality · ' + extra.length + ' additional indicators';
      const content = document.createElement('div'); content.className = 'mc-secondary'; extra.forEach((el) => content.append(el));
      more.append(summary, content); kpis.after(more);
    }
    const tools = [...pg.querySelectorAll('.card')].find((card) => card.querySelector('.card-h h3')?.textContent.trim() === 'Tools');
    if (tools) {
      const content = tools.querySelector('.mc-q');
      if (content) {
        const more = document.createElement('details'); more.className = 'mc-dashboard-tools';
        const summary = document.createElement('summary'); summary.textContent = 'Explore analysis tools · ' + content.querySelectorAll('.mc-tool').length + ' tools';
        more.append(summary, content); tools.parentElement.replaceWith(more);
      }
    }
  };
  const main = document.getElementById('main');
  if (main) { new MutationObserver(polishOverview).observe(main, { childList: true, subtree: true }); polishOverview(); }
})();
