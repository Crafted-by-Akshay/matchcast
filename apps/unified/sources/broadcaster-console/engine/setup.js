// ============ MATCH SETUP, MATCH FLOW, CONDITIONS HUD, DATA EXPORT ============
const SETR = subStream(1, 'setup'); // default picks before a seed is rolled
const pickForm = (r) => wPickR(FORM_W, r), pickStyle = (r) => wPickR(STYLE_W, r);
// the only unseeded draw for a new match: a brand-new seed. Everything else (picks, stadium, month, weather) comes from that seed
const newSeed = () => (Math.random() * 1e9) | 0;
function wPickR(w, r01) { let s = 0; for (const k in w) s += w[k]; let r = ((r01 || SETR)()) * s; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return Object.keys(w)[0]; }
const SET = { tactics: [0, 1].map(() => ({ form: 'auto', style: 'auto', pf: pickForm(), ps: pickStyle() })), st: STADIUMS[0], month: new Date().getMonth(), kickStr: '20:00', kick: 20, weather: 'auto', dynamic: true, water: true, roofAuto: true, half: 5, seed: newSeed() };
const parseHM = (s) => { const [h, m] = s.split(':').map(Number); return h + m / 60; };
const FAMILY = [['auto', 'Auto', '🎲'], ['sunny', 'Sunny', '☀️'], ['cloudy', 'Cloudy', '☁️'], ['rain', 'Rain', '🌧️'], ['storm', 'Thunderstorm', '⛈️'], ['fog', 'Fog', '🌫️'], ['snow', 'Snow', '❄️']];
const FAM_KEY = { sunny: 'sun', cloudy: 'cloud', rain: 'rain', storm: 'storm', fog: 'fog', snow: 'snow' };
const pct = (x) => (x < 0.005 ? '0%' : x < 0.01 ? '<1%' : Math.round(x * 100) + '%');
const fmtKm = (ms) => Math.round(ms * 3.6) + ' km/h';
const lightOf = (st, m, h) => { const el = solar(st, m, h).el; return el > 8 ? ['☀️', 'Daylight'] : el > -6 ? ['🌇', 'Sunset light'] : ['💡', 'Floodlit']; };

