// ---- unified console: captions and voice for approved lines (EXP-8).
// Captions always show the line text. Audio is the api's Azure Speech mp3 (publication.audio_url) when there is one; with no api it falls back to the
// browser's own voice, labelled as such. A line older than 5 s is never spoken. Voices come from voices.json (edit there, nowhere else).
const VC = (() => {
  const EXPIRY_MS = 5000, KEY = 'mc-voice';
  const LOCALE = { es: 'es-ES', pt: 'pt-BR', hi: 'hi-IN' };
  let voices = { playByPlay: 'en-GB-RyanNeural', analyst: 'en-GB-SoniaNeural', es: 'es-ES-ElviraNeural', hi: 'hi-IN-SwaraNeural', pt: 'pt-BR-FranciscaNeural' };
  let gen = 0, on = false, queue = [], busy = false, bar = null, hide = 0, source = 'browser', playing = null, onChange = () => {};
  const spoken = new Set();   // one voice line per claim, however often its card is redrawn
  try { on = localStorage.getItem(KEY) === 'on'; } catch (e) { /* storage may be blocked */ }
  const load = () => fetch('voices.json').then((r) => r.ok ? r.json() : null).then((j) => { if (j) voices = Object.assign(voices, j); }).catch(() => {});
  const el = () => {
    if (bar) return bar;
    bar = document.createElement('div'); bar.id = 'vc-bar'; bar.setAttribute('role', 'status'); bar.setAttribute('aria-live', 'polite'); bar.hidden = true;
    bar.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);max-width:min(720px,calc(100% - 32px));padding:8px 14px;background:rgba(10,20,40,.92);color:#fff;font:600 15px system-ui,sans-serif;border-radius:6px;z-index:60;pointer-events:none';
    document.body.append(bar); return bar;
  };
  const caption = (text) => { const b = el(); b.textContent = text; b.hidden = false; clearTimeout(hide); hide = setTimeout(() => { b.hidden = true; }, 9000); };
  const next = () => {
    if (busy) return;
    const it = queue.shift(); if (!it) return;
    if (Date.now() - it.at > EXPIRY_MS) { next(); return; }   // expired while waiting: caption only (already shown)
    busy = true; const my = gen, done = () => { if (my !== gen) return; busy = false; next(); };   // a stale callback (Voice was switched off meanwhile) does nothing
    if (it.audio) { const a = playing = new Audio(it.audio); a.onended = a.onerror = done; a.play().catch(done); return; }
    const lang = LOCALE[it.lang] || 'en-GB';
    const browser = () => {
      if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') { done(); return; }
      // the browser's voice for this language; with none here, a non-English line is shown but not read in another voice
      const all = window.speechSynthesis.getVoices(), v = all.find((x) => x.lang.replace('_', '-') === lang) || all.find((x) => x.lang.slice(0, 2) === lang.slice(0, 2));
      if (!v && !lang.startsWith('en')) { done(); return; }   // no voice yet (Chrome fills the list late) or none for this language: caption only
      source = 'browser'; onChange();
      const u = new SpeechSynthesisUtterance(it.text); u.lang = lang; if (v) u.voice = v;
      u.onend = u.onerror = done; window.speechSynthesis.speak(u);
    };
    // Azure Speech (token from the api) when it is there, otherwise the browser voice; one voice per role and language
    if (typeof SPX === 'undefined') { browser(); return; }
    if (it.lang !== 'en' && !voices[it.lang]) { done(); return; }   // no voice for this language: captioned, never read in another voice
    const voice = it.lang !== 'en' ? voices[it.lang] : it.role === 'analyst' ? voices.analyst : voices.playByPlay;
    SPX.speak(it.text, voice, lang, it.tone === 'big').then((ok) => { if (my !== gen || !on) return; if (ok) { source = 'azure'; onChange(); done(); } else if (Date.now() - it.at > EXPIRY_MS) done(); else browser(); });   // not spoken late by the browser after a slow Azure try
  };
  // a line to show and (if voice is on) speak. at: when it was written, in ms; lang: a language in VOICED; audio: an api audio url
  // a language with no voice is shown as text only: the English voice must not read another language's words
  const VOICED = ['en', 'es', 'pt', 'hi'];   // CREW-7.10: the top four spoken; voices.json names each one's voice
  const speaks = (lang) => VOICED.includes(lang || 'en');
  const say = (text, o) => {
    o = o || {}; const at = o.at || Date.now();
    caption(text);
    source = o.audio ? 'azure' : 'browser'; onChange();
    if (on && speaks(o.lang) && !(o.id && spoken.has(o.id))) {
      if (o.tone === 'big') swell();
      if (o.id) spoken.add(o.id); queue.push({ text, at, lang: o.lang || 'en', role: o.role || 'playByPlay', audio: o.audio || null, tone: o.tone || '' }); next(); }
  };
  // the crowd bed (simulated): low noise under the commentary while Voice is on. It is synthesised here, not a recording, and it swells for a big moment.
  let crowd = null, swellT = 0;
  const crowdStart = () => {
    if (crowd || !('AudioContext' in window)) return;
    try {
      const ctx = new AudioContext(), len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      let last = 0; for (let i = 0; i < len; i++) { last = (last + (Math.random() * 2 - 1) * 0.02) / 1.02; d[i] = last * 3.5; }   // brown noise: a murmur, not hiss
      const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf; src.loop = true; lp.type = 'lowpass'; lp.frequency.value = 900; g.gain.value = 0.04;
      src.connect(lp); lp.connect(g); g.connect(ctx.destination); src.start(); if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      crowd = { ctx, src, g };
    } catch (e) { crowd = null; }   // no audio here: the commentary still plays
  };
  const crowdStop = () => { clearTimeout(swellT); if (crowd) { try { crowd.src.stop(); crowd.ctx.close(); } catch (e) { /* already stopped */ } crowd = null; } };
  const swell = () => {
    if (!crowd) return; const t = crowd.ctx.currentTime, g = crowd.g.gain;
    g.cancelScheduledValues(t); g.setTargetAtTime(0.22, t, 0.3);
    clearTimeout(swellT); swellT = setTimeout(() => { if (crowd) crowd.g.gain.setTargetAtTime(0.04, crowd.ctx.currentTime, 1.5); }, 3000);
  };
  const set = (v) => { on = !!v; try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* storage may be blocked */ } if (!on) { gen++; queue = []; if (typeof SPX !== 'undefined') SPX.stop(); if (playing) { playing.pause(); playing = null; } if ('speechSynthesis' in window) window.speechSynthesis.cancel(); busy = false; crowdStop(); } else crowdStart(); onChange(); };
  return { load, say, set, speaks, swell, onChange: (fn) => { onChange = fn; }, get on() { return on; }, get crowd() { return !!crowd; }, get voices() { return voices; }, get source() { return source; }, get EXPIRY_MS() { return EXPIRY_MS; } };
})();
