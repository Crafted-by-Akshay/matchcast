// ============ COPILOT: the four-agent match assistant (Producer, Analyst, Narrator, Verifier) ============
// Insights and coaching suggestions are computed from the live event log, and every claim carries the number of
// events it was checked against. Typed questions go to Claude when the viewer allows it; otherwise the Analyst answers.
const CP = { open: false, tab: 'ins', insights: [], seen: new Set(), chat: [], last: -1, sugg: [null, null], busy: false };
const evSince = (mins, type) => ENV.events.filter((e) => e.minute >= ENV.minute - mins && (!type || e.type === type));
const keyIdx = (k) => (TEAMS[0].key === k ? 0 : 1);
const suggLabel = (g) => [g.form, g.style && STYLES[g.style].label].filter(Boolean).join(', ');
function teamStamina(ti) { const t = teamOf(ti).filter((p) => !p.gk); return t.reduce((a, p) => a + p.stamina, 0) / Math.max(1, t.length); }
// ---- Analyst: findings from the event log, each with the evidence count the Verifier checked ----
function analyse(win) {
  const out = []; const E = evSince(win); const passes = E.filter((e) => e.type === 'pass'); const turns = E.filter((e) => e.type === 'turnover');
  const pp = [0, 1].map((ti) => passes.filter((e) => keyIdx(e.team) === ti).length); const tot = pp[0] + pp[1];
  if (tot >= 8) { const ti = pp[0] >= pp[1] ? 0 : 1; const share = Math.round(pp[ti] / tot * 100); const ph = {}; passes.filter((e) => keyIdx(e.team) === ti).forEach((e) => { ph[e.phase] = (ph[e.phase] || 0) + 1; }); const top = Object.entries(ph).sort((a, b) => b[1] - a[1])[0];
    if (share >= 58) out.push({ id: 'ctrl' + ti, icon: '🎯', title: TEAMS[ti].club + ' control the ball', text: share + '% of the passes in the last ' + win + ' minutes, mostly in ' + (top ? top[0] : 'midfield') + '. ' + TEAMS[1 - ti].club + ' sit in a ' + phaseOf(1 - ti) + '.', n: tot }); }
  [0, 1].forEach((ti) => { const hi = turns.filter((e) => keyIdx(e.team) === ti && e.ownX > 60); if (hi.length >= 2) out.push({ id: 'press' + ti + Math.floor(ENV.minute / 15), icon: '⚡', title: TEAMS[ti].club + '\'s press is biting', text: hi.length + ' high regains in the opposition half in ' + win + ' minutes' + (hi[0].phase ? ', mostly while ' + TEAMS[1 - ti].club + ' were in ' + hi[0].phase : '') + '.', n: turns.length }); });
  const slips = E.filter((e) => e.type === 'slip').length; const longB = passes.filter((e) => e.kind === 'long ball' || e.kind === 'lofted pass').length;
  if (slips >= 2 || (ENV.wet > 0.5 && tot > 6)) out.push({ id: 'wx' + ENV.pitch + Math.floor(ENV.minute / 20), icon: '🌧️', title: 'The pitch is changing the game', text: ENV.pitch + ' surface: ' + slips + ' slips and ' + Math.round(longB / Math.max(1, tot) * 100) + '% of passes in the air recently. ' + (ENV.puddle > 0.2 ? 'The ball is holding up in puddles.' : 'Passes are skidding through quickly.'), n: slips + tot });
  if (ENV.heat > 0.6 || ENV.altF > 0.5) { const s = [0, 1].map(teamStamina); out.push({ id: 'load' + Math.floor(ENV.minute / 20), icon: ENV.altF > 0.5 ? '⛰️' : '🥵', title: ENV.altF > 0.5 ? 'Altitude is taking its toll' : 'Heat is draining legs', text: 'Average energy ' + TEAMS[0].key + ' ' + Math.round(s[0] * 100) + '%, ' + TEAMS[1].key + ' ' + Math.round(s[1] * 100) + '%. WBGT ' + ENV.wbgt.toFixed(1) + '°C, air ' + Math.round(ENV.rhoRatio * 100) + '% of sea level.', n: 22 }); }
  const tired = players.filter((p) => !p.off && !p.gk && p.stamina < 0.4).sort((a, b) => a.stamina - b.stamina)[0];
  if (tired) out.push({ id: 'tired' + tired.name + Math.floor(ENV.minute / 25), icon: '🔋', title: surname(tired.name) + ' is running on empty', text: tired.name + ' (' + tired.T.key + ', ' + tired.pos + ') is down to ' + Math.round(tired.stamina * 100) + '% energy. A substitution would make sense.', n: 1 });
  const off = ENV.events.filter((e) => e.type === 'offside'); [0, 1].forEach((ti) => { const c = off.filter((e) => keyIdx(e.team) === ti).length; if (c >= 2) out.push({ id: 'off' + ti + c, icon: '🚩', title: TEAMS[1 - ti].club + '\'s line is catching runners', text: TEAMS[ti].club + ' have been flagged offside ' + c + ' times. ' + TEAMS[1 - ti].club + ' hold a ' + (TEAMS[1 - ti].tac.cur.line > 0.6 ? 'high' : 'disciplined') + ' line.', n: c }); });
  const fouls = ENV.events.filter((e) => e.type === 'foul'); [0, 1].forEach((ti) => { const c = fouls.filter((e) => keyIdx(e.team) === ti).length; if (c >= 3) out.push({ id: 'foul' + ti + c, icon: '🟨', title: TEAMS[ti].club + ' are living dangerously', text: c + ' fouls and ' + STATS.yellows[ti] + ' yellow card' + (STATS.yellows[ti] === 1 ? '' : 's') + '. Their ' + STYLES[TEAMS[ti].tac.style].label.toLowerCase() + ' approach means a lot of challenges.', n: c }); });
  if (STATS.shots[0] + STATS.shots[1] >= 3) { const ti = STATS.xg[0] >= STATS.xg[1] ? 0 : 1; if (STATS.xg[ti] - STATS.xg[1 - ti] > 0.25) out.push({ id: 'xg' + ti + Math.floor(STATS.xg[ti] * 4), icon: '📈', title: TEAMS[ti].club + ' are creating the better chances', text: 'xG ' + STATS.xg[ti].toFixed(2) + ' from ' + STATS.shots[ti] + ' shots against ' + STATS.xg[1 - ti].toFixed(2) + ' from ' + STATS.shots[1 - ti] + '.' + (S.score[ti] < S.score[1 - ti] ? ' The scoreline flatters ' + TEAMS[1 - ti].club + '.' : ''), n: STATS.shots[0] + STATS.shots[1] }); }
  return out;
}
// ---- Coach: one tactical suggestion per team, grounded in the same numbers ----
function suggest(ti) {
  const T = TEAMS[ti], c = T.tac.cur, mn = ENV.minute, diff = S.score[ti] - S.score[1 - ti]; const E = evSince(12);
  const lostHigh = E.filter((e) => e.type === 'turnover' && keyIdx(e.team) === 1 - ti && e.ownX > 60).length; const poss = possPct(ti);
  if (mn >= 55 && diff < 0 && T.tac.form !== '3-4-3') return { form: '3-4-3', style: 'gegenpress', why: 'Behind with ' + Math.round(90 - mn) + ' minutes left: go to a back three and press high.' };
  if (mn >= 70 && diff > 0 && T.tac.form !== '5-4-1') return { form: '5-4-1', style: 'lowblock', why: 'Protect the lead: five at the back and a low block.' };
  if (ENV.puddle > 0.3 && c.short > 0.5) return { style: 'direct', why: 'The ball is sticking in the water. Stop playing out and go long.' };
  if (lostHigh >= 3 && c.short > 0.5) return { style: 'direct', why: lostHigh + ' balls lost under pressure in their own half. Bypass the press with longer passes.' };
  if (ENV.heat > 0.7 && c.press > 0.6) return { style: 'balanced', why: 'WBGT ' + ENV.wbgt.toFixed(1) + '°C. Drop into a mid-block to save energy.' };
  if (teamStamina(ti) < 0.5 && c.press > 0.6) return { style: 'balanced', why: 'Energy is down to ' + Math.round(teamStamina(ti) * 100) + '%. Ease off the press.' };
  if (poss < 40 && T.tac.style === 'possession') return { style: 'counter', why: 'Only ' + poss + '% of the ball. Sit deeper and hit them on the break.' };
  if (poss > 62 && STATS.shots[ti] <= STATS.shots[1 - ti] && T.tac.form !== '4-2-3-1') return { form: '4-2-3-1', why: poss + '% possession but no more shots than the opponent. Add a number 10 between the lines.' };
  return null;
}
function applySuggestion(ti) {
  const s = CP.sugg[ti]; if (!s) return; const T = TEAMS[ti];
  if (s.form) applyFormation(ti, s.form); if (s.style) setStyle(ti, s.style);
  dataEvent('tactical_change', { team: T.key, formation: T.tac.form, style: T.tac.style, why: s.why, by: 'Copilot suggestion' });
  say('On the Copilot\'s advice, ' + T.club + ' switch to ' + T.tac.form + ', ' + STYLES[T.tac.style].label.toLowerCase() + '.'); toast('🔁<small>' + T.club.toUpperCase() + ' · ' + T.tac.form + ' · ' + STYLES[T.tac.style].label.toUpperCase() + '</small>', 2);
  CP.sugg[ti] = null; renderTacTab();
}
// ---- the live loop: every match minute the agents look again ----
function copilotReset() { CP.insights = []; CP.seen = new Set(); CP.chat = []; CP.last = -1; CP.sugg = [null, null]; $('cp-feed').innerHTML = ''; $('cp-log').innerHTML = ''; renderTacTab(); agentState(); }
function copilotTick(min) {
  if (min - CP.last < 3 && min > 1) return; CP.last = min;
  for (const f of analyse(12)) { if (CP.seen.has(f.id)) continue; CP.seen.add(f.id); f.min = min + 1; CP.insights.unshift(f); addInsight(f); if (!CP.open) $('cpbtn').classList.add('ping'); }
  CP.sugg = [suggest(0), suggest(1)]; renderTacTab(); agentState();
}
function addInsight(f) {
  const el = document.createElement('div'); el.className = 'ins';
  el.innerHTML = '<div class="ih"><i>' + f.icon + '</i><b>' + f.title + '</b><span>' + f.min + '\'</span></div><p>' + f.text + '</p><div class="iv">✓ Verifier: checked against ' + f.n + ' event' + (f.n === 1 ? '' : 's') + '</div>';
  const feed = $('cp-feed'); feed.prepend(el); while (feed.children.length > 30) feed.lastChild.remove();
}
function agentState() {
  const cams = { broadcast: 'Broadcast', high: 'Tactical', player: 'Player cam', ball: 'Ball cam', goal: 'Behind goal', free: 'Free' };
  $('ag-prod').textContent = 'Camera: ' + (cams[S.cam] || 'Broadcast'); $('ag-ana').textContent = CP.insights.length + ' insights'; $('ag-nar').textContent = ($('cap1').textContent || '').slice(0, 38) + '…'; 
}
// ---- tactics tab: live radar of all 22 plus each team's shape, phase, settings and a suggestion ----
const radar = { dots: null };
function renderTacTab() {
  const box = $('cp-teams'); if (!TEAMS[0].tac) return; box.innerHTML = '';
  TEAMS.forEach((T, ti) => {
    const c = T.tac.cur; const s = CP.sugg[ti]; const meter = (k, v) => '<div class="mt"><span>' + k + '</span><i><b style="width:' + Math.round(clamp(v, 0, 1) * 100) + '%;background:' + T.css + '"></b></i></div>';
    const el = document.createElement('div'); el.className = 'cpt';
    el.innerHTML = '<div class="cph"><span class="tcrest" style="background:' + T.css + '">' + T.key + '</span><b>' + T.tac.form + ' · ' + STYLES[T.tac.style].label + '</b><em id="ph' + ti + '">' + phaseOf(ti) + '</em></div>' + meter('Press', c.press) + meter('Line height', c.line) + meter('Directness', c.direct) + meter('Energy', teamStamina(ti))
      + (s ? '<div class="sg"><p><b>Copilot suggests:</b> ' + suggLabel(s) + '. ' + s.why + '</p><button class="btn pri sm" data-ti="' + ti + '">Apply</button></div>' : '<div class="sg ok">No change needed. The plan is working.</div>');
    box.appendChild(el);
  });
  for (const b of box.querySelectorAll('button[data-ti]')) b.onclick = () => applySuggestion(+b.dataset.ti);
}
function drawRadar() {
  if (!CP.open || CP.tab !== 'tac' || !players.length) return; const svg = $('cp-radar');
  if (!radar.dots) { radar.dots = players.map((p) => { const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('r', p.gk ? 1.6 : 1.9); c.setAttribute('fill', p.gk ? '#E9F2EA' : p.T.css); c.setAttribute('stroke', '#0A0E13'); c.setAttribute('stroke-width', '0.4'); svg.appendChild(c); return c; }); radar.ball = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); radar.ball.setAttribute('r', 1.1); radar.ball.setAttribute('fill', '#FFE066'); svg.appendChild(radar.ball); }
  players.forEach((p, i) => { radar.dots[i].setAttribute('cx', p.pos2.x.toFixed(1)); radar.dots[i].setAttribute('cy', p.pos2.y.toFixed(1)); radar.dots[i].style.display = p.off ? 'none' : ''; });
  radar.ball.setAttribute('cx', ball.p.x.toFixed(1)); radar.ball.setAttribute('cy', ball.p.z.toFixed(1));
  for (const ti of [0, 1]) { const e = $('ph' + ti); if (e) e.textContent = phaseOf(ti); }
}
setInterval(drawRadar, 250);
// ---- ask tab: instant grounded answers for the suggested questions, Claude for anything typed ----
function ruleAnswer(q) {
  q = q.toLowerCase(); const s = summary(); const f = analyse(20);
  if (/weather|rain|wet|heat|hot|cold|fog|snow|pitch|altitude|wind/.test(q)) return 'Now ' + WX[ENV.wx].label.toLowerCase() + ', ' + Math.round(ENV.temp) + '°C, ' + Math.round(ENV.rh) + '% humidity, wind ' + Math.round(ENV.wind * 3.6) + ' km/h; the pitch is ' + ENV.pitch.toLowerCase() + '. ' + (f.find((x) => x.icon === '🌧️' || x.icon === '🥵' || x.icon === '⛰️')?.text || 'Conditions are not a big factor yet: ' + ENV.events.filter((e) => e.type === 'slip').length + ' slips so far.');
  if (/tir|stamina|energy|fatigue|legs|sub/.test(q)) { const t = players.filter((p) => !p.off && !p.gk).sort((a, b) => a.stamina - b.stamina).slice(0, 3); return 'Most tired: ' + t.map((p) => p.name + ' (' + p.T.key + ') ' + Math.round(p.stamina * 100) + '%').join(', ') + '. Team energy ' + TEAMS[0].key + ' ' + Math.round(teamStamina(0) * 100) + '%, ' + TEAMS[1].key + ' ' + Math.round(teamStamina(1) * 100) + '%.'; }
  if (/foul|card|offside|ref|penalt/.test(q)) { const e = [...ENV.events].reverse().find((x) => ['foul', 'offside', 'yellow_card', 'red_card'].includes(x.type)); return 'Fouls ' + s.fouls.join('–') + ', yellow cards ' + s.yellowCards.join('–') + ', offsides ' + s.offsides.join('–') + '. ' + (e ? 'Latest: ' + e.type.replace('_', ' ') + ' by ' + e.player + ' at ' + Math.floor(e.minute) + '\'' + (e.kind ? ' (' + e.kind + ')' : '') + '.' : 'No incidents yet.'); }
  if (/change|should|tactic|formation|press|switch/.test(q)) { const out = [0, 1].map((ti) => { const g = CP.sugg[ti] || suggest(ti); return TEAMS[ti].club + ': ' + (g ? suggLabel(g) + '. ' + g.why : 'stay with ' + TEAMS[ti].tac.form + ', ' + STYLES[TEAMS[ti].tac.style].label.toLowerCase() + '.'); }); return out.join(' '); }
  const lead = S.score[0] === S.score[1] ? 'It is level at ' + S.score.join('-') : TEAMS[S.score[0] > S.score[1] ? 0 : 1].club + ' lead ' + Math.max(...S.score) + '-' + Math.min(...S.score);
  return lead + '. Possession ' + s.possessionPct.join('–') + '%, shots ' + s.shots.join('–') + ', xG ' + s.xg.join('–') + '. ' + (f[0] ? f[0].title + ': ' + f[0].text : '');
}
let SAMPLE = null; (window.claude && window.claude.use ? window.claude.use('sample') : Promise.resolve(null)).then((x) => { SAMPLE = x; }).catch(() => {});
function chatAdd(who, text) { const el = document.createElement('div'); el.className = 'msg ' + who; el.innerHTML = '<span>' + (who === 'me' ? 'You' : who === 'ai' ? '✦ Copilot' : '📊 Analyst') + '</span><p></p>'; el.querySelector('p').textContent = text; $('cp-log').appendChild(el); $('cp-log').scrollTop = 1e6; return el.querySelector('p'); }
async function ask(q, typed) {
  if (!q.trim() || CP.busy) return; chatAdd('me', q); $('cp-q').value = '';
  if (!typed || !SAMPLE) { chatAdd('ana', ruleAnswer(q)); return; }
  CP.busy = true; const out = chatAdd('ai', 'Thinking…');
  const ctx = { minute: Math.floor(ENV.minute), score: S.score, teams: TEAMS.map((T, ti) => ({ key: T.key, club: T.club, formation: T.tac.form, style: STYLES[T.tac.style].label, phase: phaseOf(ti), energyPct: Math.round(teamStamina(ti) * 100) })),
    stats: summary(), conditions: { weather: WX[ENV.wx].label, tempC: +ENV.temp.toFixed(1), humidity: Math.round(ENV.rh), windKmh: Math.round(ENV.wind * 3.6), wbgtC: +ENV.wbgt.toFixed(1), pitch: ENV.pitch, altitudeM: SET.st.alt, stadium: SET.st.name + ', ' + SET.st.city },
    analystFindings: analyse(20).map((f) => f.title + ': ' + f.text), recentEvents: ENV.events.filter((e) => e.type !== 'pass').slice(-25) };
  try {
    const { text } = await SAMPLE('You are MatchCast Copilot, a football broadcast analyst inside a live match app. Answer the viewer\'s question in at most 4 short sentences, plain text, citing numbers from the data. Use only facts in the JSON; if the data cannot answer, say so.\n\nQuestion: ' + q + '\n\nMatch data (JSON):\n' + JSON.stringify(ctx), { modelTier: 'quick', cache: false, onText: ({ text }) => { out.textContent = text; } });
    out.textContent = text;
  } catch (e) { out.parentElement.querySelector('span').textContent = '📊 Analyst'; out.textContent = ruleAnswer(q); }
  CP.busy = false;
}
// ---- pane wiring ----
function setTab(t) { CP.tab = t; for (const b of document.querySelectorAll('#cp-tabs button')) b.setAttribute('aria-selected', b.dataset.t === t ? 'true' : 'false'); for (const k of ['ins', 'tac', 'talk', 'verify', 'ask']) $('cp-' + k).hidden = k !== t; if (t === 'tac') renderTacTab(); if (t === 'talk') renderTalk(); if (t === 'verify') renderVerify(); }
for (const b of document.querySelectorAll('#cp-tabs button')) b.onclick = () => setTab(b.dataset.t);
$('cpbtn').onclick = () => { CP.open = !CP.open; $('copilot').hidden = !CP.open; document.body.classList.toggle('cp-open', CP.open); $('cpbtn').classList.remove('ping'); $('cpbtn').setAttribute('aria-expanded', CP.open); if (CP.open) { agentState(); renderTacTab(); } };
$('cp-close').onclick = () => $('cpbtn').onclick();
$('cp-form').onsubmit = (e) => { e.preventDefault(); ask($('cp-q').value, true); };
for (const b of document.querySelectorAll('#cp-chips button')) b.onclick = () => ask(b.textContent, false);
window.copilotReset = copilotReset; window.copilotTick = copilotTick;
