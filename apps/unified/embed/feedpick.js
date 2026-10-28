// ---- Watch: the crew feed picker (AB#450, default on, ?crew=0 turns it off). Runs in the Watch module after twofans.js. ----
// A radiogroup in the commentary card chooses which crew feed to read. All six feeds are live; a feed with no lines yet says it is waiting.
// Watch is an iframe, so the lines come from the shell's CREW data layer over postMessage: the shell posts {src:'matchcast-shell', type:'crew-feeds', lang, simulated, feeds, defs}
// and this module posts {src:'matchcast', type:'crew-feed-pick', key, lang}. Honesty: while simulated is true the lines are the fixture, labelled Simulated and carrying NO Verifier tick.
// A tick shows only on a line that carries verdict 'verified' from a real frame. English only today.
// catch_me_up (CREW-7.3) arrives as ONE record with the whole recap, not per line, so it has its own block (drawCatch). The shell reads GET /v1/matches/{id}/catch-me-up only when this picker
// posts crew-feed-pick with key catch_me_up (a pick, a re-pick or Update), and answers {src:'matchcast-shell', type:'crew-catchup', state, ...}: ok (text, minute, word_count, events),
// held (404: not an error), limited (429), error, none (no api or match yet) or loading. The recap is set with textContent; 'Verified: recounted from N events' shows only when the route returned its source events.
// Planned: half_time arrives the same way and needs the same block when it goes live.
(() => {
  const feed = document.getElementById('mcf');
  if (!feed || document.getElementById('bc-view') || document.getElementById('mc-feedpick')) return;
  let qs = location.search;   // the page's own query first; the parent's is appended in its own try (same lines as crew.js)
  try { if (window.parent !== window) qs += '&' + window.parent.location.search; } catch (e) { /* cross-origin parent */ }
  let on = !/[?&]crew=0(&|$)/.test(qs);   // default on; ?crew=0 or localStorage mc-crew=0 turns it off, an explicit crew=1 beats a stored 0
  try { if (on && !/[?&]crew=1(&|$)/.test(qs) && localStorage.getItem('mc-crew') === '0') on = false; } catch (e) { /* storage blocked */ }
  if (!on) return;

  const KEY = 'mc-feedpick';
  let DEFS = [
    { key: 'casual', label: 'Casual', live: true }, { key: 'analyst', label: 'Analyst', live: true },
    { key: 'audio_description', label: 'Audio description', live: true }, { key: 'catch_me_up', label: 'Catch me up', live: true },
    { key: 'half_time', label: 'Half-time explainer', live: true }, { key: 'ticker', label: 'News ticker', live: true },
  ];
  let feeds = {}, lang = 'en', pick = 'casual', simulated = true, first = true;
  let cu = { state: 'idle' }, cuLast = null;   // the catch-me-up answer, and the last good recap (kept while a refresh is loading, busy or failed)
  const seen = new Set();
  // a saved Planned feed is not restored: it cannot be chosen (AB#373)
  try { const s = localStorage.getItem(KEY); if (s && DEFS.some((d) => d.key === s && d.live)) pick = s; } catch (e) { /* storage blocked: the default stands */ }

  const st = document.createElement('style'); st.id = 'mc-feedpick-css';
  st.textContent = '#mc-feeds{border-top:1px solid rgba(140,194,255,.2);padding:6px 10px 8px}'
    + '#mc-feedpick{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 6px}'
    + '#mc-feedpick button{min-height:32px;padding:2px 9px;border-radius:999px;border:1px solid rgba(140,194,255,.35);background:transparent;color:#c9d6f0;font:600 12px system-ui,sans-serif;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:5px}'
    + '#mc-feedpick button[aria-checked=true]{background:#8CC2FF;border-color:#8CC2FF;color:#0B1630}#mc-feedpick button:focus-visible{outline:2px solid #F5B942;outline-offset:2px}'
    + '#mc-feedpick button:disabled{opacity:.55;cursor:not-allowed}'
    + '#mc-feedpick .fp-tag,#mc-feedlines .fp-sim{font:700 12px system-ui,sans-serif;letter-spacing:.02em;text-transform:uppercase;padding:0 4px;border-radius:4px;border:1px solid currentColor;opacity:.9}'
    + '#mc-feedlines{font:12px/1.35 system-ui,sans-serif;color:#e8eefc;min-height:1.35em}#mc-feedlines .fp-sim{color:#F5B942;margin-right:6px}#mc-feedlines ul{list-style:none;margin:0;padding:0;display:grid;gap:4px}'
    + '#mc-feedlines li{display:flex;gap:6px;align-items:baseline;overflow-wrap:anywhere}#mc-feedlines .fp-min{font-weight:700;color:#8CC2FF;flex:none}'
    + '#mc-feedlines .fp-tick{color:#5BD19A;font-weight:700;flex:none}#mc-feedlines .fp-note{margin:4px 0 0;color:#c9d6f0}#mc-feedlines .fp-empty{margin:0;color:#c9d6f0}'
    + '#mc-feedlines .fp-cu-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:12em;overflow-y:auto}#mc-feedlines .fp-cu-text:focus-visible{outline:2px solid #F5B942;outline-offset:2px}#mc-feedlines .fp-cu-meta{margin:4px 0 0;color:#c9d6f0;display:flex;flex-wrap:wrap;gap:2px 10px}#mc-feedlines .fp-verified{color:#5BD19A;font-weight:700}'
    + '#mc-feedlines .fp-cu-btn{margin-top:6px;min-height:32px;padding:2px 10px;border-radius:999px;border:1px solid rgba(140,194,255,.35);background:transparent;color:#c9d6f0;font:600 12px system-ui,sans-serif;cursor:pointer}#mc-feedlines .fp-cu-btn:focus-visible{outline:2px solid #F5B942;outline-offset:2px}'
    + '#mc-feedsr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}'
    + 'body.mc-feedlive #mc-two{display:none}'   // the two-voice panel steps aside only while a live feed has lines to show
    // a phone has no height to spare above Talk and Copilot: the picker sits in the card header row and ONE feed line (or its status or the English note) replaces the commentary line
    + '@media (max-width:560px){body:not(.mc-feedon) #mc-feedlines{display:none}#mc-feeds{border-top:0;padding:0 8px 6px}#mc-feedpick{flex:1 1 0;min-width:0;margin:0 6px;flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none}#mc-feedpick button{min-height:44px;flex:none}'
    + '#mcf-head>span,body.mc-feedon #mcf-top{display:none}#mc-feedlines{display:flex;gap:6px;align-items:baseline;white-space:nowrap;overflow:hidden}#mc-feedlines ul{display:block;min-width:48px;flex:1 1 0}#mc-feedlines li:nth-child(n+2){display:none}'
    + '#mc-feedlines li>span:last-child,#mc-feedlines .fp-empty{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#mc-feedlines .fp-empty{flex:1 1 0}#mc-feedlines .fp-note{margin:0;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}#mc-feedlines .fp-sim{flex:none;margin-right:0}'
    + '#mc-feedlines.fp-block{display:block;white-space:normal;overflow:visible}#mc-feedlines .fp-cu-text{max-height:5.4em;overflow-y:auto}#mc-feedlines .fp-cu-btn{min-height:44px}}';
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

  // the catch-me-up block: built once and updated in place, so the Update button keeps keyboard focus across answers
  const cuBox = document.createElement('div'); cuBox.className = 'fp-cu';
  const cuNote = document.createElement('p'); cuNote.className = 'fp-empty fp-cu-note';
  const cuText = document.createElement('p'); cuText.className = 'fp-cu-text';
  cuText.tabIndex = 0; cuText.setAttribute('role', 'region'); cuText.setAttribute('aria-label', 'Catch me up recap');   // a scrollable region must be reachable and named for keyboard users
  const cuMeta = document.createElement('p'); cuMeta.className = 'fp-cu-meta';
  const cuBtn = document.createElement('button'); cuBtn.type = 'button'; cuBtn.className = 'fp-cu-btn'; cuBtn.textContent = 'Update to now';
  cuBox.append(cuNote, cuText, cuMeta, cuBtn);
  const span = (cls, text) => { const e = document.createElement('span'); if (cls) e.className = cls; e.textContent = text; return e; };
  const CU_NOTE = {
    loading: 'Catching you up…', idle: 'Catching you up…',
    held: 'No catch-me-up for this moment yet. Try Update in a little while.',   // 404: held (a correction, a desk pause or a recap that did not recount), neutral on purpose
    limited: 'Catch me up is busy. Try again in a minute.',
    error: "Couldn't load the recap. Try Update again.",
    none: 'Catch me up needs the live match and the agent api, which are not connected yet.',
  };
  const drawCatch = () => {
    const ok = cu.state === 'ok', shown = ok ? cu : (cu.state === 'loading' || cu.state === 'limited' || cu.state === 'error') ? cuLast : null;   // a held recap is never shown again: a correction may have changed it
    cuNote.textContent = ok ? '' : CU_NOTE[cu.state] || CU_NOTE.error; cuNote.hidden = ok;
    cuText.hidden = cuMeta.hidden = !shown;
    if (shown) {
      // the translation only when the route returned a checked one for the language the viewer asked in (shown.translated); the English recap otherwise
      cuText.textContent = shown.translated || shown.text; cuText.lang = shown.translated ? shown.lang : 'en';
      const parts = [span('fp-cu-min', 'As of ' + shown.minute + "'")];
      if (shown.translated) parts.push(span('fp-cu-lang', 'Translated: ' + ((window.MC_LANG_NAMES && window.MC_LANG_NAMES[shown.lang]) || shown.lang)));
      else if (shown.word_count != null) parts.push(span('', shown.word_count + (shown.word_count === 1 ? ' word' : ' words')));
      if (shown.events > 0) parts.push(span('fp-verified', (shown.translated ? 'English recap recounted from ' : 'Verified: recounted from ') + shown.events + (shown.events === 1 ? ' event' : ' events')));   // real: the route returned its source_event_ids, which are the English recap's; a translation is re-checked separately
      cuMeta.replaceChildren(...parts);
    }
    cuBtn.hidden = cu.state === 'none';
    cuBtn.setAttribute('aria-busy', String(cu.state === 'loading'));
    if (ok && cu.lang !== 'en' && !cu.translated) { cuNote.hidden = false; cuNote.textContent = 'Showing English: no checked translation of this recap'; }   // the route sent no variants[lang]: say so, claim nothing
  };

  // build the buttons once per defs; later changes update attributes in place so keyboard focus stays on the button
  let built = '';
  const drawPick = () => {
    const sig = DEFS.map((d) => d.key + d.label + d.live).join('|');
    if (sig !== built) {
      built = sig;
      // a Planned feed is listed but cannot be chosen: it must not look like a running control (AB#373)
      grp.innerHTML = DEFS.map((d) => '<button type="button" role="radio" data-key="' + esc(d.key) + '"' + (d.live ? '' : ' disabled aria-disabled="true"') + '>' + esc(d.label) + (d.live ? '' : '<span class="fp-tag">Planned</span>') + '</button>').join('');
    }
    grp.querySelectorAll('button').forEach((b) => { const sel = b.dataset.key === pick; b.setAttribute('aria-checked', String(sel)); b.tabIndex = sel ? 0 : -1; });
  };
  const drawLines = () => {
    const d = def();
    let h, lines = [];
    const block = d.live && d.key === 'catch_me_up';
    out.classList.toggle('fp-block', block);
    if (block) {
      drawCatch();
      if (cuBox.parentNode !== out) out.replaceChildren(cuBox);
      document.body.classList.add('mc-feedon'); document.body.classList.remove('mc-feedlive');
      return;
    }
    if (!d.live) h = '<p class="fp-empty">Planned: this feed is not built yet</p>';
    else {
      lines = (feeds[d.key] || []).slice(-3).reverse();
      h = (simulated && lines.length ? '<span class="fp-sim" title="The lines are a fixture, not the live agents">Simulated</span>' : '')
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
  const postPick = (key) => { try { window.parent.postMessage({ src: 'matchcast', type: 'crew-feed-pick', key, lang: 'en' }, '*'); } catch (e) { /* no shell */ } };
  const choose = (key, fromUser) => {
    if (!DEFS.some((d) => d.key === key && d.live)) return;   // a Planned feed cannot be chosen
    pick = key;
    if (fromUser) { try { localStorage.setItem(KEY, key); } catch (e) { /* storage blocked */ } }
    if (key === 'catch_me_up' && def().live) cu = { state: 'loading' };   // the shell reads the route for this pick (a re-pick is throttled there)
    drawPick(); drawLines();
    postPick(key);
  };
  cuBtn.addEventListener('click', () => { cu = { state: 'loading' }; drawLines(); postPick('catch_me_up'); });
  const focusPick = () => { const nb = grp.querySelector('[aria-checked=true]'); if (nb) nb.focus(); };

  grp.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button[data-key]'); if (b) { choose(b.dataset.key, true); focusPick(); } });
  grp.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    // a Planned feed is disabled, so the keys step over it and End lands on the last live feed (AB#373)
    const live = DEFS.map((d, k) => (d.live ? k : -1)).filter((k) => k >= 0);
    if (!live.length) return;
    const at = live.indexOf(DEFS.findIndex((d) => d.key === pick));
    const pos = e.key === 'Home' ? 0 : e.key === 'End' ? live.length - 1 : (at + step + live.length) % live.length;
    choose(DEFS[live[pos]].key, true); focusPick();
  });

  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (e.source !== window.parent || d.src !== 'matchcast-shell') return;
    if (d.type === 'crew-feeds') {
      if (Array.isArray(d.defs) && d.defs.length) { DEFS = d.defs.map((x) => ({ key: String(x.key), label: String(x.label), live: !!x.live })); const fl = DEFS.find((x) => x.live); if (!DEFS.some((x) => x.key === pick && x.live)) { pick = (fl || DEFS[0]).key; postPick(pick); } }
      simulated = d.simulated !== false;   // anything but an explicit false counts as the fixture
      feeds = d.feeds && typeof d.feeds === 'object' ? d.feeds : {};
      announce(); drawPick(); drawLines();
    } else if (d.type === 'lang') { lang = String(d.lang || 'en'); drawLines(); }
    else if (d.type === 'crew-catchup') {
      const st = String(d.state);
      if (!CU_NOTE[st] && st !== 'ok') return;
      if (st === 'ok' && typeof d.text === 'string' && d.text) {
        const rl = typeof d.lang === 'string' && d.lang ? d.lang : 'en';
        cu = { state: 'ok', text: d.text, lang: rl, translated: rl !== 'en' && typeof d.translated === 'string' && d.translated ? d.translated : null, minute: Math.max(0, Math.min(200, Math.floor(+d.minute) || 0)), word_count: Number.isFinite(+d.word_count) && d.word_count != null ? Math.max(0, Math.floor(+d.word_count)) : null, events: Number.isFinite(+d.events) && d.events != null ? Math.max(0, Math.floor(+d.events)) : null };
        cuLast = cu;
      } else cu = { state: st === 'ok' ? 'error' : st };
      drawLines();
      if (pick === 'catch_me_up') sr.textContent = cu.state === 'ok' ? 'Catch me up is ready, as of minute ' + cu.minute + '.' : CU_NOTE[cu.state];
    }
  });

  seat(); drawPick(); drawLines();
  postPick(pick);   // tells the shell which feed is open and asks it for the lines
  window.__mcFeedPick = { get pick() { return pick; } };
})();
