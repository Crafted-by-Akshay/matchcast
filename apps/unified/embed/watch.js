// ---- unified shell hook: Watch ----
MCS.view = 'watch';
MCS.progress('Loading the stadium and players');
(() => {
  const Q = new URLSearchParams(location.search);
  const ready = setInterval(() => {
    if (!window.__mc || !players.length || !$('load').hidden || !MCS.clubs.ready) return;
    clearInterval(ready);
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
  document.head.appendChild(st);
  const box = document.createElement('div'); box.id = 'mcx-box';
  box.innerHTML = '<div id="mcx-live" aria-live="polite"></div><div id="mcx-log" hidden></div><button class="mcx-b" id="mcx-tog" hidden>Pulse log (0)</button>';
  document.body.appendChild(box);
  const live = box.querySelector('#mcx-live'), log = box.querySelector('#mcx-log'), tog = box.querySelector('#mcx-tog');
  const cards = new Map(), esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const mode = () => (typeof FAN !== 'undefined' ? FAN.mode : 'analyst');
  const mine = (c) => mode() === 'club' && FAN.club != null && c.team === TEAMS[FAN.club].key;
  const line = (c) => {
    if (mode() === 'casual') return c.plain;
    if (mode() === 'player' && FAN.player && c.player === FAN.player.name) return FAN.player.name + ': ' + c.text;   // player focus: the line leads with the player
    return c.text;
  };
  const html = (c) => {
    const ok = c.verdict === 'verified';
    const chips = mode() === 'casual' ? [] : c.chips;
    return '<p>' + esc(line(c)) + '</p><div class="mcx-r"><span class="mcx-t' + (ok ? '' : ' wait') + '" title="' + (ok ? 'Verified: recounted from the event log' : 'Awaiting review') + '">' + (ok ? '✓ Verified' : '● Awaiting review') + '</span>'
      + chips.map((x) => '<span class="mcx-ch">' + esc(x) + '</span>').join('') + (c.source === 'rules' ? '<span class="mcx-ch fb" title="Written by the in-page rules, not the model">Rules fallback</span>' : '')
      + '<button class="mcx-b" data-why>Why?</button><button class="mcx-b" data-how>How was this made?</button></div><div class="mcx-w" hidden></div>';
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
  const kept = [];
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.src !== 'matchcast-shell' || d.type !== 'pulse') return;
    const c = d.card, i = kept.findIndex((x) => x.id === c.id);
    if (i >= 0) kept[i] = c; else kept.push(c);
    while (kept.length > 10) { const o = kept.shift(); const el = cards.get(o.id + 'mcx-log'); if (el) el.remove(); cards.delete(o.id + 'mcx-log'); }
    draw(c, live, true); draw(c, log, false);
    tog.hidden = false; tog.textContent = 'Pulse log (' + kept.length + ')';
  });
  tog.onclick = () => { log.hidden = !log.hidden; };
  window.__mcxCards = { kept, redraw: () => { for (const c of kept) { const el = cards.get(c.id + 'mcx-log'); if (el) { el.innerHTML = html(c); el.querySelector('[data-why]').onclick = () => why(el, c); el.querySelector('[data-how]').onclick = () => MCS.send({ type: 'trace', id: c.id }); el.classList.toggle('mine', mine(c)); } } } };
})();

// ---- EXP-4: personalisation. The last watch mode is kept in localStorage and restored; the mode goes to the shell, and so to the api, as the viewer's persona.
(() => {
  const KEY = 'mcx-mode';
  const persona = () => FAN.mode === 'club' ? 'club:' + TEAMS[FAN.club].key : FAN.mode === 'player' && FAN.player ? 'player:' + FAN.player.name : FAN.mode === 'metric' ? 'metric:' + FAN.metric : FAN.mode;
  const tell = () => { MCS.send({ type: 'persona', persona: persona() }); if (window.__mcxCards) window.__mcxCards.redraw(); };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ mode: FAN.mode, club: FAN.club, metric: FAN.metric, lang: FAN.lang, player: FAN.player ? FAN.player.name : null })); } catch (e) { /* storage may be blocked */ } };
  const _set = fanSet;
  fanSet = function (o, why) { _set(o, why); save(); tell(); };
  let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }
  const go = setInterval(() => {
    if (!window.__mc || !players.length || !$('load').hidden) return;
    clearInterval(go);
    if (saved && FAN_MODES.some((m) => m[0] === saved.mode)) {
      const p = saved.player ? players.find((q) => q.name === saved.player) : null;
      _set({ mode: saved.mode, club: saved.club === 1 ? 1 : 0, metric: FAN_METRICS.includes(saved.metric) ? saved.metric : FAN.metric, lang: FAN_LANGS.some((l) => l[0] === saved.lang) ? saved.lang : 'en', player: p || FAN.player }, 'restore');
    }
    tell();
  }, 300);
})();
