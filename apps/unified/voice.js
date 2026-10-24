// ---- unified console: captions and voice for approved lines (EXP-8).
// Captions always show the line text. Audio is the api's Azure Speech mp3 (publication.audio_url) when there is one; with no api it falls back to the
// browser's own voice, labelled as such. A line older than 5 s is never spoken. Voices come from voices.json (edit there, nowhere else).
const VC = (() => {
  const EXPIRY_MS = 5000, KEY = 'mc-voice';
  let voices = { playByPlay: 'en-GB-RyanNeural', analyst: 'en-GB-SoniaNeural', es: 'es-ES-ElviraNeural', hi: 'hi-IN-SwaraNeural' };
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
    const lang = it.lang === 'es' ? 'es-ES' : it.lang === 'hi' ? 'hi-IN' : 'en-GB';
    const browser = () => {
      if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') { done(); return; }
      source = 'browser'; onChange();
      const u = new SpeechSynthesisUtterance(it.text); u.lang = lang;
      u.onend = u.onerror = done; window.speechSynthesis.speak(u);
    };
    // Azure Speech (token from the api) when it is there, otherwise the browser voice; one voice per role and language
    if (typeof SPX === 'undefined') { browser(); return; }
    const voice = it.lang === 'es' ? voices.es : it.lang === 'hi' ? voices.hi : it.role === 'analyst' ? voices.analyst : voices.playByPlay;
    SPX.speak(it.text, voice, lang, it.tone === 'big').then((ok) => { if (my !== gen || !on) return; if (ok) { source = 'azure'; onChange(); done(); } else if (Date.now() - it.at > EXPIRY_MS) done(); else browser(); });   // not spoken late by the browser after a slow Azure try
  };
  // a line to show and (if voice is on) speak. at: when it was written, in ms; lang: en, es or hi; audio: an api audio url
  const say = (text, o) => {
    o = o || {}; const at = o.at || Date.now();
    caption(text);
    source = o.audio ? 'azure' : 'browser'; onChange();
    if (on && !(o.id && spoken.has(o.id))) {
      if (o.id) spoken.add(o.id); queue.push({ text, at, lang: o.lang || 'en', role: o.role || 'playByPlay', audio: o.audio || null, tone: o.tone || '' }); next(); }
  };
  const set = (v) => { on = !!v; try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* storage may be blocked */ } if (!on) { gen++; queue = []; if (typeof SPX !== 'undefined') SPX.stop(); if (playing) { playing.pause(); playing = null; } if ('speechSynthesis' in window) window.speechSynthesis.cancel(); busy = false; } onChange(); };
  return { load, say, set, onChange: (fn) => { onChange = fn; }, get on() { return on; }, get voices() { return voices; }, get source() { return source; }, get EXPIRY_MS() { return EXPIRY_MS; } };
})();
