// ---- unified shell hook: Watch ----
MCS.view = 'watch';
MCS.progress('Loading the stadium and players');
// Pixel ratio of the 3D pass (bloom included). On a high-density screen it draws at ratio 1 (a) from ready until the first verified line
// is on screen, or 20 s, whichever comes first (first-load budget), and (b) whenever the measured frame rate stays low: below 24 fps over
// one 2 s window drops to ratio 1; it returns to the engine's ratio after three 2 s windows (6 s) at 50 fps or better, and a second drop is
// kept for the rest of the session so the picture does not flap. Looks softer, changes nothing else; ratio 1 screens never change.
const MCRes = (() => {
  const LOW = 24, HIGH = 50, WIN = 2000, CALM = 3;
  let base = 0, startup = false, slow = false, timer = 0, drops = 0, calm = 0, w0 = 0, n = 0, raf = 0, last = 0;
  const R = () => { try { return window.__mc.composer.renderer; } catch (e) { return null; } };
  const apply = () => {
    const r = R(); if (!r) return;
    if (!base) base = r.getPixelRatio();
    const k = startup || slow ? 1 : base;
    if (base > 1 && r.getPixelRatio() !== k) { r.setPixelRatio(k); window.__mc.composer.setPixelRatio(k); }
  };
  const feed = (t) => {   // one animation frame at time t (ms)
    if (!w0 || document.hidden || t - w0 > WIN * 2.5) { w0 = t; n = 0; return; }   // first frame, a hidden tab, or a gap (frames do not fire while hidden or offscreen): start the window again
    n++;
    if (t - w0 < WIN) return;
    const fps = n * 1000 / (t - w0); w0 = t; n = 0; last = Math.round(fps);
    if (startup) return;   // first-load jank (shader compile) is not a verdict on the machine
    if (base <= 1) return;   // nothing to drop to (or the pass has not started)
    if (fps < LOW) { calm = 0; if (!slow) { slow = true; drops++; apply(); } }
    else if (slow && drops < 2 && fps >= HIGH && ++calm >= CALM) { slow = false; calm = 0; apply(); }
    else if (fps < HIGH) calm = 0;
  };
  const tick = (t) => { raf = requestAnimationFrame(tick); feed(t); };
  return {
    low() { const r = R(); if (!r || startup) return; if (!base) base = r.getPixelRatio(); if (base <= 1) return; startup = true; apply(); timer = setTimeout(() => MCRes.full(), 20000); if (!raf) raf = requestAnimationFrame(tick); },
    full() { clearTimeout(timer); if (!startup) return; startup = false; apply(); },
    feed, reset() { slow = false; drops = 0; calm = 0; w0 = 0; n = 0; apply(); },   // for tests, which feed their own frame times
    restart() { w0 = 0; n = 0; },
    stop() { cancelAnimationFrame(raf); raf = 0; }, state: () => ({ base, startup, slow, drops, fps: last })
  };
})();
window.__mcRes = MCRes;
document.addEventListener('visibilitychange', () => MCRes.restart());
(() => {
  const Q = new URLSearchParams(location.search);
  const ready = setInterval(() => {
    if (!window.__mc || !players.length || !$('load').hidden || !MCS.clubs.ready) return;
    clearInterval(ready);
    MCRes.low();
    MCS.progress('Setting up the squads and kits');
    if (Q.has('seed')) { MCS.apply(Q); kickOff(); MCS.started(); }
    $('kick').addEventListener('click', () => MCS.started());
    MCS.loop();
    MCS.emit();
  }, 200);
})();

