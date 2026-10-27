// ---- CREW-7.9 (AB#506), the picker half: Watch's language row offers the ten feed languages, on by default (?crew=0 turns it off). Runs in the Watch module before watch.js.
// The list is the Languages lane's (apps/unified/langs.js: MC_LANGS, MC_LANG_NAMES, MC_SPEECH_LOCALE, ADR-0023) when the page has it; until it lands, a fixture of the same ten.
// Watch's picker is the prototype's (fanPicker) and its language list is a const array, so the entries are replaced in place: the row, the saved settings, the shell's persona message and the
// "Planned" tags (build.py) all follow the one list. A line with no checked translation stays English, and the row says so. Nothing is translated here.
(() => {
  let qs = location.search;   // the page's own query first; the parent's is appended in its own try (same lines as crew.js)
  try { if (window.parent !== window) qs += '&' + window.parent.location.search; } catch (e) { /* cross-origin parent */ }
  let on = !/[?&]crew=0(&|$)/.test(qs);   // default on; ?crew=0 or localStorage mc-crew=0 turns it off, an explicit crew=1 beats a stored 0
  try { if (on && !/[?&]crew=1(&|$)/.test(qs) && localStorage.getItem('mc-crew') === '0') on = false; } catch (e) { /* storage blocked */ }
  if (!on) return;
  if (typeof FAN_LANGS === 'undefined' || typeof fanPicker === 'undefined' || typeof fanApply === 'undefined' || typeof fanPop === 'undefined') return;

  const FIXTURE = ['en', 'es', 'pt', 'hi', 'ar', 'fr', 'de', 'id', 'ja', 'zh-Hans'];
  const NAMES = { en: 'English', es: 'Español', pt: 'Português', hi: 'हिन्दी', ar: 'العربية', fr: 'Français', de: 'Deutsch', id: 'Bahasa Indonesia', ja: '日本語', 'zh-Hans': '简体中文' };
  const LOCALE = { en: 'en-GB', es: 'es-ES', pt: 'pt-BR', hi: 'hi-IN', ar: 'ar-SA', fr: 'fr-FR', de: 'de-DE', id: 'id-ID', ja: 'ja-JP', 'zh-Hans': 'zh-CN' };
  const ENGLISH = { pt: 'Portuguese', de: 'German', id: 'Indonesian', ja: 'Japanese', 'zh-Hans': 'Simplified Chinese' };   // the prototype's prompts name a language in English
  const codes = Array.isArray(window.MC_LANGS) && window.MC_LANGS.length > 1 ? window.MC_LANGS : FIXTURE;
  const name = (k) => (window.MC_LANG_NAMES || NAMES)[k] || NAMES[k] || k;
  const locale = (k) => (window.MC_SPEECH_LOCALE || LOCALE)[k] || LOCALE[k] || k;
  const built = (k) => Array.isArray(window.MC_LANGS) ? window.MC_LANGS.includes(k) : ['en', 'es', 'hi'].includes(k);

  FAN_LANGS.splice(0, FAN_LANGS.length, ...codes.map((k) => [k, name(k), locale(k)]));
  if (typeof FAN_LNAME !== 'undefined') for (const k of codes) if (!FAN_LNAME[k]) FAN_LNAME[k] = ENGLISH[k] || name(k);

  const st = document.createElement('style');
  st.textContent = '#fan-pop:not([hidden]){z-index:40}'   // above the live cards (z 30, 31) that could cover the longer language row
    + '@media (min-width:761px){#fan-pop:not([hidden]){max-height:calc(100vh - var(--mc-pop-top,130px) - 12px);overflow-y:auto}}'   // the prototype's phone sheet (70vh) already scrolls
    + '.fm-planned{margin-inline-start:4px}.mc-lang-note{margin:6px 0 0;font:12px/1.4 system-ui,sans-serif;color:var(--muted,#9fb0cc)}.mc-lang-note[hidden]{display:none}.mc-lang-scope{margin:3px 0 6px;font:12px/1.4 system-ui,sans-serif;color:var(--muted,#9fb0cc)}';
  document.head.appendChild(st);

  // A line reads right to left when it is written in Arabic, whatever the picked language: a line that fell back to English stays left to right (dir=auto), and the card chrome is not mirrored.
  const ARABIC = /[\u0600-\u06FF]/;
  const mark = (root) => {
    // the lines (li, p), the newest line at the top of the commentary card and the caption's text (its card has an English label before it, so the card itself cannot decide)
    const els = root.nodeType === 1 ? [root, ...root.querySelectorAll('li,p,#mcf-top,#cap1')].filter((e) => /^(LI|P)$/.test(e.tagName) || e.id === 'mcf-top' || e.id === 'cap1') : [];
    for (const e of els) { if (e.getAttribute('dir') !== 'auto') e.setAttribute('dir', 'auto'); const ar = ARABIC.test(e.textContent || ''); if (ar && e.lang !== 'ar') e.lang = 'ar'; else if (!ar && e.lang === 'ar') e.removeAttribute('lang'); }
  };
  const watch = (id) => { const root = document.getElementById(id); if (!root) return; mark(root); new MutationObserver(() => mark(root)).observe(root, { childList: true, subtree: true, characterData: true }); };
  const paint = () => { for (const id of ['mcf', 'mc-two', 'mcx-box', 'cap']) if (!document.getElementById(id) || !document.getElementById(id).dataset.mcLang) { const e = document.getElementById(id); if (e) { e.dataset.mcLang = '1'; watch(id); } } };

  // the prototype sets the caption card's direction from the picked language on every change; the card stays left to right and the caption's own line decides here
  const _apply = fanApply;
  fanApply = function () { _apply(); const c = document.getElementById('cap'); if (c) { c.dir = 'ltr'; mark(c); } };

  // one note under the row replaces the prototype's: a line shows in the chosen language only once a checked translation has arrived
  const _pick = fanPicker;
  fanPicker = function (box, compact) {
    _pick(box, compact);
    const row = box.querySelector('.fm-lang'); if (!row) return;
    const old = box.querySelector('.fm-note'); if (old) old.remove();
    const note = document.createElement('p');
    note.className = 'fm-note mc-lang-note'; if (box.id === 'fan-pop') note.id = 'mc-lang-note';
    note.hidden = FAN.lang === 'en';
    note.lang = 'en'; note.dir = 'ltr';   // an English sentence, also inside the panel the prototype sets right to left for Arabic
    const nm = document.createElement('bdi'); nm.textContent = name(FAN.lang);
    note.append(built(FAN.lang) ? 'Lines show in ' : '', nm, built(FAN.lang) ? ' once a checked translation arrives. Until then, or if translating fails, they stay in English.' : ' is Planned: lines stay in English for now.');
    row.after(note);
    const scope = document.createElement('p'); scope.className = 'mc-lang-scope'; if (box.id === 'fan-pop') scope.id = 'mc-lang-scope';
    scope.textContent = 'Commentary and speech only · interface labels stay in English.';
    note.after(scope);
  };
  // the panel is taller with ten languages: on a desktop it stops short of the frame's bottom and scrolls
  const _pop = fanPop;
  fanPop = function (open) {
    _pop(open);
    const el = document.getElementById('fan-pop');
    if (open && el) el.style.setProperty('--mc-pop-top', (parseInt(el.style.top, 10) || 130) + 'px');
  };
  window.addEventListener('load', paint);
  setTimeout(paint, 1500);   // the cards are made by feed.js, twofans.js and watch.js during module evaluation, so `load` is enough today; this is the backstop
})();