// ---- conditions forecast: what this day means for the football ----
function impacts() {
  const out = []; const st = SET.st; const odds = matchOdds(st, SET.month, SET.kick);
  if (ENV.wbgt >= 32) out.push(['🥵', 'Extreme heat stress (WBGT ' + ENV.wbgt.toFixed(1) + '°C). FIFA cooling breaks at 30\' and 75\'. High-intensity running falls by about a quarter.']);
  else if (ENV.wbgt >= 28) out.push(['🥵', 'Hot and humid (WBGT ' + ENV.wbgt.toFixed(1) + '°C). Sprints fade sooner and the tempo drops late on.']);
  else if (ENV.wbgt >= 24) out.push(['🌡️', 'Warm (WBGT ' + ENV.wbgt.toFixed(1) + '°C). Players tire a little faster.']);
  if (ENV.temp < 2) out.push(['🥶', ENV.temp.toFixed(0) + '°C. Cold muscles: sprint output drops below freezing' + (ENV.frozen ? ' and the pitch is frozen hard, so the ball bounces high.' : '. Undersoil heating keeps the pitch playable.')]);
  if (ENV.rhoRatio < 0.9) out.push(['⛰️', 'Air ' + Math.round((1 - ENV.rhoRatio) * 100) + '% thinner than at sea level. Long balls carry further and swerve less, and stamina drains faster.']);
  else if (ENV.rhoRatio < 0.95) out.push(['⛰️', 'Slightly thin air at ' + st.alt + ' m. The ball flies a touch further.']);
  if (ENV.wind * 3.6 > 22) out.push(['💨', 'Wind ' + fmtKm(ENV.wind) + '. Crosses and goal kicks drift.']);
  if (ENV.snow > 0.5 || ENV.wx === 'snow') out.push(['❄️', 'Snow. Orange ball, lines cleared, low and dead bounce.']);
  else if (ENV.puddle > 0.2) out.push(['💧', 'Standing water. The ball holds up in puddles, so teams go long.']);
  else if (ENV.water > 0.5) out.push(['💧', 'Wet, quick surface. Passes skid, players slip, keepers spill.']);
  else if (ENV.dew > 0.05) out.push(['🌙', 'Dew on the grass. The surface is slick and quick.']);
  else if (SET.water) out.push(['🚿', 'Watered before kick-off, so the ball zips across the grass.']);
  if (ENV.vis < 1500) out.push(['🌫️', 'Visibility about ' + Math.round(ENV.vis) + ' m. First touches get harder, and the referee must see both goals.']);
  if (odds.storm > 0.04 || ENV.wx === 'storm') out.push(['⚡', pct(odds.storm) + ' chance of a thunderstorm. Lightning within 13 km suspends play for at least 30 minutes.']);
  const ss = ENV.sunset; if (SET.kick < ss && SET.kick + 1.9 > ss) out.push(['🌇', 'Sunset at ' + hhmm(ss) + '. The floodlights take over during the match.']);
  else if (SET.kick > ss + 0.3 || SET.kick < ENV.sunrise) out.push(['💡', 'Night match under floodlights.']);
  if (!out.length) out.push(['✅', 'Ideal conditions: firm, true surface.']);
  return out.slice(0, 5);
}
function previewEnv() {
  initEnv(Object.assign({}, SET, { dynamic: false })); paintStadium(SET.st, SET.month);
  const w = WX[ENV.wx];
  $('fc-ico').textContent = w.icon; $('fc-wx').textContent = w.label; $('fc-mode').textContent = SET.weather === 'auto' ? 'Drawn from ' + SET.st.city + ' ' + MONTHS[SET.month] + ' climate' : 'Set by you';
  $('fc-t').textContent = Math.round(ENV.temp) + '°';
  const cells = [['Feels (WBGT)', ENV.wbgt.toFixed(1) + '°C'], ['Humidity', Math.round(ENV.rh) + '%'], ['Dew point', ENV.td.toFixed(1) + '°C'], ['Wind', fmtKm(ENV.wind)], ['Air density', Math.round(ENV.rhoRatio * 100) + '% of sea level'], ['Pitch', ENV.pitch], ['Sunset', hhmm(ENV.sunset)], ['Rain during match', pct(matchOdds(SET.st, SET.month, SET.kick).rain)]];
  $('fc-grid').innerHTML = cells.map(([k, v]) => '<div><span>' + k + '</span><b>' + v + '</b></div>').join('');
  $('fc-imp').innerHTML = impacts().map(([i, t]) => '<li><i>' + i + '</i><span>' + t + '</span></li>').join('');
}
function chip(label, sub, on, dis, fn, title) { const b = document.createElement('button'); b.className = 'chip'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.innerHTML = '<b>' + label + '</b>' + (sub ? '<small>' + sub + '</small>' : ''); if (dis) { b.disabled = true; } if (title) b.title = title; b.onclick = fn; return b; }
function renderSetup() {
  if (SET.seed !== undefined) rollAuto();
  const st = SET.st, m = SET.month;
  // hero
  $('su-hero').style.setProperty('--g1', st.grad[0]); $('su-hero').style.setProperty('--g2', st.grad[1]);
  $('su-flag').textContent = st.flag + ' ' + st.city.toUpperCase() + ', ' + st.country.toUpperCase();
  $('su-name').textContent = st.name; $('su-blurb').textContent = st.blurb;
  $('su-pills').innerHTML = [st.alt.toLocaleString('en') + ' m altitude', st.cap + ' seats', st.roof, st.grass, st.heated ? 'Undersoil heating' : 'No undersoil heating'].map((t) => '<span>' + t + '</span>').join('');
  // stadium posters
  const sr = $('su-stad'); if (!sr.children.length) STADIUMS.forEach((s) => {
    const b = document.createElement('button'); b.className = 'poster'; b.style.setProperty('--g1', s.grad[0]); b.style.setProperty('--g2', s.grad[1]); b.dataset.id = s.id;
    b.innerHTML = '<svg viewBox="0 0 120 70" aria-hidden="true"><ellipse cx="60" cy="44" rx="56" ry="22" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/><ellipse cx="60" cy="44" rx="40" ry="14" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.5)"/><rect x="44" y="39" width="32" height="10" rx="1" fill="none" stroke="rgba(255,255,255,.6)"/><line x1="60" y1="39" x2="60" y2="49" stroke="rgba(255,255,255,.6)"/>' + (s.roof.includes('Retract') ? '<path d="M8 40 Q60 0 112 40" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="2" stroke-dasharray="4 3"/>' : '') + (s.alt > 1000 ? '<path d="M0 22 L18 6 L30 16 L44 2 L62 20" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/>' : '') + '</svg><span class="pf">' + s.flag + ' ' + s.country + '</span><span class="pn">' + s.name + '</span><span class="pc">' + s.city + '</span><span class="pm">' + s.alt.toLocaleString('en') + ' m · ' + s.cap + '</span>';
    b.onclick = () => { SET.st = s; if (!s.kickoffs.includes(SET.kickStr)) { SET.kickStr = s.kickoffs[s.kickoffs.length - 1]; SET.kick = parseHM(SET.kickStr); } renderSetup(); };
    sr.appendChild(b);
  });
  for (const b of sr.children) b.setAttribute('aria-pressed', b.dataset.id === st.id ? 'true' : 'false');
  // months: icon of the likeliest weather at this kick-off hour plus the average high
  const mr = $('su-month'); mr.innerHTML = '';
  MONTHS.forEach((mn, i) => { const o = matchOdds(st, i, SET.kick); const c = climateOf(st, i); const top = o.snow > 0.25 ? '❄️' : o.storm > 0.25 ? '⛈️' : o.fog > 0.3 ? '🌫️' : o.rain > 0.45 ? '🌧️' : o.sun > o.cloud ? '☀️' : '☁️'; mr.appendChild(chip(mn, top + ' ' + Math.round(c.hi) + '°', i === m, false, () => { SET.month = i; renderSetup(); })); });
  // kick-off times used in that country's league, with how the light will be
  const kr = $('su-kick'); kr.innerHTML = '';
  st.kickoffs.forEach((k) => { const [ic, lab] = lightOf(st, m, parseHM(k)); kr.appendChild(chip(k, ic + ' ' + lab, k === SET.kickStr, false, () => { SET.kickStr = k; SET.kick = parseHM(k); renderSetup(); })); });
  // weather: chance of each family during a match at this stadium, month and hour; impossible ones are disabled
  const odds = matchOdds(st, m, SET.kick); const wr = $('su-wx'); wr.innerHTML = '';
  FAMILY.forEach(([id, label, ic]) => {
    const p = id === 'auto' ? null : odds[FAM_KEY[id]]; const dis = p !== null && p < 0.004;
    if (dis && SET.weather === id) SET.weather = 'auto';
    wr.appendChild(chip(ic + ' ' + label, id === 'auto' ? 'Real odds' : dis ? 'Not in ' + MONTHS[m] : pct(p) + ' chance', SET.weather === id, dis, () => { SET.weather = id; renderSetup(); }, dis ? 'Never recorded in ' + st.city + ' in ' + MONTHS[m] : ''));
  });
  // options
  const tg = (id, on) => $(id).setAttribute('aria-checked', on ? 'true' : 'false');
  tg('opt-dyn', SET.dynamic); tg('opt-water', SET.water); tg('opt-roof', SET.roofAuto); $('opt-roof').parentElement.hidden = !st.roof.includes('Retract');
  const hr = $('su-half'); hr.innerHTML = ''; [3, 5, 10, 45].forEach((h) => hr.appendChild(chip(h + ' min', h === 45 ? 'Real time' : 'per half', SET.half === h, false, () => { SET.half = h; renderSetup(); })));
  renderTactics();
  $('su-sum').textContent = st.name + ' · ' + MONTHS[m] + ' · ' + SET.kickStr + ' · ' + (FAMILY.find((f) => f[0] === SET.weather)[1]) + (SET.dynamic ? ' · live weather' : '');
  previewEnv();
}
// ---- teams and tactics: formation and style per side, with a mini tactics board ----
// 'Auto' formation and style come from the match seed's own stream, so the setup preview is what kick-off plays
function rollAuto() { const R = subStream(SET.seed, 'tactics'); SET.tactics.forEach((tc) => { tc.pf = pickForm(R); tc.ps = pickStyle(R); }); }
const resolvedTac = (ti) => { const t = SET.tactics[ti]; return { form: t.form === 'auto' ? t.pf : t.form, style: t.style === 'auto' ? t.ps : t.style }; };
function boardSVG(ti, form, col) {
  const sl = FORMATIONS[form]; const X = (x) => 8 + x / 60 * 104, Y = (y) => 5 + y / 68 * 70;
  return '<svg viewBox="0 0 120 80" class="board" role="img" aria-label="' + form + ' formation"><rect x="1" y="1" width="118" height="78" rx="4" fill="#1F5E33"/><g fill="none" stroke="rgba(255,255,255,.45)" stroke-width="0.8"><rect x="4" y="4" width="112" height="72"/><line x1="116" y1="4" x2="116" y2="76"/><rect x="4" y="22" width="16" height="36"/><circle cx="116" cy="40" r="9"/></g>'
    + '<circle cx="' + X(3) + '" cy="40" r="3.6" fill="#E9F2EA" stroke="#0A0E13" stroke-width=".8"/>' + sl.map(([r, x, y]) => '<g><circle cx="' + X(x) + '" cy="' + Y(y) + '" r="4.2" fill="' + col + '" stroke="#0A0E13" stroke-width=".8"/><text x="' + X(x) + '" y="' + (Y(y) + 9.5) + '" font-size="5" text-anchor="middle" fill="rgba(255,255,255,.85)" font-family="sans-serif">' + r + '</text></g>').join('') + '</svg>';
}
function renderTactics() {
  const box = $('su-tac'); box.innerHTML = '';
  TEAMS.forEach((T, ti) => {
    const t = SET.tactics[ti]; const r = resolvedTac(ti); const st = STYLES[r.style];
    const card = document.createElement('div'); card.className = 'tcard'; card.style.setProperty('--tc', T.css);
    card.innerHTML = '<div class="th"><span class="tcrest">' + T.key + '</span><b>' + T.club + '</b><em>' + r.form + ' · ' + st.label + (t.form === 'auto' || t.style === 'auto' ? ' (auto)' : '') + '</em></div><div class="tbody">' + boardSVG(ti, r.form, T.css) + '<div class="tpick"><span class="tl">Formation</span><div class="chips sm f"></div><span class="tl">Style</span><div class="chips sm s"></div><p class="tblurb">' + st.blurb + '. Press ' + Math.round(st.press * 100) + ' · Line ' + Math.round(st.line * 100) + ' · Direct ' + Math.round(st.direct * 100) + '</p></div></div>';
    const fr = card.querySelector('.f'), sr = card.querySelector('.s');
    ['auto', ...Object.keys(FORMATIONS)].forEach((f) => fr.appendChild(chip(f === 'auto' ? '🎲 Auto' : f, '', t.form === f, false, () => { t.form = f; if (f === 'auto') t.pf = pickForm(); renderSetup(); }, f === 'auto' ? 'Random, weighted by how often top clubs use each shape' : '')));
    ['auto', ...Object.keys(STYLES)].forEach((k) => sr.appendChild(chip(k === 'auto' ? '🎲 Auto' : STYLES[k].label, '', t.style === k, false, () => { t.style = k; if (k === 'auto') t.ps = pickStyle(); renderSetup(); }, k === 'auto' ? 'Random style' : STYLES[k].blurb)));
    box.appendChild(card);
  });
  if (!S.started && players.length) { setupTactics({ tactics: [resolvedTac(0), resolvedTac(1)] }); lineUp(0); }
}
function buildLineups() {
  TEAMS.forEach((T, ti) => { const el = $(ti ? 'xiB' : 'xiA'); el.innerHTML = ''; const order = (p) => roleCat(p.pos) * 100 + p.slot.y;
    players.filter((p) => p.ti === ti).sort((a, b) => order(a) - order(b)).forEach((p) => { const r = document.createElement('div'); r.className = 'row'; r.style.borderLeft = '3px solid ' + T.css; r.innerHTML = '<b style="color:' + T.css + '">' + p.num + '</b>' + p.name + '<em>' + p.pos + '</em>'; el.appendChild(r); }); });
  $('xiA').dataset.form = TEAMS[0].tac.form + ' · ' + STYLES[TEAMS[0].tac.style].label; $('xiB').dataset.form = TEAMS[1].tac.form + ' · ' + STYLES[TEAMS[1].tac.style].label;
}
function surprise() {
  SET.seed = newSeed(); const R = subStream(SET.seed, 'setup');
  SET.tactics.forEach((t) => { t.form = 'auto'; t.style = 'auto'; t.pf = pickForm(R); t.ps = pickStyle(R); });
  SET.st = STADIUMS[Math.floor(R() * STADIUMS.length)]; SET.month = Math.floor(R() * 12);
  SET.kickStr = SET.st.kickoffs[Math.floor(R() * SET.st.kickoffs.length)]; SET.kick = parseHM(SET.kickStr); SET.weather = 'auto'; SET.dynamic = true; renderSetup();
}
function openSetup() { $('setup').hidden = false; $('intro').hidden = true; $('endp').hidden = true; for (const id of ['bug', 'ctrl', 'third', 'cap', 'wxchip', 'cpbtn', 'copilot']) $(id).hidden = true; renderSetup(); }
$('opt-dyn').onclick = () => { SET.dynamic = !SET.dynamic; renderSetup(); };
$('opt-water').onclick = () => { SET.water = !SET.water; renderSetup(); };
$('opt-roof').onclick = () => { SET.roofAuto = !SET.roofAuto; renderSetup(); };
$('su-rand').onclick = surprise;
$('fc-roll').onclick = () => { SET.seed = newSeed(); renderSetup(); previewEnv(); };
$('su-go').onclick = () => {
  $('setup').hidden = true; $('intro').hidden = false; buildLineups();
  const st = SET.st; $('intro-meta').textContent = 'CUP QUARTER-FINAL · ' + st.name.toUpperCase() + ', ' + st.city.toUpperCase() + ' · ' + MONTHS[SET.month].toUpperCase() + ' · KICK-OFF ' + SET.kickStr + ' · ' + WX[ENV.wx].label.toUpperCase() + ', ' + Math.round(ENV.temp) + '°C · ' + ENV.pitch.toUpperCase();
  $('intro-meta').textContent += ' · ' + TEAMS[0].key + ' ' + TEAMS[0].tac.form + ' ' + STYLES[TEAMS[0].tac.style].label.toUpperCase() + ' v ' + TEAMS[1].key + ' ' + TEAMS[1].tac.form + ' ' + STYLES[TEAMS[1].tac.style].label.toUpperCase();
  const OF = pickOfficials(SET.seed); $('intro-ref').innerHTML = '<b>REFEREE</b> ' + OF.ref + ' (' + OF.nat + ') · <b>ASSISTANTS</b> ' + OF.ar1 + ', ' + OF.ar2 + ' · <b>FOURTH OFFICIAL</b> ' + OF.fourth;
  [...document.querySelectorAll('#intro .row')].forEach((r, j) => { r.classList.remove('in'); setTimeout(() => r.classList.add('in'), 250 + (j % 11) * 140 + (j >= 11 ? 70 : 0)); });
};
$('intro-back').onclick = (e) => { e.preventDefault(); openSetup(); };