// ---- EXP-3: Match Pulse cards from the agents. The shell posts one card per line (verdict, source, evidence); Watch shows it beside the match.
// A card fades after 12 s; the last 10 stay in a scrollable list. Casual shows the plain line and no chips; every other mode shows the full line with chips.
(() => {
  const st = document.createElement('style');
  st.textContent = '#mcx-box{position:fixed;right:calc(14px + env(safe-area-inset-right,0px));bottom:calc(150px + env(safe-area-inset-bottom,0px));width:min(340px,calc(100% - 28px));z-index:30;display:flex;flex-direction:column;gap:6px;align-items:stretch;pointer-events:none}'
    + '#mcx-box>*{pointer-events:auto}#mcx-live{display:flex;flex-direction:column;gap:6px}'
    + '.mcx-c{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--fan-acc,#8CC2FF);border-radius:10px;padding:8px 10px;font:13px/1.35 var(--f-body);color:var(--ink);transition:opacity .6s}'
    + '.mcx-c.out{opacity:0}.mcx-c.mine{border-left-color:var(--good)}.mcx-c p{margin:0 0 5px}.mcx-r{display:flex;flex-wrap:wrap;gap:5px;align-items:center}'
    + '.mcx-t{font:700 11px var(--f-mono);color:var(--good)}.mcx-t.wait{color:#F5B942}.mcx-ch{font:600 10px var(--f-mono);color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:1px 5px}'
    + '.mcx-ch.fb{color:#F5B942;border-color:rgba(245,185,66,.4)}.mcx-b{font:600 11px var(--f-body);color:var(--ink);background:transparent;border:1px solid var(--line);border-radius:6px;padding:2px 8px;cursor:pointer}'
    + '#mcx-log{max-height:190px;overflow:auto;display:flex;flex-direction:column;gap:6px}#mcx-log[hidden]{display:none}'
    + '.fm-planned{font-size:9px;opacity:.7}.mcx-w{margin-top:6px;border-top:1px solid var(--line);padding-top:6px;font:11px/1.4 var(--f-mono);color:var(--muted)}.mcx-w b{color:var(--ink)}';
  st.textContent += '@media (max-width:560px){button:not(.sw):not(.dk-grab),select,input:not([type=checkbox]),textarea,#px-head{min-height:44px !important;min-width:44px !important}input[type=checkbox]{width:24px;height:24px}label:has(>input[type=checkbox]){display:inline-flex;align-items:center;gap:8px;min-height:44px}}';   // phone: 44 px tap targets
  st.textContent += '#pulse,#visp,#datap,#fan-strip{--panel:rgb(9,13,19)}#px-body .px-row{flex-wrap:wrap;gap:0 8px}#px-ctlv{margin-left:auto}';   // panels fully opaque so player labels do not show through (pass 4; 96 percent in pass 3 still showed a ghost); the control line wraps instead of running into its label (UX review pass 3)
  st.textContent += '@media (max-width:640px){#fan-strip,#fan-metric{display:none !important}}';   // phone: the live stats strip sat under the Match Pulse bar; Match data holds the numbers (UX review, finding 14)
  st.textContent += '#mcf-sound,#mc-trust,#third .tx .k,#cap .h span,#capclk,#visp-s,#visp-box,#visp-x,#visp-b small,#visp-b em,#visp-b .vp-m,#fan-chip i,#fan-strip .fh,#fan-strip span,#px-head span,#px-ball,#px-body .px-k,#mcf-head,#mcf-head span,#mcf-tog,#mcf .src,#mcf .chain,#wxchip,#wxchip span,#mcx-idx,.mcx-ptt-s,.mcx-t,.mcx-ch,.mcx-b,.mcx-w,.mcx-gm,.fm-planned{font-size:12px !important}';   // type floor: 12 px for the HUD text that was 9 to 11 px; the pitch name labels stay small on purpose (UX review pass 6, finding 18)
  st.textContent += '@media (max-width:1100px){#third{display:none !important}}';
  // Watch shares the stage with Broadcast, so its pane is 561 to 1100 px wide on most laptops: the Copilot button centred at the top then lands on the camera chips, so it takes its narrow-pane place at the right, above the bottom cards
  st.textContent += '@media (min-width:561px) and (max-width:1100px){#cpbtn{left:auto !important;transform:none !important;right:14px !important;top:auto !important;bottom:152px !important}}';   // 152 px keeps it above the caption card, which is up to 125 px tall in the right corner   // phone and small laptop: there is no room beside the commentary card, which says the same and used to cover this card
  document.head.appendChild(st);
  // The Live commentary card, the followed-player card and the On-the-ball card all dock bottom left. Keyed on the width of this Watch pane (the frame, which is narrower than the window
  // since Watch and Broadcast share the stage) less a Copilot drawer that opens at its right. They sit side by side instead of one on top of another; the commentary card never covers Match Pulse:
  // it moves right of the Pulse column when there is room, otherwise it shortens its list, and with the Copilot drawer open (which covers that corner or leaves no room) it steps aside until the drawer closes.
  const dock = () => {
    const m = document.getElementById('mcf'), l = document.getElementById('mcf-list'), pu = document.getElementById('pulse');
    const t = document.getElementById('third'), fc = document.getElementById('fan-pcard'), dr = document.getElementById('copilot');
    if (!m) return;
    m.style.clipPath = ''; m.style.pointerEvents = ''; delete m.dataset.dockHidden; const tog = document.getElementById('mcf-tog'); if (tog) tog.removeAttribute('tabindex');
    m.style.left = ''; m.style.width = ''; if (l) l.style.maxHeight = '';
    if (fc) { fc.style.left = ''; fc.style.bottom = ''; fc.style.maxWidth = ''; fc.style.clipPath = ''; fc.inert = false; delete fc.dataset.dockHidden; }
    if (!m.getBoundingClientRect().width) return;
    const phone = innerWidth <= 560, wide = innerWidth > 1100;
    const dRect = dr && !dr.hidden && getComputedStyle(dr).display !== 'none' && dr.getBoundingClientRect().width ? dr.getBoundingClientRect() : null;
    const U = dRect && dRect.left > 8 ? dRect.left : innerWidth;   // the usable width: a side drawer takes the right part
    const hit = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const pr = pu && pu.getBoundingClientRect(), hasP = !!pr && pr.width > 0;
    const onPulse = (r) => hasP && r.top < pr.bottom + 8 && r.left < pr.right;
    const btns = ['cpbtn', 'mcx-talk'].map((id) => document.getElementById(id)).filter((e) => e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width).map((e) => e.getBoundingClientRect()).filter((b) => b.bottom > innerHeight * 0.4);
    const edge = phone ? U - 14 : Math.min(U - 14, ...btns.map((b) => b.left - 12));   // the right limit for the bottom-left cards: the pane's edge, a Copilot drawer, or the Copilot and Talk buttons
    let mr = m.getBoundingClientRect(), hide = false, shifted = false;
    if (!phone) {
      if (onPulse(mr)) {
        // where the card would land: right of Pulse, narrowed (never under 280 px) so it stops short of the Copilot and Talk buttons and the pane's edge
        const avail = edge - (pr.right + 12);
        if (avail >= 280) { m.style.left = Math.round(pr.right + 12) + 'px'; m.style.width = Math.floor(Math.min(mr.width, avail)) - 2 + 'px'; shifted = true; }
        else if (l && !l.hidden) l.style.maxHeight = Math.max(48, Math.floor(innerHeight - 14 - (pr.bottom + 8) - (mr.height - l.getBoundingClientRect().height))) + 'px';
      }
      mr = m.getBoundingClientRect();
      if (hit(mr, dRect) || (dRect && onPulse(mr))) hide = true;
    }
    let fcOn = !!fc && getComputedStyle(fc).display !== 'none' && fc.getBoundingClientRect().width > 0;
    if (fcOn && dRect && !phone) { fc.style.clipPath = 'inset(50%)'; fc.inert = true; fc.dataset.dockHidden = '1'; fcOn = false; }   // the open Copilot shows the followed player in its Talk tab: the corner goes to the commentary card (UX pass 10)
    let fcRight = 0;
    if (fcOn) {
      const f = fc.getBoundingClientRect();
      fc.style.maxWidth = Math.max(240, edge - 14) + 'px';
      if (phone) fc.style.bottom = Math.round(innerHeight - Math.min(mr.top, ...btns.map((b) => b.top)) + 8) + 'px';   // a phone has one column: above the commentary card and the Copilot and Talk buttons
      else {
        fc.style.bottom = '14px';   // the card's own bottom offset depends on the view's height; pin it to the corner so the arithmetic below holds
        if (hide) { /* the card keeps the corner */ }
        else if (mr.right + 12 + f.width <= edge) { fc.style.left = Math.round(mr.right + 12) + 'px'; fcRight = mr.right + 12 + f.width; }
        else if (mr.top - 8 - f.height >= (hasP && !shifted ? pr.bottom + 8 : 8)) { fc.style.left = Math.round(mr.left) + 'px'; fc.style.bottom = Math.round(innerHeight - mr.top + 8) + 'px'; }   // above it, clear of Pulse
        else hide = true;   // no room for both: the player the viewer chose to follow wins, the commentary stays in the caption card
      }
    }
    // say so in the drawer when the commentary card has stepped aside for it (UX pass 10: the booth must not just vanish)
    let note = document.getElementById('mcx-booth-note');
    if (!note && dr) { const tabs = document.getElementById('cp-tabs'); note = document.createElement('p'); note.id = 'mcx-booth-note'; note.hidden = true; note.style.cssText = 'margin:6px 14px;font-size:12px;color:var(--muted,#9fb0c8)'; note.textContent = 'The Live commentary card is hidden while Copilot is open. Close Copilot to see it again.'; if (tabs && tabs.parentNode) tabs.parentNode.insertBefore(note, tabs); else dr.appendChild(note); }
    if (note) note.hidden = !(hide && dRect);
    if (hide) { m.style.clipPath = 'inset(50%)'; m.style.pointerEvents = 'none'; m.dataset.dockHidden = '1'; if (tog) tog.tabIndex = -1; }   // out of sight and out of the tab order, but still in the page, so its live region keeps announcing the lines
    // the caption card (#cap) is centred in the pane and shows for a few seconds: it never sits on the commentary card (which shows the same line) or the followed-player card (it rises above that one)
    const cap = document.getElementById('cap');
    if (cap) {
      cap.style.visibility = ''; if (cap.dataset.dk) { cap.style.bottom = ''; delete cap.dataset.dk; }   // only undo what this function set
      if (!phone && getComputedStyle(cap).display !== 'none' && cap.getBoundingClientRect().width) {
        const c = cap.getBoundingClientRect(), fr = fcOn ? fc.getBoundingClientRect() : null;
        if (!hide && hit(c, m.getBoundingClientRect())) cap.style.visibility = 'hidden';
        else if (hit(c, fr)) { cap.style.bottom = Math.round(innerHeight - fr.top + 8) + 'px'; cap.dataset.dk = '1'; }
      }
    }
    if (t && wide) { t.style.left = Math.round((fcRight || mr.right) + 12) + 'px'; }
  };
  dock(); setInterval(dock, 1000); addEventListener('resize', dock);
  document.addEventListener('click', () => setTimeout(dock, 0), true);
  // UX review pass 8: talking to a player used to start only from a name tag. A visible control sits beside the Copilot button and opens the Copilot Talk tab.
  { const tb = document.createElement('button'); tb.id = 'mcx-talk'; tb.type = 'button';
    tb.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false" style="margin-right:6px;flex:none"><path d="M8 1.5a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0V4A2.5 2.5 0 0 0 8 1.5zM3.5 7.5v.5a4.5 4.5 0 0 0 9 0v-.5h-1.2v.5a3.3 3.3 0 0 1-6.6 0v-.5H3.5zM7.4 12.4h1.2V15H7.4z" fill="currentColor"/></svg>Talk to a player';
    tb.style.cssText = 'position:fixed;z-index:6;display:none;align-items:center;white-space:nowrap;padding:0 14px;border-radius:999px;border:1px solid rgba(140,194,255,.55);background:rgb(9,13,19);color:#fff;font:600 13px var(--f-body,system-ui,sans-serif);cursor:pointer';
    const fs = document.createElement('style'); fs.textContent = '#mcx-talk:focus-visible{outline:2px solid #8CC2FF;outline-offset:2px}'; document.head.appendChild(fs);
    const cp0 = document.getElementById('cpbtn'); if (cp0 && cp0.parentNode) cp0.parentNode.insertBefore(tb, cp0); else document.body.appendChild(tb);   // next to the Copilot button in the tab order too
    const place = () => {   // next to the Copilot button wherever the layout puts it; hidden while the Copilot drawer is open or the button is not shown
      const cp = document.getElementById('cpbtn'), dr = document.getElementById('copilot');
      const r = cp ? cp.getBoundingClientRect() : null;
      if (!r || !r.width || getComputedStyle(cp).visibility === 'hidden' || (dr && !dr.hidden) || typeof window.openTalk !== 'function') { tb.style.display = 'none'; return; }
      tb.style.display = 'inline-flex'; tb.style.height = r.height + 'px';
      const left = Math.round(r.left - tb.offsetWidth - 8);
      if (innerWidth > 560 && innerWidth <= 1100) { tb.style.left = Math.max(8, Math.round(r.right - tb.offsetWidth)) + 'px'; tb.style.top = Math.round(r.top - r.height - 8) + 'px'; }   // the Copilot button sits at the bottom right in this pane: stack the Talk control above it, clear of the caption card
      else if (innerWidth > 560 && innerWidth <= 1200) { tb.style.left = Math.max(8, Math.round(r.right - tb.offsetWidth)) + 'px'; tb.style.top = Math.round(r.bottom + 8) + 'px'; }   // laptop widths: the camera chips already crowd the Copilot button's left, so stack under it
      else if (left >= 8) { tb.style.left = left + 'px'; tb.style.top = r.top + 'px'; }
      else { tb.style.left = Math.max(8, Math.round(r.right - tb.offsetWidth)) + 'px'; tb.style.top = Math.round(r.top - r.height - 8) + 'px'; }   // no room beside it (a very narrow phone, big text): stack above it, never on top of it
    };
    tb.addEventListener('click', () => { if (window.openTalk) window.openTalk(); place(); });
    document.addEventListener('click', () => setTimeout(place, 0), true);   // the drawer opens and closes on clicks; do not wait for the timer on a slow machine
    setInterval(place, 500); addEventListener('resize', place); }
  const box = document.createElement('div'); box.id = 'mcx-box';
  box.innerHTML = '<div id="mcx-live" aria-live="polite"></div><div id="mcx-log" hidden></div><button class="mcx-b" id="mcx-tog" hidden>Pulse log (0)</button>';
  document.body.appendChild(box);
  // the Pulse log sits over the Copilot drawer's Talk input, so it steps aside while the drawer is open
  setInterval(() => { const dr = document.getElementById('copilot'); box.style.display = dr && !dr.hidden ? 'none' : ''; }, 300);
  const live = box.querySelector('#mcx-live'), log = box.querySelector('#mcx-log'), tog = box.querySelector('#mcx-tog');
  const cards = new Map(), esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const mode = () => (typeof FAN !== 'undefined' ? FAN.mode : 'analyst');
  const mine = (c) => mode() === 'club' && FAN.club != null && c.team === TEAMS[FAN.club].key;
  const lang = () => (typeof FAN !== 'undefined' ? FAN.lang : 'en');
  const tr = (c) => lang() !== 'en' && c.tr ? c.tr[lang()] : null;   // any language the api checked; the rest stays English
  const line = (c) => {
    const t = tr(c); if (t && t.ok) return t.text;   // a translation the Verifier re-checked (numbers and names unchanged)
    if (mode() === 'casual') return c.plain;
    if (mode() === 'player' && FAN.player && c.player === FAN.player.name) return FAN.player.name + ': ' + c.text;   // player focus: the line leads with the player
    return c.text;
  };
  const html = (c) => {
    const ok = c.verdict === 'verified', api = c.api || c.source === 'model';   // the agent api wrote it (and its Verifier checked it), or the in-page rules did
    const chips = mode() === 'casual' ? [] : c.chips;
    return '<p>' + esc(line(c)) + '</p><div class="mcx-r"><span class="mcx-t' + (ok ? '' : ' wait') + '" title="' + (ok ? (api ? 'Recounted from the stored events by the server Verifier (agent api)' : 'Recounted by the in-page rules Verifier in this browser, not the server (Simulated)') : 'Awaiting review') + '">' + (ok ? (api ? '✓ API-Verified' : '✓ Verified in page') : '● Awaiting review') + '</span>'
      + chips.map((x) => '<span class="mcx-ch">' + esc(x) + '</span>').join('') + (api ? '' : '<span class="mcx-ch fb" title="Written and checked by the in-page rules in this browser, not the model or the server Verifier (Simulated)">In-page (Simulated)</span>')
      + (tr(c) ? (tr(c).ok ? '<span class="mcx-ch" title="' + (tr(c).api ? 'Translated by Azure AI Translator; ' : 'Translated by rules; ') + 'the Verifier re-checked numbers and names">' + lang() + ' · translated ✓</span>' : '<span class="mcx-ch fb" title="' + esc(tr(c).reason) + '">Translation unavailable</span>') : '') + (lang() === 'en' || tr(c) ? '' : '<span class="mcx-ch fb" title="No checked translation for this line: the English line is shown">English · no checked ' + esc(lang().toUpperCase()) + ' translation</span>') + '<button class="mcx-b" data-why>Why?</button><button class="mcx-b" data-how>How was this made?</button></div><div class="mcx-w" hidden></div>';
  };
  const why = (el, c) => {
    const w = el.querySelector('.mcx-w'); if (!w.hidden) { w.hidden = true; return; }
    w.innerHTML = (c.evidence.length ? c.evidence.map((e) => '<div><b>' + Math.floor(e.minute) + "'</b> " + esc(e.type.replace('_', ' ') + (e.player ? ' · ' + e.player : '') + (e.xg != null ? ' · xG ' + (+e.xg).toFixed(2) : '') + (e.why ? ' · ' + e.why : '')) + '</div>').join('') : 'No cited events.')
      + '<div>Cited events shown; the 3D replay with highlights is Planned.</div>';
    w.hidden = false;
  };
  const draw = (c, host, fade) => {
    let el = cards.get(c.id + host.id);
    if (!el) { el = document.createElement('div'); el.className = 'mcx-c'; el.dataset.id = c.id; host.prepend(el); cards.set(c.id + host.id, el); }
    el.classList.toggle('mine', mine(c)); el.innerHTML = html(c);
    el.querySelector('[data-why]').onclick = () => why(el, c);
    el.querySelector('[data-how]').onclick = () => MCS.send({ type: 'trace', id: c.id });
    if (fade) { clearTimeout(el.t1); el.classList.remove('out'); el.t1 = setTimeout(() => el.classList.add('out'), 11400); clearTimeout(el.t2); el.t2 = setTimeout(() => { el.remove(); cards.delete(c.id + host.id); }, 12000); }
    return el;
  };
  // EXP-5: a typed question goes to the shell, which asks the agents (api when live, else the in-page rules) and sends back a checked answer
  const asks = new Map(); let askN = 0;
  window.mcAsk = (q) => new Promise((res) => { const id = ++askN; asks.set(id, res); MCS.send({ type: 'ask', id, q }); setTimeout(() => { if (asks.delete(id)) res({ text: "I can't confirm that from the match data yet.", verdict: 'abstained', note: 'no answer in time' }); }, 24000); });
  window.addEventListener('message', (e) => { const d = e.data || {}; if (d.src === 'matchcast-shell' && d.type === 'answer' && asks.has(d.id)) { asks.get(d.id)(d.answer); asks.delete(d.id); } });
  // EXP-16: the same words go to the api's player agent through the shell; a reply built from checked facts is added to the chat, anything else is not
  const talks = new Map(); let talkN = 0;
  if (!document.documentElement.lang) document.documentElement.lang = 'en';   // the source head has no lang (WCAG 3.1.1); Watch's own language list changes the text, not this
  window.__mcSetOrder = (p, k) => setOrder(p, k, 'test');   // read by tests (role-clamp.spec.ts)
  // Broadcast's "Go to it" (and anything else that wants Watch's camera): a player by contract id, or a zone, through Watch's own player mode. Returns true only when the camera moved.
  const mcSlug = (v) => String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'x';   // the same slug as live.js
  const MC_ZONES = {   // pitch metres: x along 0 to 105, y across 0 to 68
    box: (p) => (p.pos2.x < 16.5 || p.pos2.x > 88.5) && p.pos2.y > 13.85 && p.pos2.y < 54.15,
    midfield: (p) => p.pos2.x > 35 && p.pos2.x < 70 && !p.gk,
    wide: (p) => (p.pos2.y < 14 || p.pos2.y > 54) && !p.gk,
  };
  window.MCWatch = {
    focus(spec) {
      if (!spec || !players.length || !S.started || $('load').hidden === false) return false;
      let who = null;
      if (spec.player_id) who = players.find((q) => !q.off && mcSlug(q.name) === mcSlug(spec.player_id));
      else if (spec.zone && MC_ZONES[spec.zone]) { const b = bp2(); who = players.filter((q) => !q.off && MC_ZONES[spec.zone](q)).sort((x, y) => x.pos2.distanceTo(b) - y.pos2.distanceTo(b))[0]; }   // the player in the zone nearest the ball
      if (!who) return false;
      fanSet({ mode: 'player', player: who }, 'focus');
      return true;
    },
  };
  window.__mcTalkLog = (p) => (TK.log.get(p) || []).map((m) => m.text);   // read by tests
  // Role bounds for orders (mirrors packages/agents/matchcast_agents/roles/orders.py). Typed lines go to the api, which applies the same table to the position this browser sends. Quick buttons and the rules fallback are checked here only.
  const mcRulesOrder = (p, k, text) => {
    if (!mcAllowed(p.pos, k)) { talkLine(p, 'pl', MC_REFUSAL); speak(p, MC_REFUSAL); renderTalk(); return; }
    setOrder(p, k, text); const r = ruleReply(p, k); talkLine(p, 'pl', r); speak(p, r); renderTalk();
  };
  // the rules reading of a typed line: the same keywords and the same question and negation rules as orders.py
  const MC_RULES = [['clear', /forget|as you were|cancel|\bnormal\b|\breset\b/], ['rest', /\brest\b|\blegs\b|breath|\btired\b|\beasy\b|conserve/], ['shoot', /\bshoot|shot on sight|\btake (a |the |your )?shots?\b|\bstrike\b|hit it|\brange\b/], ['mark', /\bmark|\bfollow\b|\btrack\b|shadow|man.?to.?man/], ['press', /\bpress|\bhunt\b|close down|harass|win (it|the ball) back/], ['runs', /\brun|behind|channel|over the top|\bspace\b/], ['simple', /simple|\bsafe\b|keep (the )?ball|possession|\bcalm\b/], ['wide', /\bwide|width|touchline|stretch/], ['inside', /inside|\btuck|narrow|half.?space|\bcentre\b|\bcenter\b/], ['deep', /\bdeep|\bback\b|\bdrop\b|defend|\bsit\b/], ['push', /\bpush|higher|up the pitch|forward|attack|squeeze/]];
  const MC_NEGATED = /\b(\w+n'?t|do not|stop|never|no need to|not)\b/;
  const mcKeyword = (text) => { const t = text.toLowerCase().replace(/’/g, "'"); if (t.includes('?') || MC_NEGATED.test(t)) return 'none'; const hit = MC_RULES.find(([, re]) => re.test(t)); return hit ? hit[0] : 'none'; };
  const MC_NO_ANSWER = 'I can\'t act on or answer that here: this is the rules fallback (no checked answer from the agent api), which only follows plain orders such as press, mark or shoot.';
  const mcRulesFallback = (p, text) => { const k = mcKeyword(text); if (k === 'none') { talkLine(p, 'pl', MC_NO_ANSWER); renderTalk(); } else mcRulesOrder(p, k, text); $('tk-note').textContent = 'Rules fallback: the agent api did not answer for this match, so orders follow the keyword rules.'; };
  window.mcTalk = (p, text, quick) => (quick ? mcRulesOrder(p, quick, text) : window.mcTalkApi(p, text));   // called by sendToPlayer (build.py) for every line: a quick order is checked here, a typed line goes to the api
  window.mcTalkApi = (p, text) => { const id = ++talkN; talks.set(id, { p, text }); MCS.send({ type: 'talk', id, player: p.name, position: p.pos, utterance: text, call: !!(window.mcCallOn && window.mcCallOn()) }); setTimeout(() => { if (talks.delete(id)) mcRulesFallback(p, text); }, 24000); };
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.src !== 'matchcast-shell' || d.type !== 'talk-reply' || !talks.has(d.id)) return;
    const { p, text } = talks.get(d.id); talks.delete(d.id);
    window.__mcTalkReplies = (window.__mcTalkReplies || 0) + 1;   // read by tests
    const r = d.reply;
    if (r && r.api && r.verdict === 'verified' && r.text && r.facts && Object.keys(r.facts).length) {   // the player's own answer, checked against the match record
      const cap = r.captions || null, spoken = cap && cap.transcript && cap.transcript.text ? cap.transcript : null;
      talkLine(p, 'pl', spoken ? spoken.text : r.text);   // in his own language when the api has a checked transcript (EXP-19), else English
      // the caption in the viewer's language. A dropped translation falls back to English, but only when the line above is not already English
      const shown = spoken ? spoken.lang : 'en';
      if (cap && cap.caption && (cap.caption.text ? cap.caption.lang !== shown : spoken)) {
        const capLang = cap.caption.text ? cap.caption.lang : 'en';
        talkLine(p, 'pl', 'Caption (' + ((window.MC_LANG_NAMES || {})[capLang] || capLang) + '): ' + (cap.caption.text || r.text));
      }
      if (r.order && r.order.accepted) setOrder(p, r.order.key, text);   // the api's role guard passed this order
      renderTalk(); return;
    }
    // the api answered but nothing checked came back: the chat says so, and no order moves
    if (r && r.api) { talkLine(p, 'pl', 'No checked answer: the match record did not confirm that.'); renderTalk(); return; }   // never the unverified reply itself
    mcRulesFallback(p, text);   // no api for this match: the rules answer, inside the same role bounds
  });
  // a quick order the player's role does not allow is greyed out, as the api would refuse it; picking a player follows him with the camera (Watch's player mode)
  const mcRenderTalk = renderTalk;
  let mcFollowed = null;
  renderTalk = function () {
    mcRenderTalk();
    const p = TK.p, qo = $('tk-orders');
    if (p !== mcFollowed) { mcFollowed = p; if (p) fanSet({ mode: 'player', player: p }, 'talk-pick'); }
    if (!p || !qo) return;
    [...qo.querySelectorAll('button')].forEach((b, i) => { const k = Object.keys(ORDERS)[i]; b.disabled = !mcAllowed(p.pos, k); b.title = b.disabled ? 'Outside this player\'s role' : ''; });
  };
  // EXP-16: a label for what orders do (Watch's own mic button already does speech recognition)
  const gm = document.createElement('div'); gm.className = 'mcx-gm'; gm.style.cssText = 'font-size:11px;color:var(--muted);margin-top:4px';
  gm.textContent = 'Game mode: orders change how the simulated match is played. They never change the event record behind the claims.';
  if ($('tk-form')) $('tk-form').after(gm);
  const kept = [];
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.src !== 'matchcast-shell' || d.type !== 'pulse') return;
    const c = d.card, i = kept.findIndex((x) => x.id === c.id);
    if (c && c.verdict === 'verified') MCRes.full();   // the first verified line is up: draw at full sharpness
    if (i >= 0) kept[i] = c; else kept.push(c);
    while (kept.length > 10) { const o = kept.shift(); const el = cards.get(o.id + 'mcx-log'); if (el) el.remove(); cards.delete(o.id + 'mcx-log'); }
    draw(c, live, true); draw(c, log, false);
    tog.hidden = false; tog.textContent = 'Pulse log (' + kept.length + ')';
  });
  tog.onclick = () => { log.hidden = !log.hidden; };
  window.__mcxCards = { kept, redraw: () => { for (const c of kept) { const el = cards.get(c.id + 'mcx-log'); if (el) { el.innerHTML = html(c); el.querySelector('[data-why]').onclick = () => why(el, c); el.querySelector('[data-how]').onclick = () => MCS.send({ type: 'trace', id: c.id }); el.classList.toggle('mine', mine(c)); } } } };
})();

