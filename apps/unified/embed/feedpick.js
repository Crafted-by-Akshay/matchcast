// ---- Watch: the crew feed picker (AB#450, default on, ?crew=0 turns it off). Runs in the Watch module after twofans.js. ----
// A radiogroup in the commentary card chooses which crew feed to read. Casual and Analyst are live; the other four are Planned and say so.
// Watch is an iframe, so the lines come from the shell's CREW data layer over postMessage: the shell posts {src:'matchcast-shell', type:'crew-feeds', lang, simulated, feeds, defs}
// and this module posts {src:'matchcast', type:'crew-feed-pick', key, lang}. Honesty: while simulated is true the lines are the fixture, labelled Simulated and carrying NO Verifier tick.
// A tick shows only on a line that carries verdict 'verified' from a real frame. English only today.
// Planned: catch_me_up and half_time arrive as ONE record with the whole text (not per line); they need a block renderer when they go live.
(() => {
  const feed = document.getElementById('mcf');
  if (!feed || document.getElementById('bc-view') || document.getElementById('mc-feedpick')) return;
  let qs = ''; try { qs = location.search + '&' + (window.parent !== window ? window.parent.location.search : ''); } catch (e) { /* cross-origin parent */ }
  let on = !/[?&]crew=0(&|$)/.test(qs);   // default on; ?crew=0 or localStorage mc-crew=0 turns it off, an explicit crew=1 beats a stored 0
  try { if (on && !/[?&]crew=1(&|$)/.test(qs) && localStorage.getItem('mc-crew') === '0') on = false; } catch (e) { /* storage blocked */ }
  if (!on) return;

  const KEY = 'mc-feedpick';
  let DEFS = [
    { key: 'casual', label: 'Casual', live: true }, { key: 'analyst', label: 'Analyst', live: true },
    { key: 'audio_description', label: 'Audio description', live: false }, { key: 'catch_me_up', label: 'Catch me up', live: false },
    { key: 'half_time', label: 'Half-time explainer', live: false }, { key: 'ticker', label: 'News ticker', live: false },
  ];
  let feeds = {}, lang = 'en', pick = 'casual', simulated = true, first = true;
  const seen = new Set();
  try { const s = localStorage.getItem(KEY); if (s && DEFS.some((d) => d.key === s)) pick = s; } catch (e) { /* storage blocked: the default stands */ }

  const st = document.createElement('style'); st.id = 'mc-feedpick-css';
  st.textContent = '#mc-feeds{border-top:1px solid rgba(140,194,255,.2);padding:6px 10px 8px}'
    + '#mc-feedpick{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 6px}'
    + '#mc-feedpick button{min-height:32px;padding:2px 9px;border-radius:999px;border:1px solid rgba(140,194,255,.35);background:transparent;color:#c9d6f0;font:600 12px system-ui,sans-serif;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:5px}'
    + '#mc-feedpick button[aria-checked=true]{background:#8CC2FF;border-color:#8CC2FF;color:#0B1630}#mc-feedpick button:focus-visible{outline:2px solid #F5B942;outline-offset:2px}'
    + '#mc-feedpick .fp-tag,#mc-feedlines .fp-sim{font:700 12px system-ui,sans-serif;letter-spacing:.02em;text-transform:uppercase;padding:0 4px;border-radius:4px;border:1px solid currentColor;opacity:.9}'
    + '#mc-feedlines{font:12px/1.35 system-ui,sans-serif;color:#e8eefc;min-height:1.35em}#mc-feedlines .fp-sim{color:#F5B942;margin-right:6px}#mc-feedlines ul{list-style:none;margin:0;padding:0;display:grid;gap:4px}'
    + '#mc-feedlines li{display:flex;gap:6px;align-items:baseline;overflow-wrap:anywhere}#mc-feedlines .fp-min{font-weight:700;color:#8CC2FF;flex:none}'
    + '#mc-feedlines .fp-tick{color:#5BD19A;font-weight:700;flex:none}#mc-feedlines .fp-note{margin:4px 0 0;color:#c9d6f0}#mc-feedlines .fp-empty{margin:0;color:#c9d6f0}'
    + '#mc-feedsr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}'
    + 'body.mc-feedlive #mc-two{display:none}'   // the two-voice panel steps aside only while a live feed has lines to show
    // a phone has no height to spare above Talk and Copilot: the picker sits in the card header row and ONE feed line (or its status or the English note) replaces the commentary line
    + '@media (max-width:560px){body:not(.mc-feedon) #mc-feedlines{display:none}#mc-feeds{border-top:0;padding:0 8px 6px}#mc-feedpick{flex:1 1 0;min-width:0;margin:0 6px;flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none}#mc-feedpick button{min-height:44px;flex:none}'
    + '#mcf-head>span,body.mc-feedon #mcf-top{display:none}#mc-feedlines{display:flex;gap:6px;align-items:baseline;white-space:nowrap;overflow:hidden}#mc-feedlines ul{display:block;min-width:48px;flex:1 1 0}#mc-feedlines li:nth-child(n+2){display:none}'
    + '#mc-feedlines li>span:last-child,#mc-feedlines .fp-empty{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#mc-feedlines .fp-empty{flex:1 1 0}#mc-feedlines .fp-note{margin:0;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}#mc-feedlines .fp-sim{flex:none;margin-right:0}}';
  document.head.appendChild(st);

  const box = document.createElement('div'); box.id = 'mc-feeds';
  const grp = document.createElement('div'); grp.id = 'mc-feedpick'; grp.setAttribute('role', 'radiogroup'); grp.setAttribute('aria-label', 'Feed');
  const out = document.createElement('div'); out.id = 'mc-feedlines';
  const sr = document.createElement('div'); sr.id = 'mc-feedsr'; sr.setAttribute('aria-live', 'polite'); sr.setAttribute('role', 'status');   // announces only newly published lines
  box.append(grp, out, sr);
  const head = feed.querySelector('#mcf-head');
  feed.insertBefore(box, head ? head.nextSibling : feed.firstChild);
  // the group moves into the header row on a phone (see the CSS note above)
  const mq = window.matchMedia('(max-width:560px)');
  const seat = () => { if (mq.matches && head) head.insertBefore(grp, head.firstChild); else box.insertBefore(grp, out); };
  if (mq.addEventListener) mq.addEventListener('change', seat); else if (mq.addListener) mq.addListener(seat);

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const def = () => DEFS.find((d) => d.key === pick) || DEFS[0];

  // build the buttons once per defs; later changes update attributes in place so keyboard focus stays on the button
  let built = '';
  const drawPick = () => {
    const sig = DEFS.map((d) => d.key + d.label + d.live).join('|');
    if (sig !== built) {
      built = sig;
      grp.innerHTML = DEFS.map((d) => '<button type="button" role="radio" data-key="' + esc(d.key) + '">' + esc(d.label) + (d.live ? '' : '<span class="fp-tag">Planned</span>') + '</button>').join('');
    }
    grp.querySelectorAll('button').forEach((b) => { const sel = b.dataset.key === pick; b.setAttribute('aria-checked', String(sel)); b.tabIndex = sel ? 0 : -1; });
  };
  const drawLines = () => {
    const d = def();
    let h, lines = [];
    if (!d.live) h = '<p class="fp-empty">Planned: this feed is not built yet</p>';
    else {
      lines = (feeds[d.key] || []).slice(-3).reverse();
      h = (simulated ? '<span class="fp-sim" title="The lines are a fixture, not the live agents">Simulated</span>' : '')
        + (lines.length
          ? '<ul>' + lines.map((l) => '<li><span class="fp-min">' + Math.floor((+l.match_time_ms || 0) / 60000) + "'</span>"
            + (!simulated && l.verdict === 'verified' ? '<span class="fp-tick" role="img" aria-label="Verified" title="Verified: the Verifier recounted this line from the stored events">✓</span>' : '')
            + '<span>' + esc(l.text) + '</span></li>').join('') + '</ul>'
          : '<p class="fp-empty">waiting for a moment</p>');
      if (lang !== 'en') h += '<p class="fp-note" lang="en" title="Showing English: no translated line yet">Showing English: no translated line yet</p>';
    }
    out.innerHTML = h;
    // phone: the default feed (casual) leaves Watch's own commentary line in place; the one-line replacement only follows a feed the viewer picks
    document.body.classList.toggle('mc-feedon', d.key !== 'casual');
    document.body.classList.toggle('mc-feedlive', !!(d.live && lines.length));
  };
  // announce only lines that are new since the last message; the first message just records what is already there
  const announce = () => {
    const fresh = [];
    for (const k of Object.keys(feeds)) for (const l of feeds[k] || []) { const id = k + ':' + l.publication_id; if (!seen.has(id)) { seen.add(id); if (k === pick) fresh.push(l.text); } }
    if (!first && fresh.length) sr.textContent = fresh.join('. ');
    first = false;
  };
  const choose = (key, fromUser) => {
    if (!DEFS.some((d) => d.key === key)) return;
    pick = key;
    if (fromUser) { try { localStorage.setItem(KEY, key); } catch (e) { /* storage blocked */ } }
    drawPick(); drawLines();
    try { window.parent.postMessage({ src: 'matchcast', type: 'crew-feed-pick', key, lang: 'en' }, '*'); } catch (e) { /* no shell */ }
  };
  const focusPick = () => { const nb = grp.querySelector('[aria-checked=true]'); if (nb) nb.focus(); };

  grp.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button[data-key]'); if (b) { choose(b.dataset.key, true); focusPick(); } });
  grp.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = DEFS.findIndex((d) => d.key === pick);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? DEFS.length - 1 : (i + step + DEFS.length) % DEFS.length;
    choose(DEFS[n].key, true); focusPick();
  });

  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (e.source !== window.parent || d.src !== 'matchcast-shell') return;
    if (d.type === 'crew-feeds') {
      if (Array.isArray(d.defs) && d.defs.length) { DEFS = d.defs.map((x) => ({ key: String(x.key), label: String(x.label), live: !!x.live })); if (!DEFS.some((x) => x.key === pick)) pick = DEFS[0].key; }
      simulated = d.simulated !== false;   // anything but an explicit false counts as the fixture
      feeds = d.feeds && typeof d.feeds === 'object' ? d.feeds : {};
      announce(); drawPick(); drawLines();
    } else if (d.type === 'lang') { lang = String(d.lang || 'en'); drawLines(); }
  });

  seat(); drawPick(); drawLines();
  try { window.parent.postMessage({ src: 'matchcast', type: 'crew-feed-pick', key: pick, lang: 'en' }, '*'); } catch (e) { /* no shell */ }   // tells the shell which feed is open and asks it for the lines
  window.__mcFeedPick = { get pick() { return pick; } };
})();