// ---- kick-off and match flow ----
function lineUp(team) {
  setRestart('kickoff', team, V2(52.5, 34));
  for (const p of players) { const k = kickoffSpot(p, team); p.pos2.copy(k); p.tgt.copy(k); p.vel.set(0, 0); p.act = null; p.lookAt = V2(52.5, 34); }
  S.restart.taker = teamOf(team).find((p) => p.pos === 'ST') || S.restart.taker; if (S.restart.taker) S.restart.taker.pos2.copy(V2(52.5 + (team ? 0.6 : -0.6), 34));
  ball.p.set(52.5, BR, 34); ball.v.set(0, 0, 0); ball.w.set(0, 0, 0); S.owner = null; S.intended = null; S.traj = null;
}
function kickOff() {
  seed = hash32(SET.seed + ':play'); wordsRnd = subStream(SET.seed, 'words'); initEnv(Object.assign({}, SET)); paintStadium(SET.st, SET.month); S.flip = 0;
  for (const p of players) { p.off = false; p.model.visible = true; p.yellows = 0; p.act = null; p.oneTwo = null; p.pv = null; }
  rollAuto(); // 'Auto' picks follow the match seed
  simAcc = 0; // the fixed-step remainder starts from zero too
  setupTactics({ tactics: [resolvedTac(0), resolvedTac(1)] });
  Object.assign(S, { t: 0, trajT: 0, passInfo: null, shotInfo: null, lastTouch: null, clock: 0, mclock: 0, half: 1, mscale: 45 / SET.half, stop: [0, 0], hold: null, over: false, ht: false, envAcc: 0, lastLogMin: 0, score: [0, 0], celebrate: 0, inspT: -99, cool: 0, insp: 0, goalsHalf: [0, 0] });
  Object.assign(STATS, { kinds: {}, xg: [0, 0], shots: [0, 0], poss: [0, 0], passes: [0, 0], done: [0, 0], goals: [], fouls: [0, 0], yellows: [0, 0], reds: [0, 0], offsides: [0, 0], onTarget: [0, 0] });
  for (const p of players) { p.stamina = 1; p.cap = 1; }
  lineUp(0); $('intro').hidden = true; $('setup').hidden = true; for (const id of ['bug', 'ctrl', 'third', 'cap', 'wxchip', 'cpbtn']) $(id).hidden = false;
  pickOfficials(SET.seed); for (const o of officials) { o.pos2.copy(o.role === 'ref' ? V2(57, 38) : V2(o.role === 'ar1' ? 75 : 30, o.role === 'ar1' ? -0.8 : 68.8)); o.act = null; o.faceYaw = undefined; }
  S.dead = null; if (window.verifierReset) verifierReset(); dirStart();
  S.started = true; dataEvent('kickoff', { team: TEAMS[0].key, half: 1, referee: OFFICIALS.ref + ' (' + OFFICIALS.nat + ')', formations: TEAMS.map((T) => T.key + ' ' + T.tac.form + ' ' + T.tac.style).join(' v ') }); if (window.copilotReset) copilotReset(); talkReset();
  say('Kick-off at ' + SET.st.name + ' in ' + SET.st.city + ', with ' + OFFICIALS.ref + ' of ' + OFFICIALS.nat + ' the referee. ' + Math.round(ENV.temp) + '°C, ' + WX[ENV.wx].label.toLowerCase() + ', the pitch ' + ENV.pitch.toLowerCase() + '. ' + TEAMS[0].club + ' get us under way.');
}
function matchClock(dt) {
  S.envAcc += dt * S.mscale / 60;
  if (S.envAcc >= 0.2) { const d = S.envAcc; S.envAcc = 0; updateEnv(d); stormTick(d); }
  const min = Math.floor(S.mclock / 60); if (min !== S.lastLogMin) { S.lastLogMin = min; logEnv(); adaptTactics(min); if (window.copilotTick) copilotTick(min); }
  if (ENV.susp) { startHold('lightning'); return; }
  const mn = S.mclock / 60;
  if (ENV.coolingDue.length && mn >= ENV.coolingDue[0] && !(S.celebrate > 0) && (S.restart || mn >= ENV.coolingDue[0] + 3)) { ENV.coolingDue.shift(); startHold('cooling'); return; }
  if (ENV.water > 3.2 && S.restart && !(S.celebrate > 0) && mn - S.inspT > 15) { S.inspT = mn; startHold('inspection'); return; }
  const end = S.half * 45;
  // added time is announced on the 45th minute: goals, breaks, inspections and a little random time-wasting
  if (mn >= end && !S.stop[S.half - 1]) { const g = S.goalsHalf[S.half - 1]; S.stop[S.half - 1] = Math.max(1, Math.round(1 + wrnd() * 2 + g * 0.7 + S.cool * 1.5 + S.insp)); S.cool = 0; S.insp = 0; toast('+' + S.stop[S.half - 1] + '<small>MINUTES ADDED</small>', 1.8); dataEvent('added_time', { minutes: S.stop[S.half - 1], half: S.half }); }
  const bx = ball.p.x;
  if (S.stop[S.half - 1] && mn >= end + S.stop[S.half - 1] && !(S.celebrate > 0) && (S.restart || (bx > 30 && bx < 75) || mn >= end + S.stop[S.half - 1] + 1.5)) { if (S.half === 1) startHold('ht'); else fullTime(); }
}
// a hold freezes play while the world keeps turning: breaks, inspections, lightning delays, half-time
function startHold(type) {
  for (const p of players) { p.vel.set(0, 0); if (p.act && p.act.type !== 'celebrate') p.act = null; }
  ball.v.set(0, 0, 0); S.owner = null; S.intended = null; S.traj = null;
  const H = { type, left: 5, rate: 0, delay: 0 };
  if (type === 'lightning') { H.left = 999; H.rate = 8; H.clear = 30; H.km = ENV.flashKm; dataEvent('suspended', { reason: 'lightning', km: +(ENV.flashKm || 0).toFixed(1) }); }
  if (type === 'cooling') { H.left = 4; S.cool++; dataEvent('cooling_break', { wbgtC: +ENV.wbgt.toFixed(1) }); say('Cooling break. Players take on water and ice towels with the WBGT at ' + ENV.wbgt.toFixed(1) + '°C.'); for (const p of players) p.stamina = Math.min(p.cap, p.stamina + 0.08); }
  if (type === 'inspection') { H.left = 4.5; S.insp++; dataEvent('pitch_inspection', { waterMm: +ENV.water.toFixed(2) }); say('The referee is testing the surface, rolling the ball through the standing water.'); }
  if (type === 'ht' || type === 'ft') whistle('end');
  if (type === 'ht') { H.left = 6; H.rate = 3; S.ht = true; dataEvent('half_time', { score: S.score.join('-') }); say('Half-time. ' + TEAMS[0].club + ' ' + S.score[0] + ', ' + TEAMS[1].club + ' ' + S.score[1] + '.'); }
  S.hold = H; showHold();
}
function holdTick(dt) {
  const H = S.hold; S.t += dt; H.left -= dt;
  if (H.rate) { const d = H.rate * dt; const k0 = ENV.strikes; updateEnv(d); ENV.minute -= d; H.delay += d;
    if (H.type === 'lightning') { stormTick(d); if (ENV.strikes > k0 && ENV.flashKm < 13) { H.clear = 30; H.km = ENV.flashKm; } else H.clear -= d;
      if (H.clear <= 0) H.left = 0; if (H.delay > 120) { H.abandon = 'lightning'; H.left = 0; } } }
  showHold();
  if (H.left > 0) return;
  S.hold = null; $('hold').hidden = true;
  if (H.type === 'lightning') { ENV.susp = null; if (H.abandon) return fullTime('Abandoned after ' + Math.round(H.delay) + ' minutes of lightning'); dataEvent('resumed', { delayMin: Math.round(H.delay) }); say('Play resumes after a ' + Math.round(H.delay) + '-minute lightning delay.'); S.check && S.check.resumed(); toast('PLAY RESUMES<small>' + Math.round(H.delay) + ' MIN DELAY</small>', 2); setRestart('kickoff', S.poss, V2(52.5, 34)); }
  if (H.type === 'inspection') { if (ENV.water > 4.6) return fullTime('Abandoned: waterlogged pitch'); dataEvent('pitch_playable', { waterMm: +ENV.water.toFixed(2) }); say('The referee rules the pitch playable. We go on.'); }
  if (H.type === 'ht') {
    S.ht = false; S.half = 2; S.mclock = 45 * 60; ENV.coolingDue = ENV.coolingDue.filter((m) => m > 45);
    if (SET.water && WX[ENV.wx].rain === 0) { ENV.leaf = Math.max(ENV.leaf, 0.5); dataEvent('watering', { when: 'half-time' }); }
    for (const p of players) p.stamina = Math.min(p.cap, p.stamina + 0.3);
    S.flip = 1; lineUp(1); S.dead = null; for (const o of officials) { o.act = null; o.faceYaw = undefined; if (o.role === 'ref') o.pos2.set(48, 30); else o.pos2.x = 105 - o.pos2.x; }
    toast('SECOND HALF<small>' + TEAMS[1].club + ' kick off · ends changed</small>', 2.6); S.check && S.check.secondHalf();
    dataEvent('kickoff', { team: TEAMS[1].key, half: 2, note: 'teams change ends' }); say('The second half is under way. ' + WX[ENV.wx].label + ', ' + Math.round(ENV.temp) + '°C.');
  }
}
function showHold() {
  const H = S.hold; const el = $('hold'); el.hidden = false;
  const T = { lightning: ['⚡ PLAY SUSPENDED', 'Lightning ' + (H.km || 0).toFixed(0) + ' km away. FIFA protocol: play restarts after 30 minutes with no strike within 13 km.', 'Delay ' + Math.floor(H.delay) + ' min · all clear in ' + Math.max(0, Math.ceil(H.clear)) + ' min'],
    cooling: ['🧊 COOLING BREAK', 'WBGT ' + ENV.wbgt.toFixed(1) + '°C is above FIFA\'s 32°C limit. Three minutes for water and ice towels.', 'Players recover a little stamina'],
    inspection: ['🧑‍⚖️ PITCH INSPECTION', 'The referee rolls and bounces the ball through ' + ENV.water.toFixed(1) + ' mm of surface water.', ENV.water > 4.6 ? 'Ball is holding up in puddles…' : 'Ball still rolls true…'],
    ht: ['HALF-TIME', TEAMS[0].club + ' ' + S.score[0] + ' – ' + S.score[1] + ' ' + TEAMS[1].club, 'Possession ' + possPct(0) + '% – ' + possPct(1) + '% · Shots ' + STATS.shots.join(' – ') + ' · Now ' + WX[ENV.wx].label.toLowerCase() + ', ' + Math.round(ENV.temp) + '°C, ' + ENV.pitch.toLowerCase()] }[H.type];
  $('hold-t').textContent = T[0]; $('hold-s').textContent = T[1]; $('hold-m').textContent = T[2];
}
const possPct = (ti) => { const a = STATS.poss[0] + STATS.poss[1]; return a ? Math.round(STATS.poss[ti] / a * 100) : 50; };
function summary(why) {
  const L = ENV.log; const temps = L.map((r) => r.tempC); const wxSeen = [...new Set(L.map((r) => r.weather))];
  return { result: TEAMS[0].club + ' ' + S.score[0] + '-' + S.score[1] + ' ' + TEAMS[1].club, ended: why || 'Full-time', goals: STATS.goals.map((g) => ({ minute: g.min, team: TEAMS[g.team].key })),
    formations: TEAMS.map((T) => T.tac.form), styles: TEAMS.map((T) => T.tac.style), fouls: STATS.fouls, yellowCards: STATS.yellows, redCards: STATS.reds, offsides: STATS.offsides,
    possessionPct: [possPct(0), possPct(1)], shots: STATS.shots, xg: STATS.xg.map((x) => +x.toFixed(2)), passes: STATS.passes, passesCompleted: STATS.done,
    weatherStart: ENV.startWx, weatherEnd: ENV.wx, weatherSeen: wxSeen, tempMinC: Math.min(...temps), tempMaxC: Math.max(...temps), wbgtMaxC: Math.max(...L.map((r) => r.wbgtC)), pitchWaterMaxMm: Math.max(...L.map((r) => r.pitchWaterMm)),
    lightningStrikes: ENV.strikes, suspensions: ENV.events.filter((e) => e.type === 'suspended').length, coolingBreaks: ENV.events.filter((e) => e.type === 'cooling_break').length, slips: ENV.events.filter((e) => e.type === 'slip').length };
}
function fullTime(why) {
  whistle('end'); S.over = true; S.hold = null; $('hold').hidden = true; logEnv(); dataEvent('full_time', { score: S.score.join('-'), reason: why || 'full-time' });
  for (const p of players) { p.vel.set(0, 0); p.act = null; } ball.v.set(0, 0, 0); S.owner = null;
  say((why ? why + '. ' : 'Full-time. ') + TEAMS[0].club + ' ' + S.score[0] + ', ' + TEAMS[1].club + ' ' + S.score[1] + '.');
  const sm = summary(why); $('end-t').textContent = why ? 'MATCH ABANDONED' : 'FULL-TIME';
  $('end-sc').innerHTML = '<span style="color:var(--home)">' + TEAMS[0].club + '</span> <b>' + S.score[0] + ' – ' + S.score[1] + '</b> <span style="color:var(--away)">' + TEAMS[1].club + '</span>';
  $('end-why').textContent = why || (STATS.goals.length ? 'Goals: ' + STATS.goals.map((g) => TEAMS[g.team].key + ' ' + g.min).join(', ') : 'No goals');
  const rows = [['Possession', sm.possessionPct.join('% – ') + '%'], ['Shots', sm.shots.join(' – ')], ['xG', sm.xg.join(' – ')], ['Passes completed', sm.passesCompleted.join(' – ')], ['Fouls / cards', sm.fouls.join(' – ') + ' / ' + sm.yellowCards.map((y, i) => y + (sm.redCards[i] ? '+' + sm.redCards[i] + 'R' : '')).join(' – ')], ['Offsides', sm.offsides.join(' – ')], ['Shape (final)', TEAMS.map((T) => T.tac.form).join(' – ')], ['Weather', sm.weatherSeen.map((w) => WX[w].icon + ' ' + WX[w].label).join(' → ')], ['Temperature', sm.tempMinC + '–' + sm.tempMaxC + '°C, WBGT peak ' + sm.wbgtMaxC + '°C'], ['Pitch water peak', sm.pitchWaterMaxMm + ' mm'], ['Lightning / delays', sm.lightningStrikes + ' strikes / ' + sm.suspensions + ' suspensions'], ['Cooling breaks / slips', sm.coolingBreaks + ' / ' + sm.slips]];
  $('end-grid').innerHTML = rows.map(([k, v]) => '<div><span>' + k + '</span><b>' + v + '</b></div>').join('');
  $('end-data').textContent = ENV.log.length + ' minute-by-minute condition rows and ' + ENV.events.length + ' match events recorded.';
  $('endp').hidden = false;
}

