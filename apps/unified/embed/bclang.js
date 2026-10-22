// ---- Broadcast desk script in English, Spanish and Hindi (the decided languages). The desk's Tamil drafts are gone: Tamil stays out until a native speaker reviews it.
// Appended in the desk's module (see build.py). Each Spanish and Hindi line is written by rules from the same event as the English line, then the Verifier step
// re-checks it: the same names and numbers in the same order, and no name that is not in the English line. A rejected or missing translation keeps the English line.
const BCL_WX = {
  es: { clear: 'cielo despejado', partly: 'parcialmente nublado', overcast: 'nublado', drizzle: 'llovizna', rain: 'lluvia', storm: 'tormenta', fog: 'niebla', snow: 'nieve' },
  hi: { clear: 'साफ़ आसमान', partly: 'आंशिक बादल', overcast: 'बादल छाए', drizzle: 'बूंदाबांदी', rain: 'बारिश', storm: 'तूफ़ान', fog: 'कोहरा', snow: 'बर्फ़बारी' }
};
// rules translator: [es, hi] per event type, from the event's own fields (the names and numbers are copied, never rewritten)
function bcTranslate(ev, c) {
  const score = ev.score || S.score.join('-');
  switch (ev.type) {
    case 'kickoff': return [`Saque inicial en ${SET.st.name}. Árbitro ${OFFICIALS.ref} de ${OFFICIALS.nat}.`, `किक-ऑफ, ${SET.st.name}। रेफरी ${OFFICIALS.ref}, ${OFFICIALS.nat}।`];
    case 'goal': return ev.ownGoal
      ? [`Autogol. ${ev.player} marca en su propia portería. ${score}.`, `आत्मघाती गोल! ${ev.player} ने अपनी ही जाली में गेंद डाल दी। ${score}।`]
      : [`Gol. ${ev.player} marca para ${c(ev.team)}. ${score}.`, `गोल! ${ev.player} ने ${c(ev.team)} के लिए गोल किया। ${score}।`];
    case 'shot': return [`Disparo de ${ev.player} para ${c(ev.team)}. xG ${bcRound(ev.xg, 2)}.`, `${ev.player} (${c(ev.team)}) का शॉट। xG ${bcRound(ev.xg, 2)}।`];
    case 'yellow_card': return [`Tarjeta amarilla para ${ev.player}.`, `${ev.player} को पीला कार्ड।`];
    case 'red_card': return [`Tarjeta roja. ${ev.player} es expulsado.`, `लाल कार्ड! ${ev.player} को बाहर भेजा गया।`];
    case 'half_time': return [`Descanso. ${score}.`, `हाफ़-टाइम। ${score}।`];
    case 'full_time': return [`Final del partido. ${score}.`, `फ़ुल-टाइम। ${score}।`];
    case 'weather_change': return [`El tiempo cambia: ${BCL_WX.es[ev.to] || ev.to}.`, `मौसम बदल रहा है: ${BCL_WX.hi[ev.to] || ev.to}।`];
    case 'lightning': return ['Rayos en la zona. Se detiene el juego.', 'इलाके में बिजली। खेल रोका गया।'];
    case 'tactical_change': return [`${c(ev.team)} cambia a ${ev.formation}.`, `${c(ev.team)} ने ${ev.formation} में बदलाव किया।`];
    default: return null;
  }
}
const bcNums = (t) => String(t).match(/\p{Nd}+(?:\.\p{Nd}+)?/gu) || [];
// the line's facts in the order they are said: each known name and each number, with its position
const bcFacts = (text, names) => {
  const out = [], taken = [];
  for (const n of names) for (let at = text.indexOf(n); at >= 0; at = text.indexOf(n, at + n.length)) { if (!taken.some(([s, e]) => at < e && at + n.length > s)) { taken.push([at, at + n.length]); out.push([at, n]); } }
  for (const m of text.matchAll(/\p{Nd}+(?:\.\p{Nd}+)?/gu)) if (!taken.some(([s, e]) => m.index >= s && m.index < e)) out.push([m.index, m[0]]);
  return out.sort((x, y) => x[0] - y[0]).map((x) => x[1]);
};
// Verifier re-check on a translation (same rules as the shell's checkTranslation in agents.js)
function bcCheckTranslation(en, text, names) {
  names = [...new Set(names.filter(Boolean))].sort((x, y) => y.length - x.length);
  if (bcNums(en).join() !== bcNums(text).join()) return { ok: false, reason: 'numbers differ from the English line' };
  if (bcFacts(en, names).join('|') !== bcFacts(text, names).join('|')) return { ok: false, reason: 'names or numbers are in a different order than the English line' };
  const cap = /(?<![\p{L}\d'’-])\p{Lu}[\p{L}'’-]*/gu, inEn = new Set(en.match(cap) || []);
  const extra = [...text.matchAll(cap)].filter((m) => m.index > 0 && !/(^|[.!?]\s)$/.test(text.slice(0, m.index)) && !inEn.has(m[0]) && !names.some((n) => n.includes(m[0]))).map((m) => m[0])[0];
  return extra ? { ok: false, reason: 'name not in the English line: ' + extra } : { ok: true, reason: 'names and numbers match the English line' };
}
const bcLineEn = bcLine;
bcLine = function (ev) {
  const line = bcLineEn(ev); if (!line) return line;
  delete line.ta;   // Tamil is out until a native speaker reviews it
  const tr = bcTranslate(ev, (k) => bcTeam(bcTi(k))); line.tr = {};
  const names = [bcTeam(0), bcTeam(1), ev.player, OFFICIALS.ref, OFFICIALS.nat, SET.st.name].concat(players.map((p) => p.name));
  ['es', 'hi'].forEach((lang, i) => {
    const text = tr && tr[i];
    if (!text) { line.tr[lang] = { ok: false, reason: 'no template for this line' }; return; }
    const v = bcCheckTranslation(line.en, text, names);
    line.tr[lang] = { ok: v.ok, reason: v.reason };
    if (v.ok) line[lang] = text;
  });
  return line;
};
// the text for the chosen language: a verified translation, otherwise the English line
const bcTx = (l) => (BC.lang !== 'en' && l[BC.lang]) || l.en;
const bcTrNote = (l) => (BC.lang === 'en' || !l.tr ? '' : l.tr[BC.lang] && l.tr[BC.lang].ok ? ' · ' + BC.lang.toUpperCase() + ' translated, re-checked ✓' : ' · English shown: ' + ((l.tr[BC.lang] || {}).reason || 'not translated'));
const bcLangTag = () => ({ en: 'English', es: 'Español · rules translation, re-checked', hi: 'हिन्दी · rules translation, re-checked' }[BC.lang] || 'English');
window.__bcLang = { check: bcCheckTranslation, translate: bcTranslate };   // for the browser test

// ---- accessibility (axe, WCAG AA): text on the team-colour chips and the yellow buttons is dark, and small grey notes are lighter
(() => {
  const st = document.createElement('style');
  st.textContent = '.bc-btn.pri,.bc-seg button[aria-pressed="true"]{color:#06121F !important}.bc-foot,.src,.bc-src{color:#9aa7bf !important}';
  document.head.appendChild(st);
  const lum = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()); if (!m) return null; const v = [0, 2, 4].map((i) => { const c = parseInt(m[1].slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ink = () => {
    for (const [id, v] of [['bc-h', '--bc-home'], ['bc-a', '--bc-away']]) {
      const el = document.getElementById(id); if (!el) continue;
      const bg = lum(getComputedStyle(document.documentElement).getPropertyValue(v)) ?? lum(getComputedStyle(el).backgroundColor.replace(/rgb\((\d+), (\d+), (\d+).*/, (_, r, g, b) => '#' + [r, g, b].map((x) => (+x).toString(16).padStart(2, '0')).join(''))); if (bg == null) continue;
      el.style.color = (1.05 / (bg + 0.05)) >= ((bg + 0.05) / 0.0553) ? '#ffffff' : '#06121F';   // whichever of white or the dark ink has more contrast
    }
  };
  if (!document.documentElement.lang) document.documentElement.lang = 'en';
  setInterval(ink, 1000);
  // scrollable panes must be reachable by keyboard
  document.querySelectorAll('.bc-pane').forEach((p) => { p.tabIndex = 0; p.setAttribute('role', 'region'); p.setAttribute('aria-label', 'Desk panel: ' + p.id.replace(/^pane-/, '')); });
})();