// the One metric picker keys the api follows, and the api name each one sends (personas.WATCH_METRICS names the api side). Any other picker key is Watch's own stat and sends no persona the api accepts.
// Nothing enforces this list against WATCH_METRICS yet: a key may be added here only if the api follows it.
const MC_API_METRICS = ['xg', 'poss'];
const MC_API_NAME = { xg: 'xg', poss: 'possession_share' };

// ---- EXP-4: personalisation. The last watch mode is kept in localStorage and restored; the mode goes to the shell, and so to the api, as the viewer's persona.
(() => {
  const KEY = 'mcx-mode';
  const persona = () => FAN.mode === 'club' ? 'club:' + TEAMS[FAN.club].key : FAN.mode === 'player' && FAN.player ? 'player:' + FAN.player.name : FAN.mode === 'metric' ? 'metric:' + (MC_API_NAME[FAN.metric] || FAN.metric) : FAN.mode;
  const tell = () => { MCS.send({ type: 'persona', persona: persona(), lang: FAN.lang }); if (window.__mcxCards) window.__mcxCards.redraw(); };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ mode: FAN.mode, club: FAN.club, metric: FAN.metric, lang: FAN.lang, player: FAN.player ? FAN.player.name : null })); } catch (e) { /* storage may be blocked */ } };
  const _set = fanSet;
  fanSet = function (o, why) { _set(o, why); save(); tell(); };
  let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }
  const go = setInterval(() => {
    if (!window.__mc || !players.length || !$('load').hidden) return;
    clearInterval(go);
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }   // the shell's Fan / Analyst switch may have written it while Watch loaded
    if (saved && FAN_MODES.some((m) => m[0] === saved.mode)) {
      const p = saved.player ? players.find((q) => q.name === saved.player) : null;
      const metric = saved.mode === 'metric' && !MC_API_METRICS.includes(saved.metric) ? MC_API_METRICS[0] : FAN_METRICS.includes(saved.metric) ? saved.metric : FAN.metric;
      _set({ mode: saved.mode, club: saved.club === 1 ? 1 : 0, metric, lang: window.__shellLang || (FAN_LANGS.some((l) => l[0] === saved.lang) ? saved.lang : 'en'), player: p || FAN.player }, 'restore');
    }
    tell();
  }, 300);
})();

