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
  const lang = () => (typeof FAN !== 'undefined' ? FAN.lang : 'en');
  const tr = (c) => (lang() === 'es' || lang() === 'hi') && c.tr ? c.tr[lang()] : null;
  const line = (c) => {
    const t = tr(c); if (t && t.ok) return t.text;   // a translation the Verifier re-checked (numbers and names unchanged)
    if (mode() === 'casual') return c.plain;
    if (mode() === 'player' && FAN.player && c.player === FAN.player.name) return FAN.player.name + ': ' + c.text;   // player focus: the line leads with the player
    return c.text;
  };
  const html = (c) => {
    const ok = c.verdict === 'verified';
    const chips = mode() === 'casual' ? [] : c.chips;
    return '<p>' + esc(line(c)) + '</p><div class="mcx-r"><span class="mcx-t' + (ok ? '' : ' wait') + '" title="' + (ok ? 'Verified: recounted from the event log' : 'Awaiting review') + '">' + (ok ? '✓ Verified' : '● Awaiting review') + '</span>'
      + chips.map((x) => '<span class="mcx-ch">' + esc(x) + '</span>').join('') + (c.source === 'rules' ? '<span class="mcx-ch fb" title="Written by the in-page rules, not the model">Rules fallback</span>' : '')
      + (tr(c) ? (tr(c).ok ? '<span class="mcx-ch" title="' + (tr(c).api ? 'Translated by Azure AI Translator; ' : 'Translated by rules; ') + 'the Verifier re-checked numbers and names">' + lang() + ' · translated ✓</span>' : '<span class="mcx-ch fb" title="' + esc(tr(c).reason) + '">Translation unavailable</span>') : '') + '<button class="mcx-b" data-why>Why?</button><button class="mcx-b" data-how>How was this made?</button></div><div class="mcx-w" hidden></div>';
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
  window.mcAsk = (q) => new Promise((res) => { const id = ++askN; asks.set(id, res); MCS.send({ type: 'ask', id, q }); setTimeout(() => { if (asks.delete(id)) res({ text: "I can't confirm that from the match data yet.", verdict: 'abstained', note: 'no answer in time' }); }, 9000); });
  window.addEventListener('message', (e) => { const d = e.data || {}; if (d.src === 'matchcast-shell' && d.type === 'answer' && asks.has(d.id)) { asks.get(d.id)(d.answer); asks.delete(d.id); } });
  // EXP-16: a label for what orders do (Watch's own mic button already does speech recognition)
  const gm = document.createElement('div'); gm.className = 'mcx-gm'; gm.style.cssText = 'font-size:11px;color:var(--muted);margin-top:4px';
  gm.textContent = 'Game mode: orders change how the simulated match is played. They never change the event record behind the claims.';
  if ($('tk-form')) $('tk-form').after(gm);
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
  const tell = () => { MCS.send({ type: 'persona', persona: persona(), lang: FAN.lang }); if (window.__mcxCards) window.__mcxCards.redraw(); };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ mode: FAN.mode, club: FAN.club, metric: FAN.metric, lang: FAN.lang, player: FAN.player ? FAN.player.name : null })); } catch (e) { /* storage may be blocked */ } };
  const _set = fanSet;
  fanSet = function (o, why) { _set(o, why); save(); tell(); };
  let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }
  const go = setInterval(() => {
    if (!window.__mc || !players.length || !$('load').hidden) return;
    clearInterval(go);
    if (saved && FAN_MODES.some((m) => m[0] === saved.mode)) {
      const p = saved.player ? players.find((q) => q.name === saved.player) : null;
      _set({ mode: saved.mode, club: saved.club === 1 ? 1 : 0, metric: FAN_METRICS.includes(saved.metric) ? saved.metric : FAN.metric, lang: window.__shellLang || (FAN_LANGS.some((l) => l[0] === saved.lang) ? saved.lang : 'en'), player: p || FAN.player }, 'restore');
    }
    tell();
  }, 300);
})();

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
    az.listen(FAN.lang === 'es' ? 'es-ES' : FAN.lang === 'hi' ? 'hi-IN' : 'en-US').then((text) => {
      busy = false; mic.classList.remove('live'); document.getElementById('tk-q').placeholder = 'Talk to the player…';
      if (text) { document.getElementById('tk-q').value = text.slice(0, 300); document.getElementById('tk-form').requestSubmit(); return; }
      if (text === null && (window.SpeechRecognition || window.webkitSpeechRecognition)) orig.call(mic);   // Azure unavailable: the browser mic
      else document.getElementById('tk-note').textContent = 'Could not hear that. Try again or type.';
    });
  }, true);
})();

// ---- EXP-17: the shell's language selector (EN, ES, HI) sets Watch's language too; Watch's own picker keeps the others (Tamil, French, Arabic).
window.addEventListener('message', (e) => {
  const d = e.data || {};
  if (e.source !== window.parent || d.src !== 'matchcast-shell' || d.type !== 'lang' || !['en', 'es', 'hi'].includes(d.lang)) return;
  window.__shellLang = d.lang;   // the restore of Watch's saved settings below must not undo it
  if (FAN.lang !== d.lang) fanSet({ lang: d.lang }, 'shell');
});
