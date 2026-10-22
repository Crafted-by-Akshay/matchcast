// ============ HISTORY: 150 years of real international results as calibration and narrative ============
// Source: "International football results from 1872 to present" by martj42 (GitHub martj42/international_results,
// mirrored on Kaggle), CC0 1.0. build_intl.py turns ~50,000 results into intl.json: World Football Elo for every
// nation, the win/draw/loss curve by Elo gap, goal rates, home edge, shoot-outs, goal timing and head-to-heads.
// The squads stay our fictional players; "International" mode only relabels them and sets their strength from Elo.
const HX = { data: null, mode: 'club', a: 0, b: 1, comp: 'friendly', force: null, k: 5.0, p: 1.12, cap: 30, q: [], next: 0, said: new Set(), wp: null, wpKey: '', prior: null, kappa: [1, 1, 1], clubs: TEAMS.map((T) => ({ key: T.key, club: T.club })) };
new THREE.FileLoader().setResponseType('json').load('./intl.json', (d) => { HX.data = d; const ix = (n) => d.nations.findIndex((x) => x.n === n); if (ix('England') >= 0 && ix('Brazil') >= 0) { HX.a = ix('England'); HX.b = ix('Brazil'); } if (!$('setup').hidden) renderSetup(); }, undefined, () => { HX.data = null; });
const hxOn = () => HX.mode === 'intl' && HX.data;
const hxN = (i) => HX.data.nations[i];
const hxPct = (x) => Math.round(x * 100) + '%';
// venue: a nation playing in its own country gets the Elo home edge (+100); anywhere else is neutral
const hxHome = () => { const c = SET.st.country; return hxN(HX.a).n === c ? 0 : hxN(HX.b).n === c ? 1 : -1; };
const hxGap = () => hxN(HX.a).elo - hxN(HX.b).elo + [HX.data.elo.home, -HX.data.elo.home, 0][hxHome() < 0 ? 2 : hxHome()];
// ---- history: P(win/draw/loss) for an Elo gap, from the ordered-logit fit to 30,000+ internationals since 1990 ----
function hxWDL(gap) { const F = HX.data.wdlFit, s = (x) => 1 / (1 + Math.exp(-x)); const w = s(F.a * gap / 100 - F.c), l = s(-F.a * gap / 100 - F.c); return [w, 1 - w - l, l]; }
// ---- head-to-head from a's point of view, any order; null when they never met ----
function hxH2H(a, b) {
  const D = HX.data; const ia = typeof a === 'number' ? a : D.nations.findIndex((x) => x.n === a), ib = typeof b === 'number' ? b : D.nations.findIndex((x) => x.n === b);
  const r = D.h2h.find((h) => (h[0] === ia && h[1] === ib) || (h[0] === ib && h[1] === ia)); if (!r) return null; const f = r[0] === ia;
  const L = r[8]; return { a: D.nations[ia].n, b: D.nations[ib].n, played: r[2], w: f ? r[3] : r[5], d: r[4], l: f ? r[5] : r[3], gf: f ? r[6] : r[7], ga: f ? r[7] : r[6],
    last: { date: L[0], gf: f ? L[1] : L[2], ga: f ? L[2] : L[1], at: L[3] === 0 ? 'neutral' : (L[3] === 1) === f ? 'home' : 'away', kind: D.cats[L[4]] },
    big: f ? r[9] : r[10], bigOpp: f ? r[10] : r[9], mar: f ? r[11] : r[12], marOpp: f ? r[12] : r[11] };
}
// ---- live win probability: Elo prior, then Poisson goals over the time left, shaped by when goals really come ----
// Goal rates per team: exp(g0 + g1*gap/100), fitted on the dataset. Time left uses the empirical share of goals
// still to come after each minute (goal file). Red cards: each costs the side ~30% of its rate and lifts the
// opponent ~30% (an assumption from published studies; the dataset has no card data). Draw/win/loss weights are
// rescaled so minute 0 reproduces the historical prior exactly.
const hxPois = (l, n) => { let p = Math.exp(-l); const o = [p]; for (let k = 1; k <= n; k++) { p *= l / k; o.push(p); } return o; };
function hxOutcome(la, lb, s0, s1) { const A = hxPois(la, 12), B = hxPois(lb, 12); let w = 0, d = 0, l = 0; for (let x = 0; x <= 12; x++) for (let y = 0; y <= 12; y++) { const p = A[x] * B[y], g = s0 + x - (s1 + y); if (g > 0) w += p; else if (g < 0) l += p; else d += p; } return [w, d, l]; }
function hxLive() {
  const D = HX.data, G = D.goals, gap = hxGap(); let la = Math.exp(G.g0 + G.g1 * gap / 100), lb = Math.exp(G.g0 - G.g1 * gap / 100);
  if (!HX.prior) { HX.prior = hxWDL(gap); const p0 = hxOutcome(la, lb, 0, 0); HX.kappa = HX.prior.map((x, i) => x / p0[i]); }
  if (!S.started) return HX.prior.slice();
  const mn = clamp(ENV.minute, 0, 90), c = D.goalCdf, i = Math.floor(mn); const done = c[i] + (c[Math.min(90, i + 1)] - c[i]) * (mn - i);
  const left = S.over ? 0 : Math.max(ENV.minute >= 90 ? 0.004 : 0.01, 1 - done); const ra = STATS.reds[0], rb = STATS.reds[1];
  la *= left * Math.pow(0.7, ra) * Math.pow(1.3, rb); lb *= left * Math.pow(0.7, rb) * Math.pow(1.3, ra);
  const o = hxOutcome(la, lb, S.score[0], S.score[1]).map((x, j) => x * HX.kappa[j]); const t = o[0] + o[1] + o[2]; return o.map((x) => x / t);
}
// ---- team strength from Elo: the favourite keeps the elite baseline, the underdog loses 5*(gap/100)^1.12 rating points (max 30) ----
// (rating feeds speed, passing, shooting, control, tackling and dribbling exactly as in buildPeople). k was tuned by
// simulating headless matches until the engine's win/draw/loss rates matched the historical curve (see REPORT.md).
const HX_ATTR = [['vmax', 0.17, 6.2, 9.4], ['acc', 0.08, 3.2, 5.6], ['agil', 0.02, 0.7, 1.2], ['passS', 1 / 30, 0.4, 1], ['shotS', 1 / 28, 0.25, 1], ['ctrl', 1 / 32, 0.4, 1], ['tackle', 1 / 30, 0.3, 1], ['drib', 1 / 26, 0.15, 1]];
function hxStrength() {
  const gap = hxOn() ? (HX.force ?? hxGap()) : 0; const pen = Math.min(HX.cap, HX.k * Math.pow(Math.abs(gap) / 100, HX.p)); const d = hxOn() ? (gap >= 0 ? [0, -pen] : [-pen, 0]) : [0, 0];
  for (const p of players) {
    if (!p.hxBase) p.hxBase = Object.fromEntries(HX_ATTR.map(([k]) => [k, p[k]]).concat([['rating', p.rating]]));
    const dr = d[p.ti]; for (const [k, c, lo, hi] of HX_ATTR) p[k] = dr ? clamp(p.hxBase[k] + dr * c, lo, hi) : p.hxBase[k]; p.rating = Math.round(p.hxBase.rating + dr);
  }
  return d;
}
// ---- labels: in International mode the two squads wear the nations' names (no crests, logos or competition marks) ----
function hxLabels() {
  TEAMS.forEach((T, ti) => { if (hxOn()) { const n = hxN(ti ? HX.b : HX.a); T.key = n.c; T.club = n.n; } else Object.assign(T, HX.clubs[ti]); });
  const tm = document.querySelectorAll('#bug .tm'); if (tm.length === 2) { tm[0].textContent = TEAMS[0].key; tm[1].textContent = TEAMS[1].key; }
}
// ---- the pre-match card: Elo, historical odds, head-to-head and the last meeting ----
function hxCard() {
  const A = hxN(HX.a), B = hxN(HX.b), gap = hxGap(), p = hxWDL(gap), h = hxH2H(HX.a, HX.b), hm = hxHome(), D = HX.data;
  const ven = hm < 0 ? 'Neutral venue' : (hm ? B.n : A.n) + ' at home (+' + D.elo.home + ' Elo)';
  const bar = '<div class="hx-bar" role="img" aria-label="' + A.n + ' win ' + hxPct(p[0]) + ', draw ' + hxPct(p[1]) + ', ' + B.n + ' win ' + hxPct(p[2]) + '"><i style="flex:' + p[0] + ';background:var(--home)"></i><i style="flex:' + p[1] + ';background:#5B6B7D"></i><i style="flex:' + p[2] + ';background:var(--away)"></i></div>';
  const hh = h ? '<b>' + h.played + '</b> meeting' + (h.played === 1 ? '' : 's') + ': ' + A.n + ' ' + h.w + ' wins, ' + h.d + ' draws, ' + B.n + ' ' + h.l + ' wins (goals ' + h.gf + '–' + h.ga + ').' + ' Last met ' + h.last.date.slice(0, 4) + ', ' + A.n + ' ' + h.last.gf + '–' + h.last.ga + ' ' + B.n + ' (' + h.last.kind + ').' : 'These two have never met in a full international.';
  return '<div class="hx-sides"><div><b>' + A.n + '</b><span>Elo ' + A.elo + ' · #' + A.rank + '</span></div><div class="hx-mid">' + ven + '</div><div class="r"><b>' + B.n + '</b><span>Elo ' + B.elo + ' · #' + B.rank + '</span></div></div>'
    + bar + '<div class="hx-lab"><span>' + A.c + ' win ' + hxPct(p[0]) + '</span><span>Draw ' + hxPct(p[1]) + '</span><span>' + B.c + ' win ' + hxPct(p[2]) + '</span></div>'
    + '<p class="hx-h2h">' + hh + '</p><p class="hx-note">Odds from ' + D.wdlFit.n.toLocaleString('en') + ' internationals since ' + D.wdlFit.since + ' with the same Elo gap (' + (gap > 0 ? '+' : '') + Math.round(gap) + ').</p>';
}
// ---- setup screen: match type, the two nations, competition wording, and the data credit ----
function hxSetup() {
  const row = $('hx-mode'); if (!row) return; row.innerHTML = '';
  row.appendChild(chip('Fictional clubs', 'Harbor City v Ridgeview', HX.mode === 'club', false, () => { HX.mode = 'club'; renderSetup(); }));
  row.appendChild(chip('🌍 International', HX.data ? 'Two real nations, Elo-calibrated' : 'Loading results…', HX.mode === 'intl', !HX.data, () => { HX.mode = 'intl'; renderSetup(); }));
  const pk = $('hx-pick'); pk.hidden = !hxOn(); if (!hxOn()) return;
  const opts = (sel) => HX.data.nations.map((n, i) => '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + n.rank + '. ' + n.n + ' (' + n.elo + ')</option>').join('');
  pk.innerHTML = '<div class="hx-sel"><label><span><i style="background:var(--home)"></i>Blue shirts</span><select id="hx-a">' + opts(HX.a) + '</select></label><button class="btn" id="hx-swap" aria-label="Swap the two nations" title="Swap">⇄</button><label><span><i style="background:var(--away)"></i>Orange shirts</span><select id="hx-b">' + opts(HX.b) + '</select></label></div><div class="chips" id="hx-comp" role="group" aria-label="Competition"></div><div class="hx-pre">' + hxCard() + '</div>';
  const set = (k, v) => { v = +v; if (v === HX[k === 'a' ? 'b' : 'a']) HX[k === 'a' ? 'b' : 'a'] = HX[k]; HX[k] = v; HX.prior = null; renderSetup(); };
  $('hx-a').onchange = (e) => set('a', e.target.value); $('hx-b').onchange = (e) => set('b', e.target.value);
  $('hx-swap').onclick = () => { [HX.a, HX.b] = [HX.b, HX.a]; HX.prior = null; renderSetup(); };
  const cr = $('hx-comp'); [['friendly', 'International friendly'], ['cup', 'International cup']].forEach(([k, l]) => cr.appendChild(chip(l, k === 'cup' ? 'Knockout tie' : 'No trophy at stake', HX.comp === k, false, () => { HX.comp = k; renderSetup(); })));
}
const _hxRender = renderSetup; renderSetup = function () { HX.prior = null; hxLabels(); _hxRender(); hxSetup(); if (hxOn()) $('su-sum').textContent = TEAMS[0].club + ' v ' + TEAMS[1].club + ' · ' + $('su-sum').textContent; };
const _hxSurprise = surprise; surprise = function () { if (hxOn()) { const n = HX.data.nations.length; HX.a = Math.floor(Math.random() * n); do HX.b = Math.floor(Math.random() * n); while (HX.b === HX.a); } _hxSurprise(); };
$('su-rand').onclick = surprise;
// ---- intro screen: names, the competition wording and the pre-match card ----
const _hxGo = $('su-go').onclick;
$('su-go').onclick = () => {
  hxLabels(); _hxGo(); const card = $('hx-card'); const vs = document.querySelectorAll('#intro .vs .crest'), cl = document.querySelectorAll('#intro .vs .club');
  const nm = hxOn() ? [hxN(HX.a), hxN(HX.b)].map((n) => [n.c, n.n.toUpperCase()]) : [['HC', 'HARBOR CITY'], ['RV', 'RIDGEVIEW']];
  if (vs.length === 2) { vs[0].textContent = nm[0][0]; vs[1].textContent = nm[1][0]; } if (cl.length === 3) { cl[0].textContent = nm[0][1]; cl[2].textContent = nm[1][1]; }
  card.hidden = !hxOn(); if (!hxOn()) return;
  $('intro-meta').textContent = $('intro-meta').textContent.replace('CUP QUARTER-FINAL', HX.comp === 'cup' ? 'INTERNATIONAL CUP' : 'INTERNATIONAL FRIENDLY'); card.innerHTML = hxCard();
};
// ---- narrative: queued lines go out through the commentary caption, spaced so each can be read ----
const hxSay = (line, now) => { if (now) HX.q.unshift(line); else HX.q.push(line); };
function hxInsight(icon, title, text, n) {
  const el = document.createElement('div'); el.className = 'ins hx-ins';
  el.innerHTML = '<div class="ih"><i>' + icon + '</i><b>' + title + '</b><span>' + Math.max(1, Math.ceil(ENV.minute)) + '\'</span></div><p>' + text + '</p><div class="iv">📚 History: ' + n.toLocaleString('en') + ' real internationals · martj42 dataset (CC0)</div>';
  const feed = $('cp-feed'); if (!feed) return el; feed.prepend(el); while (feed.children.length > 30) feed.lastChild.remove(); if (typeof CP !== 'undefined' && !CP.open) $('cpbtn').classList.add('ping'); return el;
}
const hxOnce = (id) => (HX.said.has(id) ? false : (HX.said.add(id), true));
function hxSince(ti, margin) { const h = hxH2H(ti ? HX.b : HX.a, ti ? HX.a : HX.b); if (!h) return { never: true }; const y = h.mar[margin - 1]; return y ? { year: y, h } : { never: true, h }; }
onMatchEvent((ev) => {
  if (!hxOn() || !S.started) return; const D = HX.data, gs = D.gameState; const nm = (ti) => TEAMS[ti].club;
  if (ev.type === 'goal') {
    const ti = keyIdx(ev.team), mar = S.score[ti] - S.score[1 - ti]; const wp = hxLive(); const was = HX.wpGoal || HX.wp0 || wp; HX.wpGoal = wp;
    const sw = (j) => (j === 0 ? 0 : 2); const lead = mar > 0 ? ti : mar < 0 ? 1 - ti : -1;
    hxSay(nm(ti) + '\'s chance of winning moves from ' + hxPct(was[sw(ti)]) + ' to ' + hxPct(wp[sw(ti)]) + '.', true);
    if (mar >= 1) { const s = hxSince(ti, mar); const h = s.h;
      if (s.never && h && hxOnce('big' + ti + mar)) hxSay('If it stays this way, it would be ' + nm(ti) + '\'s biggest ever win over ' + nm(1 - ti) + (h.big ? ', beating ' + h.big[0] + '-' + h.big[1] + ' in ' + h.big[2] : '') + '.');
      else if (s.year && s.year < new Date().getFullYear() - 3 && hxOnce('since' + ti + mar)) hxSay('A ' + mar + '-goal win would be ' + nm(ti) + '\'s biggest over ' + nm(1 - ti) + ' since ' + s.year + '.'); }
    if (lead >= 0 && Math.abs(mar) === 2 && hxOnce('down2' + (1 - lead))) { const t = nm(1 - lead) + ' are two down. Since 1990 only ' + (gs.comebackFrom2Down * 100).toFixed(1) + '% of internationals were won from two goals behind (' + (gs.comebackFrom2DownClose * 100).toFixed(1) + '% between evenly matched sides).'; hxSay(t); hxInsight('📉', 'Two-goal deficits rarely turn', t, gs.down2N); }
  }
  if (ev.type === 'half_time') { const m = S.score[0] - S.score[1];
    if (Math.abs(m) === 1) { const t = 'Teams leading by one at the break go on to win ' + hxPct(gs.htLead1Win) + ' of internationals.'; hxSay(t); hxInsight('⏸️', nm(m > 0 ? 0 : 1) + ' lead at the break', t, gs.htLead1N); }
    else if (Math.abs(m) >= 2) hxSay('A two-goal half-time lead has been converted ' + hxPct(gs.htLead2Win) + ' of the time since 1990.');
    else { const wp = hxLive(); hxSay('Level at half-time. The live model now gives ' + nm(0) + ' ' + hxPct(wp[0]) + ', the draw ' + hxPct(wp[1]) + ', ' + nm(1) + ' ' + hxPct(wp[2]) + '.'); } }
  if (ev.type === 'red_card') { const wp = hxLive(); hxSay('Down to ten. The live win model now gives ' + TEAMS[0].key + ' ' + hxPct(wp[0]) + ', draw ' + hxPct(wp[1]) + ', ' + TEAMS[1].key + ' ' + hxPct(wp[2]) + '.', true); }
  if (ev.type === 'full_time') hxFull();
});
// kick-off lines: run after kickOff() so the Copilot feed reset does not wipe them
function hxKickLines() {
  const D = HX.data, nm = (ti) => TEAMS[ti].club; HX.said = new Set(); HX.q = []; HX.next = S.t + 6; HX.wp0 = hxLive(); const h = hxH2H(HX.a, HX.b), p = HX.prior;
  hxSay(h ? 'The last time these two met, in ' + h.last.date.slice(0, 4) + ', it finished ' + nm(0) + ' ' + h.last.gf + ', ' + nm(1) + ' ' + h.last.ga + '. ' + h.played + ' meetings in all.' : 'A first ever full international between ' + nm(0) + ' and ' + nm(1) + '.');
  hxSay(Math.abs(p[0] - p[2]) < 0.04 ? 'History calls this one even: ' + hxPct(p[0]) + ' each way and ' + hxPct(p[1]) + ' for a draw.' : 'History makes ' + (p[0] > p[2] ? nm(0) : nm(1)) + ' favourites: ' + hxPct(Math.max(p[0], p[2])) + ' to win, ' + hxPct(p[1]) + ' for a draw, on an Elo gap of ' + Math.abs(Math.round(hxGap())) + '.');
  hxInsight('🌍', 'Elo odds: ' + TEAMS[0].key + ' ' + hxPct(p[0]) + ' · draw ' + hxPct(p[1]) + ' · ' + TEAMS[1].key + ' ' + hxPct(p[2]), nm(0) + ' (Elo ' + hxN(HX.a).elo + ') v ' + nm(1) + ' (Elo ' + hxN(HX.b).elo + '). ' + (h ? 'Head-to-head ' + h.w + '-' + h.d + '-' + h.l + ' from ' + h.played + ' meetings.' : 'They have never met.'), D.wdlFit.n);
}
// late-game context once per match, read from the clock each frame
function hxClockLines() {
  if (!hxOn() || !S.started || S.over) return; const mn = ENV.minute, m = S.score[0] - S.score[1], gs = HX.data.gameState;
  if (mn >= 84 && Math.abs(m) <= 1 && hxOnce('late')) hxSay('Late drama is common: ' + hxPct(gs.lateGoal85) + ' of internationals with goals end on a 85th-minute-or-later goal in a game settled by one or level.');
  if (mn >= 30 && hxOnce('timing')) { const b = HX.data.minuteBands; hxSay('Goals come late in internationals: ' + hxPct(b[5][1]) + ' arrive in the last 15 minutes, against ' + hxPct(b[0][1]) + ' in the first 15.'); }
}
// full-time: the result in history, plus an optional Claude polish of the template line (the template stays if SAMPLE is absent)
function hxFull() {
  const s = S.score, w = s[0] > s[1] ? 0 : s[1] > s[0] ? 1 : -1, p = HX.prior || hxWDL(hxGap()), nm = (ti) => TEAMS[ti].club; let t;
  if (w < 0) t = 'A draw, which history put at ' + hxPct(p[1]) + '.';
  else { const pr = p[w ? 2 : 0], h = hxH2H(w ? HX.b : HX.a, w ? HX.a : HX.b); const last = h && h.mar[0];
    t = (pr < 0.3 ? 'An upset! History gave ' + nm(w) + ' only ' + hxPct(pr) + '. ' : nm(w) + ' win, as ' + hxPct(pr) + ' of comparable internationals did. ') + (h ? (last ? 'Their first win over ' + nm(1 - w) + ' since ' + last + '.' : 'Their first ever win over ' + nm(1 - w) + '.') : ''); }
  HX.q = []; hxSay(t, true); const el = hxInsight('🏁', 'The result in history', t, HX.data.wdlFit.n);
  if (SAMPLE && el) SAMPLE('In one lively sentence for a football broadcast, rephrase this without changing any number or name: "' + t + '"', { modelTier: 'quick', cache: false }).then((r) => { const x = typeof r === 'string' ? r : r && r.text; if (x && x.length < 260) el.querySelector('p').textContent = x.trim(); }).catch(() => {});
}
// ---- HUD: a slim live win-probability bar under the scoreboard ----
function hxHud() {
  const el = $('hx-wp'); if (!el) return; const show = hxOn() && S.started && !$('bug').hidden; el.hidden = !show; if (!show) return;
  if (HX.q.length && S.t >= HX.next) { say(HX.q.shift()); HX.next = S.t + 7; }
  hxClockLines(); const key = S.score.join('-') + Math.floor(ENV.minute) + STATS.reds.join(); if (key === HX.wpKey) return; HX.wpKey = key; const p = hxLive(); HX.wp = p; const wb = $('wxchip').getBoundingClientRect(); if (wb.bottom > 0 && innerWidth > 760) el.style.top = Math.round(wb.bottom + 6) + 'px';
  el.innerHTML = '<div class="hx-bar"><i style="flex:' + p[0] + ';background:var(--home)"></i><i style="flex:' + p[1] + ';background:#5B6B7D"></i><i style="flex:' + p[2] + ';background:var(--away)"></i></div><div class="hx-lab"><span>' + TEAMS[0].key + ' ' + hxPct(p[0]) + '</span><span><b class="wl">WIN PROB · </b>D ' + hxPct(p[1]) + '</span><span>' + hxPct(p[2]) + ' ' + TEAMS[1].key + '</span></div>';
}
const _hxHud = hud; hud = function () { _hxHud(); hxHud(); };
// ---- kick-off: strength from Elo, fresh prior ----
const _hxKick = kickOff; kickOff = function () { hxLabels(); HX.prior = null; HX.wpGoal = null; HX.q = []; HX.strength = hxStrength(); if (hxOn()) hxLive(); _hxKick(); if (hxOn()) hxKickLines(); };
window.__mc.kickOff = kickOff;
// ---- dataset export: calibration metadata and the source credit travel with every match file ----
const _hxSum = summary; summary = function (why) {
  const o = _hxSum(why); const D = HX.data; if (!D) return o;
  o.calibration = { source: D.source.name, author: D.source.author, url: D.source.url, licence: D.source.licence, dataThrough: D.source.lastMatch, mode: HX.mode };
  if (hxOn()) Object.assign(o.calibration, { nations: [hxN(HX.a).n, hxN(HX.b).n], elo: [hxN(HX.a).elo, hxN(HX.b).elo], venue: hxHome() < 0 ? 'neutral' : TEAMS[hxHome()].club + ' at home', eloGap: Math.round(hxGap()), competition: HX.comp === 'cup' ? 'International cup' : 'International friendly',
    priorWinDrawLoss: (HX.prior || hxWDL(hxGap())).map((x) => +x.toFixed(3)), finalLiveWinDrawLoss: hxLive().map((x) => +x.toFixed(3)), engineRatingOffset: HX.strength, eloMethod: D.elo.method, headToHead: hxH2H(HX.a, HX.b) });
  return o;
};
// ---- test hooks ----
window.__mc.history = { get elo() { return HX.data ? Object.fromEntries(HX.data.nations.map((n) => [n.n, n.elo])) : null; }, winProb: () => (hxOn() ? hxLive() : null), prior: (gap) => hxWDL(gap ?? hxGap()), h2h: (a, b) => hxH2H(a, b), HX, setMatch: (a, b, opt) => { const ix = (n) => HX.data.nations.findIndex((x) => x.n === n); HX.mode = 'intl'; HX.a = ix(a); HX.b = ix(b); Object.assign(HX, opt || {}); HX.prior = null; hxLabels(); }, club: () => { HX.mode = 'club'; HX.force = null; hxLabels(); }, summary: (why) => summary(why) };
