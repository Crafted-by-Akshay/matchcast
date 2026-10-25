// ---- unified shell hook (generated into the view by unified/build.py; runs in the view's own module) ----
// The shell passes the match as URL parameters and hears back on each start, tick and full time.
// Without a shell (window.parent === window) the view runs as it always did.
const MCS = (() => {
  const framed = window.parent !== window;
  const send = (msg) => { if (framed) window.parent.postMessage(Object.assign({ src: 'matchcast', view: MCS.view }, msg), '*'); };
  const setup = () => ({ h: TEAMS[0].key, a: TEAMS[1].key, seed: SET.seed, st: STADIUMS.indexOf(SET.st), month: SET.month, kick: SET.kickStr, half: SET.half,
    f0: resolvedTac(0).form, s0: resolvedTac(0).style, f1: resolvedTac(1).form, s1: resolvedTac(1).style });
  const roster = () => ({ teams: [TEAMS[0].key, TEAMS[1].key], players: players.map((q) => ({ name: q.name, team: q.T.key })) });   // for the api's match roster
  const live = (type) => send({ type, roster: type === 'start' ? roster() : undefined, setup: setup(), started: !!S.started, over: !!S.over, score: S.score.slice(), minute: Math.floor(ENV.minute || 0) });
  // the setup the shell asked for: the same seed, teams, stadium, month, kick-off, half length and formations as the season fixture
  let want = null;
  const apply = (Q) => {
    SET.seed = +Q.get('seed'); SET.st = STADIUMS[+Q.get('st') || 0]; SET.month = +Q.get('month') || 0;
    SET.kickStr = Q.get('kick') || SET.kickStr; SET.kick = parseHM(SET.kickStr); SET.half = +Q.get('half') || SET.half;
    SET.weather = 'auto'; SET.dynamic = true;
    if (+Q.get('speed') > 0) S.speed = clamp(+Q.get('speed'), 0.25, 8);   // the filming URL's playback speed (Watch only reads it; the buttons stay 0.25 to 2x)
    [0, 1].forEach((ti) => { SET.tactics[ti].form = Q.get('f' + ti) || 'auto'; SET.tactics[ti].style = Q.get('s' + ti) || 'auto'; });
    if (Q.get('h') && Q.get('a')) want = [Q.get('h'), Q.get('a')];
  };
  // season clubs and squads (shared/clubs.json, from the league file). Club names, squads, ratings and kits come from the fixture.
  const MAP = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [0, 1, 2, 3, 4, 8, 6, 7, 10, 9, 5]];   // the same squad slots the headless season runs used
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const contrast = (hex) => { const n = parseInt(hex.slice(1), 16); const L = (((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) / 255; return L > 0.7 ? 0x1A1D22 : 0xF2F5F8; };
  const clubs = { list: null, ready: false };
  let kicked = false;   // the match has started: the fixture's clubs are applied, now or as soon as the club list arrives
  clubs.load = fetch('../shared/clubs.json').then((r) => r.json()).then((j) => { clubs.list = j.clubs; clubs.ready = true; if (kicked) applyClubs(); }).catch(() => { clubs.ready = true; });
  // the fixture's clubs as TEAMS (names, keys, kits) and the desk labels. Called before kick-off, so the pre-match lines and the predictions use them
  const applyNames = (C) => {
    C.forEach((c, ti) => {
      const T = TEAMS[ti], shirt = parseInt(c.color.slice(1), 16);
      Object.assign(T, { key: c.key, club: c.club, css: c.color, kit: shirt, kitSocks: shirt, kitShorts: contrast(c.color), kit2: contrast(c.color) });
    });
    const tm = document.querySelectorAll('#bug .tm'); if (tm.length === 2) { tm[0].textContent = TEAMS[0].key; tm[1].textContent = TEAMS[1].key; }
    const names = document.querySelectorAll('#intro .vs .club'); if (names.length === 3) { names[0].textContent = TEAMS[0].club.toUpperCase(); names[2].textContent = TEAMS[1].club.toUpperCase(); }   // the pre-match card names the same clubs
  };
  const fixtureClubs = () => { if (!want || !clubs.list) return null; const C = want.map((k) => clubs.list.find((c) => c.key === k)); return C[0] && C[1] ? C : null; };
  const applyClubs = () => {
    const C = fixtureClubs(); if (!C) return;
    const old = TEAMS.map((T) => T.key);
    applyNames(C);
    for (const e of ENV.events) { if (e.team === old[0]) e.team = C[0].key; else if (e.team === old[1]) e.team = C[1].key; }
    for (const p of players) {
      if (!p._base) p._base = { name: p.name, rating: p.rating, passS: p.passS, shotS: p.shotS, ctrl: p.ctrl, tackle: p.tackle, drib: p.drib, vmax: p.vmax, acc: p.acc };
      Object.assign(p, p._base);
      const R = C[p.ti].squad[MAP[p.ti][p.i]], b = p._base, d = R.rating - b.rating;
      Object.assign(p, { name: R.name, num: R.num, rating: R.rating,
        passS: clamp(b.passS + d * 0.033, 0.3, 1), shotS: clamp(b.shotS + d * 0.036, 0.2, 1), ctrl: clamp(b.ctrl + d * 0.031, 0.3, 1),
        tackle: clamp(b.tackle + d * 0.033, 0.25, 1), drib: clamp(b.drib + d * 0.038, 0.1, 1), vmax: clamp(b.vmax + d * 0.17, 6, 9.6), acc: clamp(b.acc + d * 0.08, 3, 5.8) });
      if (p.el) { const t = p.el.querySelector('b'); if (t) t.textContent = p.num; const sn = p.el.querySelector('b').nextSibling; if (sn) sn.nodeValue = surname(p.name).toUpperCase(); }
      const k = kitOf(TEAMS[p.ti], !!(p.gk || p.pos === 'GK'));
      if (p.model) p.model.traverse((o) => { const pal = o.material && o.material.userData && o.material.userData.pal; if (pal && pal.length > 3) { pal[1].setHex(k.shirt); pal[2].setHex(k.shorts); pal[3].setHex(k.socks); } });
    }
  };
  // the fixture's clubs replace the defaults: names, keys, kits, the events and the squads. Idempotent, so it runs before the desk builds the match and again at kick-off
  const names = applyClubs;
  // call right after every kick-off: the engine has started, the fixture's clubs replace the defaults
  const started = () => { kicked = true; applyClubs(); live('start'); const pitch = document.getElementById('mc-pitch'); if (pitch) pitch.textContent = '3D pitch: live'; };   // the desk's header says when the pitch is on
  const progress = (text) => send({ type: 'progress', text });   // shown on the shell's loading card
  let sentOver = false;
  const loop = () => {
    if (!framed) return;
    setInterval(() => {
      if (S.over && !sentOver && !window.MC_CONSUMER) { sentOver = true; send({ type: 'fulltime', setup: setup(), score: S.score.slice(), dataset: dataset() }); }
      if (!S.over) sentOver = false;
      if (S.started) live('tick');
    }, 1000);
  };
  // Watch emits: every match event and explain moment, batched once a second, for the shell's agents (the shell checks the setup)
  const outbox = { events: [], moments: [] };
  const emit = () => {
    if (!framed) return;
    onMatchEvent((ev) => { if (S.started) outbox.events.push(ev); });
    MCX.onMoment((m) => outbox.moments.push({ id: m.id, minute: m.minute, type: m.type, team: m.team, title: m.title, why: m.why }));
    setInterval(() => {
      if (!outbox.events.length && !outbox.moments.length) return;
      send({ type: 'events', setup: setup(), batch: outbox.events.splice(0), moments: outbox.moments.splice(0) });
    }, 1000);
  };
  // Push-to-talk (EXP-16): hold the button, speak, release; the words fill the box and submit it. Typing always works.
  // Uses the shell's Azure Speech (SPX, token from the api) when it is there, else the browser's speech recognition; the title says which.
  const ptt = (input, form, lang) => {
    if (!input || !form || input.dataset.ptt) return null;
    input.dataset.ptt = '1';
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let az = null; try { az = window.parent !== window && window.parent.SPX && typeof window.parent.SPX.listen === 'function' ? window.parent.SPX : null; } catch (e) { /* cross-origin parent */ }   // the shell's Azure Speech, when the api has issued a token
    const b = document.createElement('button'); b.type = 'button'; b.className = 'mcx-ptt'; b.textContent = '🎤';
    b.setAttribute('aria-label', 'Hold to talk'); b.title = SR || az ? 'Hold to talk (Azure Speech when the api issues a token, otherwise browser speech recognition)' : 'This browser has no speech recognition. Type instead.';
    b.style.cssText = 'min-width:40px;min-height:36px;border-radius:8px;border:1px solid var(--line);background:rgba(255,255,255,.08);color:var(--ink);cursor:pointer';
    const st = document.createElement('span'); st.className = 'mcx-ptt-s'; st.setAttribute('role', 'status'); st.style.cssText = 'font-size:11px;color:var(--muted);align-self:center';
    input.after(b); b.after(st);
    if (!SR && !az) { b.disabled = true; st.textContent = 'No speech recognition here'; return b; }
    let rec = null, heard = '';
    const stop = () => { if (rec) { try { rec.stop(); } catch (e) { /* already stopped */ } } };
    const submit = (text) => { st.textContent = ''; b.setAttribute('aria-pressed', 'false'); if (text) { input.value = text.slice(0, 300); form.requestSubmit(); } };
    const start = () => {
      if (rec) return;
      if (az) {   // Azure Speech: one phrase, ends on silence; no token (503) or no mic falls back to the browser below
        rec = {}; st.textContent = 'Listening…'; b.setAttribute('aria-pressed', 'true');
        az.listen(lang || 'en-GB').then((text) => { rec = null; if (text) { submit(text); return; } if (text === null && SR) browserStart(); else { submit(''); st.textContent = 'Could not hear that. Try again or type.'; } });
        return;
      }
      browserStart();
    };
    const browserStart = () => {
      if (rec) return;
      heard = ''; rec = new SR(); rec.lang = lang || 'en-GB'; rec.interimResults = false; rec.continuous = false;
      rec.onresult = (e) => { heard = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim(); };
      rec.onend = () => { rec = null; st.textContent = ''; b.setAttribute('aria-pressed', 'false'); if (heard) { input.value = heard.slice(0, 300); form.requestSubmit(); } };
      rec.onerror = () => { st.textContent = 'Could not hear that. Try again or type.'; };
      st.textContent = 'Listening…'; b.setAttribute('aria-pressed', 'true'); rec.start();
    };
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); start(); });
    for (const t of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(t, stop);
    b.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(); } });
    b.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') stop(); });
    return b;
  };
  return { view: '', framed, send, setup, live, apply, names, started, loop, emit, clubs, progress, ptt };
})();
