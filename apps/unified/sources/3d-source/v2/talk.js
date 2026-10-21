// ============ TALK: call any player live, give an instruction and hear him answer ============
// Orders change how that player positions and decides (think/decide read p.orders). Quick orders answer instantly;
// anything typed or spoken goes to Claude in the player's voice when the viewer allows it, otherwise a keyword parser.
const ORDERS = {
  push: { icon: '⬆️', label: 'Push higher', says: ['Got it, I\'ll step up and squeeze them.', 'Pushing on. I\'ll live on their last man.', 'Higher it is, boss.'] },
  deep: { icon: '⬇️', label: 'Drop deeper', says: ['Dropping in. I\'ll give us an extra body behind the ball.', 'Okay, I\'ll sit deeper and keep it tight.', 'Coming back, I\'ve got the space in front of the back line.'] },
  wide: { icon: '↔️', label: 'Hold the width', says: ['I\'ll hug the touchline and stretch them.', 'Staying wide, chalk on my boots.', 'Wide it is. Find me early.'] },
  inside: { icon: '↘️', label: 'Come inside', says: ['I\'ll tuck in between the lines.', 'Coming inside to overload the middle.', 'Okay, I\'ll drift into the half-space.'] },
  press: { icon: '⚡', label: 'Press the ball', says: ['I\'ll hunt the ball. No time on it for them.', 'Pressing now, I\'ll close the passing lane.', 'On it. I\'ll set the trap.'] },
  mark: { icon: '🎯', label: 'Man-mark their danger man', says: ['I\'ll follow {t} everywhere.', '{t} won\'t get a touch. I\'m on him.', 'Shadowing {t}. Leave him to me.'] },
  shoot: { icon: '🚀', label: 'Shoot on sight', says: ['If I see the goal, I\'m hitting it.', 'Their keeper\'s cold. I\'ll test him.', 'Next chance from range, I\'m letting fly.'] },
  simple: { icon: '✓', label: 'Keep it simple', says: ['Two touches, safe pass. Understood.', 'I\'ll keep the ball moving and take no risks.', 'Simple it is. Give and go.'] },
  runs: { icon: '🏃', label: 'Run in behind', says: ['I\'ll keep spinning in behind their line.', 'Look for me over the top.', 'Running the channels, boss.'] },
  rest: { icon: '🔋', label: 'Save your legs', says: ['Thanks, I\'ll pick my moments.', 'Managing it. I\'ll be ready when it matters.', 'Good call, the legs are heavy.'] },
};
const TK = { ti: 0, p: null, voice: true, busy: false, rec: null, log: new Map() };
const tkPick = (a) => a[Math.floor(Math.random() * a.length)];
function dangerMan(ti) { return teamOf(1 - ti).filter((q) => !q.gk).sort((a, b) => (b.rating + (['ST', 'AM', 'LW', 'RW'].includes(b.pos) ? 4 : 0)) - (a.rating + (['ST', 'AM', 'LW', 'RW'].includes(a.pos) ? 4 : 0)))[0]; }
function pStats(p) { const E = ENV.events.filter((e) => e.player === p.name); const c = (t) => E.filter((e) => e.type === t).length; return { passes: c('pass'), shots: c('shot'), takeOns: E.filter((e) => e.type === 'take_on' && e.success).length, fouls: c('foul'), goals: c('goal') }; }
function setOrder(p, k, text, by) {
  if (!k || k === 'none') return;
  if (k === 'clear') { p.orders = null; } else { p.orders = { k, target: k === 'mark' ? (p.orders?.target || dangerMan(p.ti)) : null, at: Math.floor(ENV.minute) }; }
  p.call = 1.2; // he raises an arm to acknowledge
  if (p.ordEl) p.ordEl.textContent = p.orders ? ORDERS[p.orders.k].icon : '';
  dataEvent('player_instruction', { team: p.T.key, player: p.name, order: k, text: text || (ORDERS[k] ? ORDERS[k].label : 'clear'), by: by || 'manager' });
}
function speak(p, text) {
  if (!TK.voice || !window.speechSynthesis) return;
  try { const u = new SpeechSynthesisUtterance(text); const vs = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)); if (vs.length) u.voice = vs[(p.num * 7 + p.ti * 3) % vs.length]; u.pitch = 0.85 + ((p.num * 13) % 10) / 40; u.rate = 1.04; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {}
}
function talkLine(p, who, text) {
  const arr = TK.log.get(p) || []; arr.push({ who, text, min: Math.floor(ENV.minute) }); TK.log.set(p, arr.slice(-30));
  if (TK.p === p) renderTalkLog();
}
function keywordOrder(q) {
  q = q.toLowerCase();
  const m = [['clear', /forget|as you were|cancel|normal|reset/], ['rest', /rest|legs|breath|tired|easy|conserve/], ['shoot', /shoot|shot|strike|hit it|range/], ['mark', /mark|follow|track|shadow|man.?to.?man/], ['press', /press|hunt|close down|harass|win it back/], ['runs', /run|behind|in behind|channel|over the top|space/], ['simple', /simple|safe|keep (the )?ball|possession|calm/], ['wide', /wide|width|touchline|stretch/], ['inside', /inside|tuck|narrow|half.?space|centre|center/], ['deep', /deep|back|drop|defend|sit/], ['push', /push|higher|up the pitch|forward|attack|squeeze/]];
  for (const [k, re] of m) if (re.test(q)) return k; return 'none';
}
function ruleReply(p, k) {
  if (k === 'clear') return 'Back to the plan, boss.';
  if (k === 'none') return tkPick(['Understood, boss.', 'I hear you.', 'Okay. Got it.']) + (p.stamina < 0.45 ? ' Legs are going a bit though.' : '');
  return tkPick(ORDERS[k].says).replace('{t}', p.orders?.target ? surname(p.orders.target.name) : 'him') + (p.stamina < 0.4 && k !== 'rest' ? ' I\'m running on fumes, mind.' : '');
}
async function sendToPlayer(p, text, quick) {
  if (!p || !text.trim() || TK.busy) return;
  talkLine(p, 'me', text); $('tk-q').value = '';
  if (quick || !SAMPLE) { const k = quick || keywordOrder(text); setOrder(p, k, text); const r = ruleReply(p, k); talkLine(p, 'pl', r); speak(p, r); renderTalk(); return; }
  TK.busy = true; $('tk-send').disabled = true; talkLine(p, 'pl', '…');
  const ctx = { you: { name: p.name, number: p.num, position: p.pos, club: p.T.club, rating: p.rating, energyPct: Math.round(p.stamina * 100), yellowCards: p.yellows || 0, currentInstruction: p.orders ? ORDERS[p.orders.k].label : null, matchStats: pStats(p) },
    match: { minute: Math.floor(ENV.minute), score: TEAMS[0].club + ' ' + S.score[0] + '-' + S.score[1] + ' ' + TEAMS[1].club, yourFormation: p.T.tac.form, yourStyle: STYLES[p.T.tac.style].label, phase: phaseOf(p.ti), weather: WX[ENV.wx].label, pitch: ENV.pitch, tempC: Math.round(ENV.temp), opponentDangerMan: dangerMan(p.ti).name } };
  let k = 'none', reply = '';
  try {
    const out = await SAMPLE.json('You are a professional footballer at a World Cup, wearing a radio earpiece. Your manager just spoke to you during live play. Stay fully in character. Pick which instruction the manager gave from exactly one of: push (play higher), deep (drop deeper), wide (hold width), inside (come inside), press (press the ball), mark (man-mark the opponent danger man), shoot (shoot on sight), simple (keep it simple), runs (run in behind), rest (save energy), clear (cancel the instruction), none (just talking). Reply to the manager in at most 2 short spoken sentences, natural and confident, using the context if useful. Return JSON {"order": string, "reply": string}.\n\nManager says: "' + text + '"\n\nContext: ' + JSON.stringify(ctx), { modelTier: 'quick', cache: false });
    k = ORDERS[out?.order] || out?.order === 'clear' ? out.order : 'none'; reply = String(out?.reply || '').slice(0, 260);
  } catch (e) { k = keywordOrder(text); }
  const arr = TK.log.get(p); if (arr && arr.length && arr[arr.length - 1].text === '…') arr.pop();
  setOrder(p, k, text); if (!reply) reply = ruleReply(p, k); talkLine(p, 'pl', reply); speak(p, reply);
  TK.busy = false; $('tk-send').disabled = false; renderTalk();
}
// ---- UI ----
function openTalk(p) {
  if (!CP.open) $('cpbtn').onclick();
  setTab('talk'); if (p) { TK.ti = p.ti; TK.p = p; p.call = 0.8; } renderTalk();
}
function renderTalk() {
  if (!$('cp-talk') || !TEAMS[0].tac) return;
  for (const b of document.querySelectorAll('#tk-teams button')) b.setAttribute('aria-pressed', +b.dataset.ti === TK.ti ? 'true' : 'false');
  const T = TEAMS[TK.ti]; $('tk-teams').style.setProperty('--tc', T.css);
  const roster = $('tk-roster'); roster.innerHTML = '';
  teamOf(TK.ti).concat(players.filter((q) => q.ti === TK.ti && q.off)).forEach((p) => {
    const b = document.createElement('button'); b.className = 'tkp' + (TK.p === p ? ' on' : '') + (p.off ? ' off' : ''); b.disabled = !!p.off; b.style.setProperty('--tc', p.T.css);
    b.innerHTML = '<b>' + p.num + '</b><span>' + surname(p.name) + '</span><em>' + p.pos + (p.orders ? ' ' + ORDERS[p.orders.k].icon : '') + '</em><i style="width:' + Math.round(p.stamina * 100) + '%"></i>';
    b.onclick = () => { TK.p = p; p.call = 0.8; renderTalk(); }; roster.appendChild(b);
  });
  const p = TK.p && TK.p.ti === TK.ti ? TK.p : null; $('tk-card').hidden = !p; $('tk-empty').hidden = !!p;
  if (!p) return;
  const st = pStats(p);
  $('tk-head').innerHTML = '<span class="tkn" style="background:' + p.T.css + '">' + p.num + '</span><div><b>' + p.name + '</b><small>' + p.pos + ' · ' + p.T.club + ' · rating ' + p.rating + '</small></div><div class="tke"><small>Energy</small><b>' + Math.round(p.stamina * 100) + '%</b></div>';
  $('tk-stats').innerHTML = [['Passes', st.passes], ['Shots', st.shots], ['Take-ons won', st.takeOns], ['Fouls', st.fouls]].map(([k, v]) => '<div><b>' + v + '</b><small>' + k + '</small></div>').join('');
  $('tk-cur').innerHTML = p.orders ? '<span>' + ORDERS[p.orders.k].icon + ' ' + ORDERS[p.orders.k].label + (p.orders.target ? ': ' + surname(p.orders.target.name) : '') + ' <small>since ' + p.orders.at + '\'</small></span><button class="btn sm" id="tk-clear">Clear</button>' : '<span class="none">No personal instruction. Playing to the team plan.</span>';
  const cl = $('tk-clear'); if (cl) cl.onclick = () => sendToPlayer(p, 'Forget that, back to the plan.', 'clear');
  const qo = $('tk-orders'); qo.innerHTML = '';
  for (const k in ORDERS) { const b = document.createElement('button'); b.innerHTML = '<i>' + ORDERS[k].icon + '</i>' + ORDERS[k].label; b.setAttribute('aria-pressed', p.orders?.k === k ? 'true' : 'false'); b.onclick = () => sendToPlayer(p, ORDERS[k].label + (k === 'mark' ? ' (' + surname(dangerMan(p.ti).name) + ')' : '') + '.', k); qo.appendChild(b); }
  renderTalkLog();
}
function renderTalkLog() {
  const p = TK.p; const box = $('tk-log'); if (!p || !box) return; box.innerHTML = '';
  for (const m of TK.log.get(p) || []) { const el = document.createElement('div'); el.className = 'msg ' + (m.who === 'me' ? 'me' : 'pl'); el.innerHTML = '<span>' + (m.who === 'me' ? 'You · ' + m.min + '\'' : '#' + p.num + ' ' + surname(p.name)) + '</span><p></p>'; el.querySelector('p').textContent = m.text; box.appendChild(el); }
  box.scrollTop = 1e6;
}
for (const b of document.querySelectorAll('#tk-teams button')) b.onclick = () => { TK.ti = +b.dataset.ti; TK.p = null; renderTalk(); };
$('tk-form').onsubmit = (e) => { e.preventDefault(); sendToPlayer(TK.p, $('tk-q').value); };
$('tk-voice').onclick = () => { TK.voice = !TK.voice; $('tk-voice').setAttribute('aria-pressed', TK.voice); $('tk-voice').textContent = TK.voice ? '🔊' : '🔇'; if (!TK.voice && window.speechSynthesis) speechSynthesis.cancel(); };
// push-to-talk where the browser allows speech recognition; otherwise the mic button hides and typing works
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; const mic = $('tk-mic');
  if (!SR) { mic.hidden = true; return; }
  mic.onclick = () => {
    if (TK.rec) { TK.rec.stop(); return; }
    try {
      const r = new SR(); r.lang = 'en-US'; r.interimResults = true; TK.rec = r; mic.classList.add('live'); $('tk-q').placeholder = 'Listening…';
      r.onresult = (e) => { const t = [...e.results].map((x) => x[0].transcript).join(' '); $('tk-q').value = t; if (e.results[e.results.length - 1].isFinal) { r.stop(); sendToPlayer(TK.p, t); } };
      r.onerror = (e) => { $('tk-note').textContent = e.error === 'not-allowed' ? 'Microphone isn\'t allowed here. Type your message instead.' : 'Couldn\'t hear that. Try again or type.'; };
      r.onend = () => { TK.rec = null; mic.classList.remove('live'); $('tk-q').placeholder = 'Talk to the player…'; };
      r.start();
    } catch (e) { mic.hidden = true; }
  };
})();
setInterval(() => { if (CP.open && CP.tab === 'talk' && TEAMS[0].tac) renderTalkLive(); }, 1000);
function renderTalkLive() { const p = TK.p; if (!p) return; const e = document.querySelector('#tk-head .tke b'); if (e) e.textContent = Math.round(p.stamina * 100) + '%'; const bars = document.querySelectorAll('#tk-roster .tkp'); const list = teamOf(TK.ti); bars.forEach((b, i) => { const q = list[i]; if (q) b.querySelector('i').style.width = Math.round(q.stamina * 100) + '%'; }); }
function hookLabels() { if (TK.hooked || !players.length) return; TK.hooked = true; for (const p of players) { p.el.style.pointerEvents = 'auto'; p.el.style.cursor = 'pointer'; p.el.title = 'Talk to ' + p.name; p.el.addEventListener('click', () => openTalk(p)); const o = document.createElement('span'); o.className = 'ord'; p.el.querySelector('span:nth-child(2)').appendChild(o); p.ordEl = o; } }
function talkReset() { hookLabels(); TK.p = null; TK.log = new Map(); for (const p of players) { p.orders = null; if (p.ordEl) p.ordEl.textContent = ''; } }
window.openTalk = openTalk; window.talkReset = talkReset;
