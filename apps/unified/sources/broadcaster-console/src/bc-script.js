// ============ BROADCASTER CONSOLE: script, talking points, speech (bc-script.js) ============
// Tamil lines are drafted here and marked as such on screen; a native speaker should review them before air.
const BC_WX_TA = { clear: 'தெளிவான வானம்', partly: 'சற்று மேகம்', overcast: 'மேகமூட்டம்', drizzle: 'தூறல்', rain: 'மழை', storm: 'புயல்', fog: 'பனிமூட்டம்', snow: 'பனி' };
const bcRound = (x, d) => (x == null || !isFinite(x) ? '' : (+x).toFixed(d));
function bcLine(ev) {
  const club = (k) => bcTeam(bcTi(k)), score = ev.score || S.score.join('-'), min = Math.floor(ev.minute || 0);
  const mk = (en, ta) => ({ min, type: ev.type, en, ta, src: min + "' · sim event: " + ev.type });
  switch (ev.type) {
    case 'kickoff': return mk('Kick-off at ' + SET.st.name + '. Referee ' + OFFICIALS.ref + ' of ' + OFFICIALS.nat + '.', 'ஆட்டம் தொடங்குகிறது. நடுவர் ' + OFFICIALS.ref + '.');
    case 'goal': return ev.ownGoal
      ? mk('Own goal. ' + ev.player + ' puts it into his own net. ' + score + '.', 'சொந்த கோல்! ' + ev.player + ' தனது வலைக்குள் பந்தை தள்ளுகிறார். ' + score + '.')
      : mk('GOAL! ' + ev.player + ' scores for ' + club(ev.team) + '. ' + score + '.', 'கோல்! ' + club(ev.team) + ' சார்பில் ' + ev.player + ' கோல் அடிக்கிறார். ஸ்கோர் ' + score + '.');
    case 'shot': if (!(ev.kind === 'penalty' || ev.xg >= 0.12)) return null;
      return mk(ev.player + ' shoots for ' + club(ev.team) + '. xG ' + bcRound(ev.xg, 2) + '.', ev.player + ' (' + club(ev.team) + ') அடிக்கிறார். xG ' + bcRound(ev.xg, 2) + '.');
    case 'yellow_card': return mk('Yellow card for ' + ev.player + '. ' + (ev.reason || ''), ev.player + 'க்கு மஞ்சள் அட்டை.');
    case 'red_card': return mk('Red card! ' + ev.player + ' is sent off.', 'சிவப்பு அட்டை! ' + ev.player + ' வெளியேற்றப்படுகிறார்.');
    case 'half_time': return mk('Half-time. ' + score + '.', 'இடைவேளை. ஸ்கோர் ' + score + '.');
    case 'full_time': return mk('Full-time. ' + score + '.', 'ஆட்டம் முடிந்தது. இறுதி ஸ்கோர் ' + score + '.');
    case 'weather_change': return mk('The weather changes: ' + (WX[ev.to] ? WX[ev.to].label.toLowerCase() : ev.to) + '.', 'வானிலை மாறுகிறது: ' + (BC_WX_TA[ev.to] || ev.to) + '.');
    case 'lightning': return mk('Lightning in the area. Play is held.', 'மின்னல் அபாயம். ஆட்டம் நிறுத்தப்படுகிறது.');
    case 'tactical_change': return mk(club(ev.team) + ' change shape to ' + ev.formation + '.', club(ev.team) + ' அணி அமைப்பை ' + ev.formation + ' ஆக மாற்றுகிறது.');
    default: return null;
  }
}
// the teleprompter follows the newest line only while the presenter is already on it
function bcPushLine(line) {
  const atEnd = BC.cursor >= BC.script.length - 1;
  BC.script.push(line); if (BC.script.length > 400) { BC.script.shift(); BC.cursor = Math.max(0, BC.cursor - 1); }
  if (atEnd) BC.cursor = BC.script.length - 1;
}
function bcSpeak(text, lang) {
  if (!window.speechSynthesis || !text) return;
  try { const L = lang === 'ta' ? 'ta-IN' : 'en-GB', u = new SpeechSynthesisUtterance(text); u.lang = L;
    const v = speechSynthesis.getVoices().find((x) => x.lang.toLowerCase().startsWith(L.slice(0, 2).toLowerCase())); if (v) u.voice = v;
    speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { console.error(e); }
}
function bcShellScript() {
  $('pane-script').innerHTML = '<div class="bc-h">Script <small>teleprompter and talking points</small></div>'
    + '<div class="bc-sec"><h4>Teleprompter <span class="bc-tag">' + (BC.lang === 'ta' ? 'தமிழ் · drafted' : 'English · Tamil drafted') + '</span></h4>'
    + '<div class="bc-teleprompt"><div class="now" id="sc-now"></div><div class="next" id="sc-next"></div></div>'
    + '<div class="bc-btnrow"><button class="bc-btn" id="sc-prev">◂ Back</button><button class="bc-btn pri" id="sc-nx">Read next ▸</button><button class="bc-btn" id="sc-latest">Latest</button><button class="bc-btn" id="sc-speak">🔊 Speak</button></div>'
    + '<div class="bc-foot">Voice is the browser’s speech in this prototype. In production it is Azure Speech. Tamil lines are drafted and need a native-speaker check before air.</div></div>'
    + '<div class="bc-sec"><h4>Lines so far</h4><div id="sc-lines"></div></div>'
    + '<div class="bc-sec"><h4>What to say <span class="bc-tag">English</span></h4><div id="sc-talk"></div></div>';
  $('sc-prev').onclick = () => { BC.cursor = Math.max(0, BC.cursor - 1); bcPaintScript(); };
  $('sc-nx').onclick = () => { BC.cursor = Math.min(BC.script.length - 1, BC.cursor + 1); bcPaintScript(); };
  $('sc-latest').onclick = () => { BC.cursor = Math.max(0, BC.script.length - 1); bcPaintScript(); };
  $('sc-speak').onclick = () => { const l = BC.script[BC.cursor]; if (l) bcSpeak(BC.lang === 'ta' ? l.ta : l.en, BC.lang); };
}
// talking points: the engine's ranked storylines, plus facts from the sim's own stats, each with where it came from
function bcTalkingPoints(P) {
  const pts = [];
  for (const s of (P.storylines || []).slice(0, 4)) pts.push({ t: s.title + '. ' + s.text, src: 'predict.js storyline' });
  const xg = STATS.xg, sh = STATS.shots, ot = STATS.onTarget, poss = STATS.poss, ps = poss[0] + poss[1];
  if (S.started && (xg[0] + xg[1] > 0 || sh[0] + sh[1] > 0)) {
    pts.push({ t: 'Chances: ' + bcTeam(0) + ' ' + bcRound(xg[0], 2) + ' xG from ' + sh[0] + ' shots, ' + bcTeam(1) + ' ' + bcRound(xg[1], 2) + ' from ' + sh[1] + ' (' + ot[0] + ' and ' + ot[1] + ' on target).', src: 'sim stats (STATS)' });
  }
  if (ps > 0) pts.push({ t: 'Possession: ' + bcTeam(0) + ' ' + Math.round(poss[0] / ps * 100) + '%, ' + bcTeam(1) + ' ' + Math.round(poss[1] / ps * 100) + '%.', src: 'sim stats (STATS)' });
  if (P.wild) pts.push({ t: P.wild.text + '. ' + P.wild.why, src: 'predict.js wild cue' });
  return pts;
}
function bcPaintScript(P) {
  if (!$('sc-now')) bcShellScript();
  const ta = BC.lang === 'ta', L = BC.script[BC.cursor], N = BC.script.slice(BC.cursor + 1, BC.cursor + 3);
  const now = $('sc-now'), nxt = $('sc-next');
  now.className = 'now' + (ta ? ' ta' : ''); nxt.className = 'next' + (ta ? ' ta' : '');
  const nowT = L ? (ta ? L.ta : L.en) : (S.started ? 'Waiting for the next moment…' : 'Waiting for kick-off.');
  if (now.textContent !== nowT) now.textContent = nowT;
  const nxtT = N.map((x) => (ta ? x.ta : x.en)).join('  ·  ');
  if (nxt.textContent !== nxtT) nxt.textContent = nxtT;
  bcSet('sc-lines', BC.script.slice(-40).reverse().map((x) => '<div class="bc-line' + (ta ? ' ta' : '') + '"><time>' + x.min + "'</time><div>" + bcEsc(ta ? x.ta : x.en) + '<span class="src">' + bcEsc(x.src) + '</span></div></div>').join('')
    || '<div class="bc-empty">Lines appear as the match runs: goals, cards, shots that matter, half-time and full-time.</div>');
  P = S.started ? (P || predNow()) : null;
  bcSet('sc-talk', P ? bcTalkingPoints(P).map((x) => '<div class="bc-row"><div class="k">' + bcEsc(x.t) + '<span class="why">' + bcSrc(x.src) + '</span></div></div>').join('') || '<div class="bc-empty">Talking points appear at kick-off.</div>' : '<div class="bc-empty">Talking points appear at kick-off.</div>');
}