// ---- One metric: the picker marks the metrics the api does not follow as Planned, and a choice of one of them falls back to xG (MC_API_METRICS).
(() => {
  const _pick = fanSet;
  fanSet = function (o, why) {
    const mode = o && o.mode != null ? o.mode : FAN.mode;   // a call that sets only the metric, or only the language, still counts while One metric is on
    if (mode === 'metric' && !MC_API_METRICS.includes((o && o.metric) || FAN.metric)) o = Object.assign({}, o, { metric: MC_API_METRICS[0] });
    _pick(o, why);
  };
  const mark = () => document.querySelectorAll('.fm-k').forEach((b) => {
    const api = MC_API_METRICS.includes(b.dataset.k);
    b.disabled = !api;
    if (!api && !b.querySelector('.fm-planned')) b.insertAdjacentHTML('beforeend', ' <small class="fm-planned">Planned</small>');
  });
  const st = document.createElement('style');
  st.textContent = '.fm-k:disabled{opacity:.55;cursor:not-allowed}';
  document.head.appendChild(st);
  const go = setInterval(() => {
    const pop = document.getElementById('fan-pop'), intro = document.getElementById('fan-intro');
    if (!pop || !intro) return;
    clearInterval(go);
    // the metric row appears when One metric is picked, and redraws on a language change; the pre-kick intro card has its own picker
    const obs = new MutationObserver(mark);
    obs.observe(pop, { childList: true, subtree: true });
    obs.observe(intro, { childList: true, subtree: true });
  }, 300);
})();

