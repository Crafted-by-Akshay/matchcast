// ---- unified console: captions and voice for approved lines (EXP-8).
// Captions always show the line text. Audio is the api's Azure Speech mp3 (publication.audio_url) when there is one; with no api it falls back to the
// browser's own voice, labelled as such. A line older than 5 s is never spoken. Voices come from voices.json (edit there, nowhere else).
const VC = (() => {
  const EXPIRY_MS = 5000, KEY = 'mc-voice';
  let voices = { playByPlay: 'en-GB-RyanNeural', analyst: 'en-GB-SoniaNeural', es: 'es-ES-ElviraNeural', hi: 'hi-IN-SwaraNeural' };
  let on = false, queue = [], busy = false, bar = null, hide = 0, source = 'browser';
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
    busy = true; const done = () => { busy = false; next(); };
    if (it.audio) { source = 'azure'; const a = new Audio(it.audio); a.onended = a.onerror = done; a.play().catch(done); return; }
    source = 'browser';
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') { done(); return; }
    const u = new SpeechSynthesisUtterance(it.text); u.lang = it.lang === 'es' ? 'es-ES' : it.lang === 'hi' ? 'hi-IN' : 'en-GB';
    u.onend = u.onerror = done; window.speechSynthesis.speak(u);
  };
  // a line to show and (if voice is on) speak. at: when it was written, in ms; lang: en, es or hi; audio: an api audio url
  const say = (text, o) => {
    o = o || {}; const at = o.at || Date.now();
    caption(text);
    if (on) { queue.push({ text, at, lang: o.lang || 'en', audio: o.audio || null }); next(); }
  };
  const set = (v) => { on = !!v; try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* storage may be blocked */ } if (!on) { queue = []; if ('speechSynthesis' in window) window.speechSynthesis.cancel(); busy = false; } };
  return { load, say, set, get on() { return on; }, get voices() { return voices; }, get source() { return source; }, get EXPIRY_MS() { return EXPIRY_MS; } };
})();
