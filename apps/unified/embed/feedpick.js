// ---- Watch: the crew feed picker (AB#450, flag ?crew=1). Runs in the Watch module after twofans.js. ----
// A radiogroup in the commentary card chooses which crew feed to read. Casual and Analyst are live; the other four are Planned and say so.
// Watch is an iframe, so the lines come from the shell's CREW data layer over postMessage: the shell posts {src:'matchcast-shell', type:'crew-feeds', feeds, defs}
// and this module posts {src:'matchcast', type:'crew-feed-pick', key}. Every line in CREW.state.feeds was published after the Verifier passed it; until the
// orchestration frames land, the lines are the Simulated fixture. English only today.
(() => {
  const feed = document.getElementById('mcf');
  if (!feed || document.getElementById('bc-view') || document.getElementById('mc-feedpick')) return;
  let on = false;
  try { on = /[?&]crew=1/.test(location.search); } catch (e) { /* no location */ }
  if (!on) return;

  const KEY = 'mc-feedpick';
  let DEFS = [
    { key: 'casual', label: 'Casual', live: true }, { key: 'analyst', label: 'Analyst', live: true },
    { key: 'audio_description', label: 'Audio description', live: false }, { key: 'catch_me_up', label: 'Catch me up', live: false },
    { key: 'half_time', label: 'Half-time explainer', live: false }, { key: 'ticker', label: 'News ticker', live: false },
  ];
  const BLOCK = new Set(['catch_me_up', 'half_time']);
  let feeds = {}, lang = 'en', pick = 'casual';
  try { const s = localStorage.getItem(KEY); if (s && DEFS.some((d) => d.key === s)) pick = s; } catch (e) { /* storage blocked: the default stands */ }

  const st = document.createElement('style');
  st.textContent = '#mc-feeds{border-top:1px solid rgba(140,194,255,.2);padding:6px 10px 8px}'
    + '#mc-feedpick{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 6px}'
    + '#mc-feedpick button{min-height:32px;padding:2px 9px;border-radius:999px;border:1px solid rgba(140,194,255,.35);background:transparent;color:#c9d6f0;font:600 12px system-ui,sans-serif;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:5px}'
    + '#mc-feedpick button[aria-checked=true]{background:#8CC2FF;border-color:#8CC2FF;color:#0B1630}#mc-feedpick button:focus-visible{outline:2px solid #F5B942;outline-offset:2px}'
    + '#mc-feedpick .fp-tag{font:700 10px system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;padding:0 5px;border-radius:4px;border:1px solid currentColor;opacity:.9}'
    + '#mc-feedlines{font:12px/1.35 system-ui,sans-serif;color:#e8eefc;min-height:1.35em}#mc-feedlines ul{list-style:none;margin:0;padding:0;display:grid;gap:4px}'
    + '#mc-feedlines li{display:flex;gap:6px;align-items:baseline;overflow-wrap:anywhere}#mc-feedlines .fp-min{font-weight:700;color:#8CC2FF;flex:none}'
    + '#mc-feedlines .fp-tick{color:#5BD19A;font-weight:700;flex:none}#mc-feedlines .fp-note{margin:4px 0 0;color:#c9d6f0}#mc-feedlines .fp-empty{margin:0;color:#c9d6f0}'
    + 'body.mc-feedon #mc-two{display:none!important}'
    + '@media (max-width:560px){#mc-feeds{border-top:0;padding:0 8px 6px}#mc-feedpick{flex:1 1 0;min-width:0;margin:0 6px;flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none}#mc-feedpick button{min-height:44px;flex:none}'
    + 'body.mc-feedon #mcf-head>span,body.mc-feedon #mcf-top{display:none}#mc-feedlines ul{display:block}#mc-feedlines li:nth-child(n+2),#mc-feedlines .fp-note{display:none}#mc-feedlines li{white-space:nowrap}#mc-feedlines li>span:last-child,#mc-feedlines p{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#mc-feedlines p.fp-block{display:block}}';
  document.head.appendChild(st);
  document.body.classList.add('mc-feedon');

  const box = document.createElement('div'); box.id = 'mc-feeds';
  const grp = document.createElement('div'); grp.id = 'mc-feedpick'; grp.setAttribute('role', 'radiogroup'); grp.setAttribute('aria-label', 'Feed');
  const out = document.createElement('div'); out.id = 'mc-feedlines'; out.setAttribute('aria-live', 'polite');
  box.append(grp, out);   // seat() below may move grp to the header row
  const head = feed.querySelector('#mcf-head');
  feed.insertBefore(box, head ? head.nextSibling : feed.firstChild);
  // a phone has no height to spare above the Talk and Copilot buttons: the group moves into the card's header row and the one-line feed text takes the place of the commentary line
  const mq = window.matchMedia('(max-width:560px)');
  const seat = () => { if (mq.matches && head) head.insertBefore(grp, head.firstChild); else box.insertBefore(grp, out); };
  if (mq.addEventListener) mq.addEventListener('change', seat); else if (mq.addListener) mq.addListener(seat);

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const def = () => DEFS.find((d) => d.key === pick) || DEFS[0];

  const drawPick = () => {
    grp.innerHTML = DEFS.map((d) => '<button type="button" role="radio" data-key="' + esc(d.key) + '" aria-checked="' + (d.key === pick) + '" tabindex="' + (d.key === pick ? 0 : -1) + '">'
      + esc(d.label) + (d.live ? '' : '<span class="fp-tag">Planned</span>') + '</button>').join('');
  };
  const drawLines = () => {
    const d = def();
    if (!d.live) { out.innerHTML = '<p class="fp-empty">Planned: this feed is not built yet</p>'; return; }
    const lines = (feeds[d.key] || []).slice(-3).reverse();
    const one = BLOCK.has(d.key) && lines.length;   // catch-me-up and half-time arrive as ONE record with the whole text: a single block, not a list of lines
    let h = one
      ? '<p class="fp-block"><span class="fp-min">' + Math.floor((+lines[0].match_time_ms || 0) / 60000) + "'</span>"
        + '<span class="fp-tick" role="img" aria-label="Verified" title="Verified: the Verifier recounted this text from the stored events">✓</span> ' + esc(lines[0].text) + '</p>'
      : lines.length
      ? '<ul>' + lines.map((l) => '<li><span class="fp-min">' + Math.floor((+l.match_time_ms || 0) / 60000) + "'</span>"
        + '<span class="fp-tick" role="img" aria-label="Verified" title="Verified: the Verifier recounted this line from the stored events">✓</span><span>' + esc(l.text) + '</span></li>').join('') + '</ul>'
      : '<p class="fp-empty">waiting for a moment</p>';
    if (lang !== 'en') h += '<p class="fp-note" lang="en">Showing English: no translated line yet</p>';
    out.innerHTML = h;
  };
  const choose = (key, fromUser) => {
    if (!DEFS.some((d) => d.key === key)) return;
    pick = key;
    if (fromUser) { try { localStorage.setItem(KEY, key); } catch (e) { /* storage blocked */ } }
    drawPick(); drawLines();
    try { window.parent.postMessage({ src: 'matchcast', type: 'crew-feed-pick', key, lang: 'en' }, '*'); } catch (e) { /* no shell */ }
  };

  grp.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button[data-key]'); if (b) { choose(b.dataset.key, true); const nb = grp.querySelector('[aria-checked=true]'); if (nb) nb.focus(); } });
  grp.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = DEFS.findIndex((d) => d.key === pick);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? DEFS.length - 1 : (i + step + DEFS.length) % DEFS.length;
    choose(DEFS[n].key, true); const nb = grp.querySelector('[aria-checked=true]'); if (nb) nb.focus();
  });

  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (e.source !== window.parent || d.src !== 'matchcast-shell') return;
    if (d.type === 'crew-feeds') {
      if (Array.isArray(d.defs) && d.defs.length) { DEFS = d.defs.map((x) => ({ key: String(x.key), label: String(x.label), live: !!x.live })); if (!DEFS.some((x) => x.key === pick)) pick = DEFS[0].key; drawPick(); }
      feeds = d.feeds && typeof d.feeds === 'object' ? d.feeds : {};
      drawLines();
    } else if (d.type === 'lang') { lang = String(d.lang || 'en'); drawLines(); }
  });

  seat(); drawPick(); drawLines();
  try { window.parent.postMessage({ src: 'matchcast', type: 'crew-feed-pick', key: pick, lang: 'en' }, '*'); } catch (e) { /* no shell */ }   // tells the shell which feed is open and asks it for the lines
  window.__mcFeedPick = { get pick() { return pick; } };
})();