// ---- Make it yours: the mode popover says what the viewer is watching in one line. The controls below it set the choice (fanSet); this only reads them back.
(() => {
  const st = document.createElement('style');
  st.textContent = '#fan-pop .fm-now{margin:2px 0 8px;font:600 12px/1.35 var(--f-body,system-ui,sans-serif);color:#8CC2FF}';
  document.head.appendChild(st);
  const shown = (sel) => {
    const e = document.querySelector('#fan-pop ' + sel + '[aria-pressed="true"]');
    if (!e) return '';
    const c = e.cloneNode(true); c.querySelectorAll('.fm-planned').forEach((x) => x.remove());   // a Planned language reads as its name, not "Español Planned"
    return c.textContent.trim();
  };
  const now = () => {
    const mode = document.querySelector('#fan-pop .fm-b[aria-pressed="true"] b');
    const sel = document.querySelector('#fan-pop .fm-sel');
    const parts = [mode ? mode.textContent : ''];
    if (FAN.mode === 'club') parts.push(shown('.fm-c'));
    if (FAN.mode === 'player' && sel && sel.value) parts.push(sel.options[sel.selectedIndex].text.replace(/^\d+ · /, ''));
    if (FAN.mode === 'metric') parts.push(shown('.fm-k'));
    parts.push(shown('.fm-l'));
    return parts.filter(Boolean).join(' · ');
  };
  // the picker redraws its own rows (a mode change adds a row), so the heading and the line are put back each time before they are read
  const ensure = () => {
    const pop = document.getElementById('fan-pop'), head = pop && pop.querySelector('.fm-h');
    if (!head || !head.firstChild) return;
    if (head.firstChild.textContent !== 'Make it yours') head.firstChild.textContent = 'Make it yours';   // written only when it differs, so the childList observer cannot loop
    if (pop.querySelector('.fm-now')) return;
    const line = document.createElement('p'); line.className = 'fm-now'; line.setAttribute('aria-live', 'polite');
    head.after(line);
  };
  const draw = () => { ensure(); const el = document.querySelector('#fan-pop .fm-now'), text = now(); if (el && el.textContent !== text) el.textContent = text; };   // an unchanged line is not rewritten, so aria-live does not re-announce it
  const go = setInterval(() => {
    const pop = document.getElementById('fan-pop');
    if (!pop || !pop.querySelector('.fm-h')) return;
    clearInterval(go);
    draw();
    pop.addEventListener('click', () => setTimeout(draw, 0));   // the picker's handlers run first, then the line reads the new choice
    pop.addEventListener('change', draw);
    // the picker rebuilds the popover on open and on shell messages (childList), and a mode change flips aria-pressed.
    // draw() writes the line only when its text changes, so this observer does not loop on its own writes
    new MutationObserver(draw).observe(pop, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
  }, 300);
})();

// ---- the shell's Fan / Analyst switch (UX review, finding 10) sets Watch's mode; every other mode (club, player, metric) stays in Watch's own picker.
window.addEventListener('message', (e) => {
  const d = e.data || {};
  if (e.source !== window.parent || d.src !== 'matchcast-shell' || d.type !== 'persona-set' || !['casual', 'analyst'].includes(d.mode)) return;
  if (FAN.mode !== d.mode) fanSet({ mode: d.mode }, 'shell');
});

// ---- EXP-2: Watch is the only engine. Four times a second it sends the pitch state (22 players, the ball, score, clock, stats) for the shell to hand to Broadcast.
(() => {
  const r2 = (x) => Math.round(x * 100) / 100;
  // the part of a player's current action (kick, slide, header, dive, ...) that Broadcast needs to draw the same pose
  const actOf = (a) => a ? { type: a.type, kind: a.kind, P: a.P, t: r2(a.t), dur: a.dur, strikeAt: a.strikeAt, struck: !!a.struck, foot: a.foot, curl: a.curl, side: a.side, high: !!a.high, h: a.h, style: a.style, move: a.move, lofted: !!(a.plan && a.plan.lofted) } : 0;
  setInterval(() => {
    if (!MCS.framed || !S.started || !players.length) return;
    MCS.send({ type: 'frame', setup: MCS.setup(), frame: { mclock: S.mclock, half: S.half, ht: !!S.ht, over: !!S.over, paused: !!S.paused, speed: S.speed, mscale: S.mscale, score: S.score.slice(), stats: JSON.parse(JSON.stringify(STATS)),
      ball: [r2(ball.p.x), r2(ball.p.y), r2(ball.p.z)], players: players.map((p) => [r2(p.pos2.x), r2(p.pos2.y), r2(p.vel.x), r2(p.vel.y), r2(p.yaw), actOf(p.act)]),
      officials: officials.map((o) => [r2(o.pos2.x), r2(o.pos2.y), r2(o.vel.x), r2(o.vel.y), r2(o.yaw), o.act ? { type: o.act.type, t: r2(o.act.t), dur: o.act.dur, dir: o.act.dir ? { x: r2(o.act.dir.x), y: r2(o.act.dir.y) } : null, up: o.act.up || 0 } : 0]) } });   // referee and assistants: position and their current signal or flag
  }, 250);
})();

// ---- DAT-11: the Vision tracker's accuracy report goes to the shell every 5 s while Vision is on (and once when it is turned off),
// and the Analyst's Tracking lab shows it. The tracker reads pixels only; the report is the scorer's comparison with engine truth.
(() => {
  let wasOn = false;
  setInterval(() => {
    if (typeof visReport !== 'function' || typeof VIS === 'undefined') return;
    if (!VIS.on && !wasOn) return;
    wasOn = VIS.on;
    MCS.send({ type: 'vision', report: Object.assign(visReport(), { ocr: window.mcOcrStats ? window.mcOcrStats() : null }) });
  }, 5000);
})();

// ---- EXP-16: talk-to-player push-to-talk on the shell's Azure Speech (window.parent.SPX) when the api has issued a token; otherwise Watch's own browser mic runs unchanged.
(() => {
  const mic = document.getElementById('tk-mic'), orig = mic && mic.onclick;
  let az = null; try { az = window.parent !== window && window.parent.SPX && typeof window.parent.SPX.listen === 'function' ? window.parent.SPX : null; } catch (e) { /* cross-origin parent */ }
  if (!mic || !az || !orig) return;
  mic.hidden = false; mic.title = 'Talk to the player (Azure Speech if the api has a Speech resource, otherwise the browser mic)';
  let busy = false;
  mic.addEventListener('click', (e) => {
    if (TK.rec) return;   // a browser recognition is running: the original handler stops it
    e.stopImmediatePropagation();
    if (busy) return;
    busy = true; mic.classList.add('live'); document.getElementById('tk-q').placeholder = 'Listening…';
    az.listen(window.MC_SPEECH_LOCALE[FAN.lang] || 'en-US').then((text) => {
      busy = false; mic.classList.remove('live'); document.getElementById('tk-q').placeholder = 'Talk to the player…';
      if (text) { document.getElementById('tk-q').value = text.slice(0, 300); document.getElementById('tk-form').requestSubmit(); return; }
      if (text === null && (window.SpeechRecognition || window.webkitSpeechRecognition)) orig.call(mic);   // Azure unavailable: the browser mic
      else document.getElementById('tk-note').textContent = 'Could not hear that. Try again or type.';
    });
  }, true);
})();

// ---- EXP-18: Talk call. Call keeps the mic open: each finished phrase is sent as a talk, the player's checked reply plays in his
// own voice, and the fan can cut in, which stops it. The transcript stays on screen. Azure Speech when the api has a Speech
// resource; otherwise the browser's speech recognition, labelled as Simulated.
(() => {
  const mic = document.getElementById('tk-mic'), q = document.getElementById('tk-q'), form = document.getElementById('tk-form');
  if (!mic || !q || !form || !mic.parentNode) return;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'tk-call'; btn.textContent = 'Call'; btn.setAttribute('aria-pressed', 'false');
  btn.title = 'Start a voice call: the player listens, answers in his own voice, and stops when you cut in';
  btn.style.cssText = 'font:600 12px var(--f-body,system-ui,sans-serif);padding:0 10px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer;white-space:nowrap';
  mic.parentNode.insertBefore(btn, mic);
  // the shell opens the call (its socket, the fan's mic and the player's voice); Watch shows the state and the fan's finished phrases
  let on = false;
  const say = (t) => { const n = document.getElementById('tk-note'); if (n) n.textContent = t; };
  const paint = (live) => { on = live; btn.textContent = live ? 'End call' : 'Call'; btn.setAttribute('aria-pressed', String(live)); q.placeholder = live ? 'Listening…' : 'Talk to the player…'; };
  window.mcCallOn = () => on;
  btn.addEventListener('click', () => { const next = !on; paint(next); MCS.send({ type: 'call', on: next }); say(next ? 'Calling…' : 'Call ended.'); });
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (e.source !== window.parent || d.src !== 'matchcast-shell') return;
    if (d.type === 'call-state') { paint(!!d.on); if (d.note) say(d.note); }
    else if (d.type === 'call-said' && on && d.text) { q.value = String(d.text).slice(0, 300); form.requestSubmit(); }
  });
})();

// ---- EXP-17: the shell's language selector (MC_LANGS, ADR-0023) sets Watch's language too; Watch's own picker keeps the rest.
window.addEventListener('message', (e) => {
  const d = e.data || {};
  if (e.source !== window.parent || d.src !== 'matchcast-shell' || d.type !== 'lang' || !window.MC_LANGS.includes(d.lang)) return;
  // kept as the shell's language, so Watch's persona echo never sends English back; a line with no checked translation says so on its card
  window.__shellLang = d.lang;   // the restore of Watch's saved settings below must not undo it
  if (FAN.lang !== d.lang) fanSet({ lang: d.lang }, 'shell');
});