// ---- in-match conditions chip ----
let wxKey = '';
function wxChip() {
  if (!ENV.set) return; const w = WX[ENV.wx];
  const k = w.icon + ' ' + Math.round(ENV.temp) + '°C|💧 ' + Math.round(ENV.rh) + '%|💨 ' + fmtKm(ENV.wind) + '|' + ENV.pitch + '|' + hhmm(ENV.local);
  if (k !== wxKey) { wxKey = k; $('wxchip').innerHTML = k.split('|').map((t, i) => i === 3 ? '<span class="pitch">' + t + '</span>' : '<span>' + t + '</span>').join(''); }
}

// ---- dataset export: setup, climate normals, per-minute conditions, every event ----
function dataset() {
  const st = SET.st; return { generator: 'MatchCast synthetic match simulator', version: 3, setup: { referee: OFFICIALS.ref + ' (' + OFFICIALS.nat + ')', assistants: [OFFICIALS.ar1, OFFICIALS.ar2], fourthOfficial: OFFICIALS.fourth, stadium: st.name, city: st.city, country: st.country, altitudeM: st.alt, month: MONTHS[SET.month], kickoffLocal: SET.kickStr, weatherMode: SET.weather, weatherCanChange: SET.dynamic, pitchWatered: SET.water, halfLengthRealMin: SET.half, seed: SET.seed },
    climateNormals: climateOf(st, SET.month), teams: TEAMS.map((T, ti) => ({ key: T.key, club: T.club, formationStart: resolvedTac(ti).form, formationEnd: T.tac.form, style: T.tac.style, tacticalChanges: ENV.events.filter((e) => e.type === 'tactical_change' && e.team === T.key).length })), summary: summary(S.over && $('end-t').textContent.includes('ABANDON') ? 'abandoned' : null), timeline: ENV.log, events: ENV.events };
}
function toCSV(rows) { if (!rows.length) return ''; const keys = Object.keys(rows[0]); const esc = (v) => { v = Array.isArray(v) ? v.join('-') : v; v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }; return keys.join(',') + '\n' + rows.map((r) => keys.map((k) => esc(r[k])).join(',')).join('\n'); }
let DL = null; const dlReady = (window.claude && window.claude.use) ? window.claude.use('downloads').then((d) => { DL = d; if (!d) for (const b of document.querySelectorAll('.dl')) b.hidden = true; }).catch(() => {}) : Promise.resolve();
async function saveFile(name, text, mime) {
  await dlReady; const note = $('dl-note');
  if (DL) { try { await DL.save({ filename: name, data: new Blob([text], { type: mime }) }); note.textContent = 'Saved ' + name + '.'; } catch (e) { note.textContent = e && e.code === 'declined' ? 'Download cancelled.' : 'Download is not available here.'; } return; }
  if (!window.claude) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; a.click(); }
}
const fileBase = () => 'matchcast_' + SET.st.id + '_' + MONTHS[SET.month].toLowerCase() + '_' + SET.kickStr.replace(':', '') + '_' + SET.seed;
for (const b of document.querySelectorAll('.dl-json')) b.onclick = () => saveFile(fileBase() + '.json', JSON.stringify(dataset(), null, 1), 'application/json');
for (const b of document.querySelectorAll('.dl-csv')) b.onclick = () => saveFile(fileBase() + '_events.csv', toCSV(ENV.events.map((e) => { const o = { minute: e.minute, local: e.local, type: e.type, weather: e.weather, tempC: e.tempC, pitch: e.pitch, pitchWaterMm: e.pitchWaterMm }; const extra = Object.assign({}, e); for (const k in o) delete extra[k]; o.details = JSON.stringify(extra); return o; })), 'text/csv');
for (const b of document.querySelectorAll('.dl-tl')) b.onclick = () => saveFile(fileBase() + '_conditions.csv', toCSV(ENV.log), 'text/csv');
$('end-new').onclick = () => { S.started = false; S.over = false; $('endp').hidden = true; SET.seed = newSeed(); openSetup(); };
$('end-close').onclick = () => { $('endp').hidden = true; };
$('datab').onclick = () => { const p = $('datap'); p.hidden = !p.hidden; if (!p.hidden) renderData(); };
function renderData() {
  $('dp-count').textContent = ENV.log.length + ' minutes of conditions · ' + ENV.events.length + ' events';
  $('dp-list').innerHTML = ENV.events.slice(-7).reverse().map((e) => '<li><b>' + Math.floor(e.minute) + '\'</b> ' + e.type.replace(/_/g, ' ') + (e.player ? ' · ' + e.player : '') + (e.xg != null ? ' · xG ' + e.xg : '') + (e.km != null ? ' · ' + e.km + ' km' : '') + '<em>' + WX[e.weather].icon + ' ' + e.tempC + '°</em></li>').join('');
}
setInterval(() => { if (!$('datap').hidden) renderData(); }, 1000);
