// ============ PREDICT: the live prediction engine (v10) ============
// Turns live state into falsifiable football forecasts for the Director and Analyst boards, with a one-line "why" for each.
// Nothing here is random: every number is a formula over what the sim is doing right now (shots, xG, territory, momentum,
// ratings, stamina, cards, the bench's in-match rules in tactics.js) plus a prior. Claims are logged, resolved when their
// horizon ends and scored (hit rate, Brier against a no-information baseline), so the model is accountable on air.
//
// TIME BASES. The sim compresses a match: one sim second is S.mscale match seconds. Chances are created per second of PLAY,
// so a 3-minute half has far fewer shots per match minute than a 10-minute half. Base rates are therefore set per 90
// match minutes at the default 3-minute half and scaled by (half/3)^e (fitted, see REPORT.md). Windows and horizons use
// PR.pm, match minutes of play that advance only while the sim runs (not during holds, and not reset by the half-time
// clock jump from 47:00 back to 45:00).
//
// NEXT GOAL. Each side's scoring rate (goals per match minute) is a base rate times bounded multipliers:
//   λi = base · form · rating · territory · momentum · fatigue · men · state · style · prior
//   form     = (recent threat + k·expected)/((1+k)·expected) over the last 20' and the whole match (shrunk towards base)
//   rating   = exp(kr · (mean rating i − mean rating j))         territory = exp(kt · (tilt − 0.5))
//   momentum = exp(km · momentum/100)                             fatigue   = opponent back line and own forwards' stamina
//   men      = 0.7 per own red, 1.3 per opponent red (published studies, as history.js)
//   state    = the bench rules that tactics.js actually runs: chasing ×1.2 (opponent ×1.1), protecting ×0.8 (both sides)
// Over a horizon H (min(10', time left)): P(none) = e^(−ΛH), P(home next) = λh/Λ · (1 − e^(−ΛH)), Λ = λh + λa. Sums to 1.
// RESULT. Goals still to come are independent Poissons (λi · minutes left) added to the current score (Skellam-style).
// Constants: base rates measured on 72 headless matches (40 at 3-minute halves, 32 at 5); factor weights fitted on half of them
// (ridge-pulled towards the hand-set football prior) and checked on the other half. See REPORT.md for the numbers.
const PRK = { g90: 0.275, he: 1.45, g90max: 1.4, s90: 0.65, se: 1.5, f90: 0.79, fe: 1.28, cpf: 0.25, ft90: 4.3, fte: 1.49, conv: 3.8, k: 3, k2: 4,
  w: { fR: 0.15, fS: 0.1, fM: 0.35, rating: 1, terr: 0.9, mom: 0.9, fat: 1.1, men: 1, state: 1, style: 1, prior: 1 },
  rt: 0.06, terr: 0.6, mom: 0.25, fat: 0.8, pri: 0.25, chase: 1.2, prot: 0.8, sub0: 0.36, subS: 0.08, kpC: 2, subB: 0, cardMin: 0.03, Tr: 15, dzK: 0.6, dzAny: 0.7 };
const PR = { log: [], subs: [], snap: null, pm: 0, shots: [], att: [], goals: [], tac: [], pend: [], seq: 0, nextNG: 5, nextDZ: 7, nextCD: 10, nextSB: 12, nextKP: 9, tacDone: {}, focus: null, boxTi: -1, boxT: [-99, -99], ft: [null, null], ftIn: [false, false], stH: new Map(), lastMin: -1, feat: [], bad: 0, badNote: '', prior: null, ok: true };
const prT = (ti) => TEAMS[ti].club, prS = (p) => surname(p.name), prP = (x) => Math.round(x * 100) + '%';
const prCl = (x, a, b) => (x < a ? a : x > b ? b : x);
// zones are from the attacking side's point of view, facing the goal it attacks: in a team's own frame (attacking +x) y=0 is its
// left touchline (the LB slot sits at y=9), because world +z is the right-hand side when facing +x. Thirds of the 68 m width.
const prZone = (y) => (y < 22.67 ? 'left' : y > 45.33 ? 'right' : 'centre');
const prOwnX = (ti, x) => (sideOf(ti) === 0 ? x : 105 - x), prOwnY = (ti, y) => (sideOf(ti) === 0 ? y : 68 - y);
const prLive = (ti) => players.filter((p) => p.ti === ti && !p.off);
const prHs = () => DM.pow((SET.half || 3) / 3, PRK.he); // half-length scaling of chance creation (see TIME BASES)
const prBase = () => Math.min(PRK.g90max, PRK.g90 * prHs()) / 90; // goals per team per match minute with no other information
const prShotBase = () => Math.min(14, PRK.s90 * DM.pow((SET.half || 3) / 3, PRK.se)) / 90;
// minutes of the match left on the clock: what is left of this half plus the next, with added time once it is announced (2' and 3' until then)
function prLeft() {
  if (S.over) return 0; const mn = S.mclock / 60; if (!S.started) return 95;
  if (S.half === 1) return Math.max(0, 45 + (S.stop[0] || 2) - mn) + 45 + 3;
  return Math.max(0.2, 90 + (S.stop[1] || 3) - mn);
}
function prReset() {
  Object.assign(PR, { log: [], snap: null, pm: 0, shots: [], att: [], goals: [], tac: [], pend: [], seq: 0, nextNG: 5, nextDZ: 7, nextCD: 10, nextSB: 12, nextKP: 9, tacDone: {}, focus: null, boxTi: -1, boxT: [-99, -99], ft: [null, null], ftIn: [false, false], stH: new Map(), lastMin: -1, feat: [], bad: 0, badNote: '', prior: null });
  for (const p of players) p.pr = { sh: 0, xg: 0, g: 0, kp: 0, fo: 0, tk: 0, sl: 0, y: 0, ps: 0, pc: 0 };
}
// ---- the scoring-rate model (see header); ov = what-if overrides: { mul:[a,b], stam: Map(player→stamina), rt:[dr0,dr1] } ----
function prRates(ov) {
  ov = ov || {}; const base = prBase(), sb = prShotBase(), pm = PR.pm, Wr = Math.min(20, pm);
  const st = (p) => (ov.stam && ov.stam.has(p) ? ov.stam.get(p) : p.stamina);
  const T = [0, 1].map((ti) => { const L = prLive(ti); let r = 0, sD = 0, nD = 0, sA = 0, nA = 0; for (const p of L) { r += p.rating; const c = roleCat(p.pos); if (c === 1) { sD += st(p); nD++; } else if (c === 3) { sA += st(p); nA++; } }
    return { n: L.length, sDi: 0, r: r / Math.max(1, L.length) + (ov.rt ? ov.rt[ti] : 0), sD: nD ? sD / nD : 0.8, sA: nA ? sA / nA : 0.8, tc: TEAMS[ti].tac && TEAMS[ti].tac.cur, tac: TEAMS[ti].tac || {} }; });
  let pri = null; try { const H = window.__mc.history; if (H && H.winProb()) pri = H.prior(); } catch (e) {}
  const out = { lam: [0, 0], lp: [0, 0], f: [{}, {}], rec: [{}, {}], base, pri };
  for (let ti = 0; ti < 2; ti++) {
    const j = 1 - ti, A = T[ti], B = T[j]; let thR = 0, thA = 0, sR = 0, xR = 0;
    for (const s of PR.shots) { if (s.ti !== ti) continue; const g = PRK.conv * Math.min(s.xg, 0.45); thA += g; if (s.pm >= pm - Wr) { thR += g; sR++; xR += s.xg; } }
    const eR = base * Math.max(Wr, 1), eS = sb * Math.max(Wr, 1), eM = base * Math.max(pm, 1);
    const fR = (thR + PRK.k * eR) / ((1 + PRK.k) * eR), fS = (sR + PRK.k * eS) / ((1 + PRK.k) * eS), fM = (thA + PRK.k2 * eM) / ((1 + PRK.k2) * eM);
    const f = {
      form: prCl(DM.pow(fR, PRK.w.fR) * DM.pow(fS, PRK.w.fS) * DM.pow(fM, PRK.w.fM), 0.45, 2.6),
      rating: DM.exp(PRK.rt * (A.r - B.r)),
      terr: DM.exp(PRK.terr * ((EX.terr ? EX.terr[ti] : 0.5) - 0.5)),
      mom: DM.exp(PRK.mom * (ti === 0 ? 1 : -1) * (EX.mom || 0) / 100),
      fat: prCl(DM.exp(PRK.fat * ((A.sA - B.sA) + (A.sD - B.sD)) / 2), 0.75, 1.35),
      men: DM.pow(0.7, 11 - A.n) * DM.pow(1.3, 11 - B.n),
      state: (A.tac.chasing ? PRK.chase : 1) * (B.tac.chasing ? 1.1 : 1) * (A.tac.protecting ? PRK.prot : 1) * (B.tac.protecting ? 0.85 : 1),
      style: A.tc && B.tc ? prCl((1 + 0.25 * (A.tc.tempo - 0.6)) * (1 + 0.2 * (B.tc.line - 0.5)) * (1 + 0.12 * (A.tc.press - 0.5)), 0.8, 1.25) : 1,
      prior: pri ? DM.pow(Math.max(0.02, pri[ti === 0 ? 0 : 2]) / Math.max(0.02, pri[ti === 0 ? 2 : 0]), PRK.pri / 2) : 1,
    };
    let lam = base, lp = base; for (const k in f) { const v = k === 'form' ? f[k] : DM.pow(f[k], PRK.w[k] ?? 1); lam *= v; if (k !== 'form' && k !== 'terr' && k !== 'mom') lp *= v; } if (ov.mul) { lam *= ov.mul[ti]; lp *= ov.mul[ti]; }
    out.lam[ti] = lam; out.lp[ti] = lp; out.f[ti] = f; out.rec[ti] = { shots: sR, xg: xR, win: Wr, r: A.r, sD: B.sD, sA: A.sA, thR, thA, fR, fS, fM };
  }
  return out;
}
// Poisson tail table: goals still to come for each side, added to the current score (truncated at 10 and renormalised)
// Live form, territory and momentum are spells that fade, so they only drive the next PRK.Tr minutes; after that each side
// reverts to its persistent rate (ratings, men on the pitch, game state, style, fatigue, prior):  μi = λi·min(left, Tr) + λpi·max(0, left − Tr)
function prResult(R, left) {
  if (S.over || left <= 0) { const d = S.score[0] - S.score[1]; return { home: d > 0 ? 1 : 0, draw: d === 0 ? 1 : 0, away: d < 0 ? 1 : 0 }; }
  const T = Math.min(left, PRK.Tr), a = R.lam[0] * T + R.lp[0] * (left - T), b = R.lam[1] * T + R.lp[1] * (left - T), N = 10; let h = 0, d = 0, w = 0, pa = DM.exp(-a);
  for (let x = 0; x <= N; x++) { let pb = DM.exp(-b); for (let y = 0; y <= N; y++) { const p = pa * pb, g = S.score[0] + x - S.score[1] - y; if (g > 0) h += p; else if (g < 0) w += p; else d += p; pb *= b / (y + 1); } pa *= a / (x + 1); }
  const t = h + d + w; return { home: h / t, draw: d / t, away: w / t };
}
function prNext(lam, H) { const L = lam[0] + lam[1]; const none = DM.exp(-L * H); const any = 1 - none; return { home: L > 0 ? lam[0] / L * any : 0, away: L > 0 ? lam[1] / L * any : 0, none }; }
// readable reasons: the largest multipliers for a side, in football words
function prWhy(R, ti) {
  const f = R.f[ti], c = R.rec[ti], o = [], T = prT(ti);
  if (c.win >= 5 && Math.abs(DM.log(f.form)) > 0.04) o.push([Math.abs(DM.log(f.form)), c.shots ? T + ' have ' + c.shots + ' shot' + (c.shots > 1 ? 's' : '') + ' and ' + c.xg.toFixed(2) + ' xG in the last ' + Math.round(c.win) + '\'' : T + ' have not had a shot in ' + Math.round(c.win) + '\'']);
  if (Math.abs(DM.log(f.men)) > 0.05) o.push([Math.abs(DM.log(f.men)), f.men < 1 ? T + ' are a man down' : T + ' have the extra man']);
  if (Math.abs(DM.log(f.state)) > 0.05) o.push([Math.abs(DM.log(f.state)), TEAMS[ti].tac.chasing ? T + ' are chasing the game with a higher line' : TEAMS[ti].tac.protecting ? T + ' have dropped deep to protect the lead' : 'the other side\'s game plan is opening space for ' + T]);
  if (Math.abs(DM.log(f.rating)) > 0.06) o.push([Math.abs(DM.log(f.rating)), T + (f.rating > 1 ? ' have the stronger XI' : ' have the weaker XI') + ' (avg rating ' + c.r.toFixed(1) + ')']);
  if (Math.abs(DM.log(f.terr * f.mom)) > 0.06) o.push([Math.abs(DM.log(f.terr * f.mom)), T + (f.terr * f.mom > 1 ? ' own the territory' : ' are pinned back') + ' (' + Math.round((EX.terr ? EX.terr[ti] : 0.5) * 100) + '% field tilt)']);
  if (Math.abs(DM.log(f.fat)) > 0.05) o.push([Math.abs(DM.log(f.fat)), f.fat > 1 ? T + ' are the fresher side (forwards ' + prP(c.sA) + ' v ' + prT(1 - ti) + '\'s back line ' + prP(c.sD) + ')' : T + ' are tiring faster (forwards at ' + prP(c.sA) + ')']);
  if (Math.abs(DM.log(f.prior)) > 0.05) o.push([Math.abs(DM.log(f.prior)), 'the Elo prior ' + (f.prior > 1 ? 'favours ' : 'is against ') + T]);
  return o.sort((a, b) => b[0] - a[0]).slice(0, 2).map((x) => x[1]);
}
// ---- danger zone: where a side's attacks have come from (decayed, with a prior) and the full-back each flank runs at ----
function prDanger(R) {
  const ti = R.lam[0] >= R.lam[1] ? 0 : 1, j = 1 - ti, w = { left: 3, centre: 4, right: 3 }, n = { left: 0, centre: 0, right: 0 };
  for (const a of PR.att) if (a.ti === ti) { const k = DM.exp(-(PR.pm - a.pm) / 15) * (a.shot ? 2 : a.box ? 1.5 : 1); w[a.zone] += PRK.dzK * k; n[a.zone] += k > 0.3 ? 1 : 0; }
  // matchups: our wide attacker on that flank against the opponent defender covering it (their right side is our left)
  const mu = {}; const D = prLive(j).filter((p) => roleCat(p.pos) === 1), A = prLive(ti).filter((p) => roleCat(p.pos) >= 2);
  for (const z of ['left', 'right']) {
    const yc = z === 'left' ? 10 : 58; const near = (L, flip) => L.slice().sort((a, b) => Math.abs((flip ? 68 - a.slot.y : a.slot.y) - yc) - Math.abs((flip ? 68 - b.slot.y : b.slot.y) - yc))[0];
    const fb = near(D, true), at = near(A, false); if (!fb || !at) continue;
    const m = prCl((1 + 0.5 * (0.75 - fb.stamina)) * DM.exp(0.02 * (at.rating - fb.rating)), 0.85, 1.25); w[z] *= m; mu[z] = { fb, at, m };
  }
  const t = w.left + w.centre + w.right; const P = { left: w.left / t, centre: w.centre / t, right: w.right / t };
  const zone = P.left >= P.centre && P.left >= P.right ? 'left' : P.right >= P.centre ? 'right' : 'centre'; const M = mu[zone];
  const why = prT(ti) + ' ' + (n[zone] ? 'have gone ' + (zone === 'centre' ? 'through the middle' : 'down the ' + zone) + ' ' + n[zone] + ' time' + (n[zone] > 1 ? 's' : '') + ' recently' : 'have no clear pattern yet, so this is the base split')
    + (M ? ', and ' + prS(M.at) + ' (' + M.at.pos + ', rated ' + M.at.rating + ') is up against ' + prS(M.fb) + ' (' + M.fb.pos + ', ' + M.fb.rating + ') at ' + prP(M.fb.stamina) + ' stamina' : '');
  return { ti, zone, p: P[zone], probs: P, why, mu: M || null };
}
// ---- key players: threat (shooting), creator (passing), stopper (defending), from attributes and live numbers ----
function prKeys(R) {
  const out = [];
  for (const p of players) {
    if (p.off || !p.pr) continue; const x = p.pr, s = p.xs || {}, c = roleCat(p.pos), legs = 0.75 + 0.25 * p.stamina, team = R.lam[p.ti] / R.base;
    const thr = (c === 3 ? 1 : c === 2 ? 0.6 : 0.15) * (40 * p.shotS + 18 * p.drib + 0.35 * (p.rating - 60)) * legs * Math.sqrt(prCl(team, 0.5, 2)) + 9 * x.sh + 25 * x.xg + 14 * x.g;
    const cre = (c === 2 ? 1 : c === 3 ? 0.75 : 0.4) * (42 * p.passS + 0.4 * (p.rating - 60)) * legs + 10 * x.kp + 0.4 * (s.comp || 0) + (s.passes ? 0.06 * (s.diffSum / s.passes) : 0);
    const stp = p.gk ? 30 + 0.6 * (p.rating - 60) + 0.5 * (R.lam[1 - p.ti] / R.base) * 6 : (c === 1 ? 1 : c === 2 ? 0.7 : 0.25) * (40 * p.tackle + 0.4 * (p.rating - 60)) * legs + 5 * x.tk - 6 * x.fo;
    const best = [['threat', thr, x.sh ? x.sh + ' shot' + (x.sh > 1 ? 's' : '') + ', ' + x.xg.toFixed(2) + ' xG' + (x.g ? ', ' + x.g + ' goal' + (x.g > 1 ? 's' : '') : '') : 'shooting ' + Math.round(p.shotS * 100) + ', dribbling ' + Math.round(p.drib * 100)],
      ['creator', cre, (s.passes ? (s.comp || 0) + '/' + s.passes + ' passes' : 'passing ' + Math.round(p.passS * 100)) + (x.kp ? ', ' + x.kp + ' shot-creating' : '')],
      ['stopper', stp, p.gk ? 'last line against ' + prT(1 - p.ti) + '\'s ' + prP(1 - DM.exp(-R.lam[1 - p.ti] * 10)) + ' 10\' threat' : (x.tk ? x.tk + ' ball' + (x.tk > 1 ? 's' : '') + ' won, ' : '') + 'tackling ' + Math.round(p.tackle * 100)]].sort((a, b) => b[1] - a[1])[0];
    out.push({ name: p.name, num: p.num, ti: p.ti, pos: p.pos, role: best[0], score: Math.round(prCl(best[1], 0, 100)), why: prS(p) + ' (' + p.pos + ', ' + p.rating + '): ' + best[2] + (p.stamina < 0.5 ? ', but legs going at ' + prP(p.stamina) : ''), p });
  }
  out.sort((a, b) => b.score - a.score); const pick = [], seen = { threat: 0, creator: 0, stopper: 0 };
  for (const k of out) { if (pick.length >= 5) break; if (seen[k.role] >= 2) continue; seen[k.role]++; pick.push(k); }
  return pick;
}
// ---- card risk: each player's foul rate (team rate shared by role, tackling, legs and his own record) × P(card | foul) ----
function prCards(H) {
  const fb = PRK.f90 * DM.pow((SET.half || 3) / 3, PRK.fe) / 90, pm = Math.max(PR.pm, 1), out = [];
  for (let ti = 0; ti < 2; ti++) {
    const L = prLive(ti).filter((p) => !p.gk); if (!L.length) continue; const tc = TEAMS[ti].tac.cur || {}; const press = tc.press ?? 0.5;
    // team fouls per match minute, shrunk to the base rate with 20 minutes of prior weight (pressing sides foul more)
    const rate = prCl((STATS.fouls[ti] + fb * 20 * (1 + 0.6 * (press - 0.5))) / (pm + 20), fb * 0.4, fb * 4);
    const w = L.map((p) => { const c = roleCat(p.pos); return (c === 1 ? 1.3 : c === 2 ? 1.1 : 0.6) * (1 + 1.5 * (1 - p.tackle)) * (1 + 0.8 * (1 - p.stamina)) * (1 + 1.2 * p.pr.fo + 0.4 * p.pr.sl); }); const ws = w.reduce((a, b) => a + b, 0);
    const cpf = prCl(PRK.cpf + 2 * (tc.foul || 0), 0.15, 0.8);
    L.forEach((p, i) => { const hz = rate * w[i] / ws * cpf; const pc = 1 - DM.exp(-hz * H);
      out.push({ name: p.name, num: p.num, ti, p: pc, why: prS(p) + ': ' + (p.pr.fo ? p.pr.fo + ' foul' + (p.pr.fo > 1 ? 's' : '') + ' already, ' : '') + (p.pr.sl ? p.pr.sl + ' slide tackle' + (p.pr.sl > 1 ? 's' : '') + ', ' : '') + 'tackling ' + Math.round(p.tackle * 100) + ', ' + prP(p.stamina) + ' stamina' + ((p.yellows || 0) ? '. ON A YELLOW: next card is red' : '') + (tc.foul > 0.02 ? '. ' + prT(ti) + '\'s ' + (TEAMS[ti].tac.style || '') + ' style fouls more' : ''), yel: p.yellows || 0, pl: p }); });
  }
  return out.sort((a, b) => b.p - a.p);
}
// ---- fatigue and the substitution call: the engine has no bench, so "sub" means a manager would want him off ----
// subSoon = P(stamina dips below 35% within 10') = σ((s0 − stamina)/0.08), fitted on 72 matches; s0 = 0.36 at 3-minute halves,
// +0.035 per extra real minute (stamina drains per sim second, so 10 match minutes last longer in a longer half)
function prFatigue(H) {
  const out = [];
  for (const p of players) {
    if (p.off || p.gk) continue; const h = PR.stH.get(p) || []; const slope = h.length >= 3 ? (p.stamina - h[0]) / Math.max(1, h.length - 1) : 0; // per match minute
    const s0 = prCl(PRK.sub0 + 0.035 * ((SET.half || 3) - 3), 0.3, 0.55); const sub = prCl(1 / (1 + DM.exp((p.stamina + PRK.subB * slope - s0) / PRK.subS)) * Math.min(1, H / 10 + 0.3), 0, 1);
    out.push({ name: p.name, num: p.num, ti: p.ti, stamina: +p.stamina.toFixed(3), subSoon: sub, why: prS(p) + ' (' + p.pos + ') at ' + prP(p.stamina) + (slope < -0.003 ? ', dropping ' + (Math.abs(slope) * 1000).toFixed(0) / 10 + ' points a minute' : slope > 0.003 ? ', recovering' : '') + (p.xs ? ', ' + p.xs.sprints + ' sprints' : ''), pl: p, slope });
  }
  return out.sort((a, b) => a.stamina - b.stamina);
}
// ---- tactical changes: the manager's actual rulebook in adaptTactics (tactics.js), turned into probabilities ----
//   chasing:    minute ≥ 62, behind, 50% each minute     protecting: minute ≥ 76, ahead, 55% each minute
//   heat:       minute ≥ 55, heat > 0.75, press > 0.6, 60%  waterlogged: puddles > 0.35 and a short game, 60%
function prTactics(R, H, D) {
  const out = [], mn = S.mclock / 60, end = S.half * 45 + (S.stop[S.half - 1] || 2); const ticks = (from) => { let k = 0; for (let m = Math.floor(mn) + 1; m <= Math.min(mn + H, end); m++) if (m >= from) k++; return k; };
  for (let ti = 0; ti < 2; ti++) {
    const tac = TEAMS[ti].tac; if (!tac || !tac.cur) continue; const c = tac.cur, diff = S.score[ti] - S.score[1 - ti], T = prT(ti), j = 1 - ti;
    const keep = (lamOpp) => DM.exp(-lamOpp * H / 2); // P(the scoreline that triggers the rule survives to the eligible minute)
    if (!tac.chasing) { const k = ticks(62); let p = 0; if (diff < 0) p = (1 - DM.pow(0.5, k)) * keep(R.lam[ti]); else if (diff === 0) p = (1 - DM.exp(-R.lam[j] * H)) * 0.5 * (1 - DM.pow(0.5, Math.max(0, k - 3)));
      const f = ['3-5-2', '3-4-3', '5-3-2', '5-4-1'].includes(tac.form) ? '3-4-3' : diff <= -2 ? '3-4-3' : '4-2-3-1';
      if (p > 0.02) out.push({ ti, kind: 'formation', rule: 'chasing the game', p, text: T + ' chase the game: ' + f + ', press and line up, more runners', why: diff < 0 ? T + ' are ' + -diff + ' down; from 62\' the bench throws men forward (50% a minute)' + (k ? '' : ', not eligible until 62\'') : 'level: only if they concede first' }); }
    if (!tac.protecting) { const k = ticks(76); let p = 0; if (diff > 0) p = (1 - DM.pow(0.45, k)) * keep(R.lam[j]); else if (diff === 0) p = (1 - DM.exp(-R.lam[ti] * H)) * 0.5 * (1 - DM.pow(0.45, Math.max(0, k - 3)));
      if (p > 0.02) out.push({ ti, kind: 'shape', rule: 'protecting the lead', p, text: T + ' drop deep and narrow (' + (diff >= 2 ? '4-4-2' : '5-4-1') + ') to see it out', why: diff > 0 ? T + ' lead by ' + diff + '; from 76\' the bench shuts up shop (55% a minute)' : 'level: only if they score first' }); }
    if (!tac.saving && ENV.heat > 0.75 && c.press > 0.6) { const p = 1 - DM.pow(0.4, ticks(55)); if (p > 0.02) out.push({ ti, kind: 'press', rule: 'heat: pressing less', p, text: T + ' stop pressing so high to save legs in the heat', why: 'heat index ' + ENV.heat.toFixed(2) + ' and a ' + Math.round(c.press * 100) + '% press: unsustainable after 55\'' }); }
    if (!tac.wet && c.short > 0.6) { const pud = ENV.puddle || 0; const p = pud > 0.35 ? 1 - DM.pow(0.4, Math.max(1, Math.round(H))) : pud > 0.2 ? 0.25 * (pud - 0.2) / 0.15 : 0; if (p > 0.02) out.push({ ti, kind: 'tempo', rule: 'waterlogged: going long', p, text: T + ' abandon the short game and go long', why: 'standing water ' + Math.round(pud * 100) + '% and a short-passing side' }); }
    if (D && D.ti === ti && D.p > 0.42 && D.mu) out.push({ ti, kind: 'flank', rule: null, p: D.p, text: T + ' keep targeting the ' + D.zone + ' flank', why: D.why });
  }
  return out.sort((a, b) => b.p - a.p);
}
// ---- wild-moment detector: chaos spikes, comebacks, red-card danger, late drama, upsets against the prior, milestones ----
function prWild(R, res, ng, cards) {
  const C = [], mn = S.mclock / 60, diff = S.score[0] - S.score[1], ctl = EX.ctl ?? 60, ago = typeof exCtlAgo === 'function' ? exCtlAgo(60) : ctl;
  if (ctl < 40) C.push({ score: prCl(30 + (60 - ctl) + 0.6 * Math.max(0, ago - ctl), 0, 100), kind: 'chaos', text: 'The game has broken open', why: 'Control index ' + Math.round(ctl) + ' (was ' + Math.round(ago) + ' a minute ago): ' + (EX.ctlC ? EX.ctlC.turnoversPerMin + ' turnovers a minute, ' + EX.ctlC.completion + '% passing' : 'turnovers everywhere') });
  if (diff) { const tr = diff > 0 ? 1 : 0, m = (tr === 0 ? 1 : -1) * (EX.mom || 0), pg = tr === 0 ? ng.home : ng.away, avoid = tr === 0 ? res.home + res.draw : res.away + res.draw;
    if (Math.abs(diff) <= 2 && (m > 25 || pg > 0.15)) C.push({ score: prCl(25 + m * 0.4 + pg * 150 + (mn > 70 ? 10 : 0), 0, 100), kind: 'comeback', text: prT(tr) + ' are coming back', why: prT(tr) + ' trail by ' + Math.abs(diff) + ' but have momentum ' + Math.round(m) + ' and a ' + prP(pg) + ' chance of the next goal; ' + prP(avoid) + ' to avoid defeat' }); }
  const y = cards.find((c) => c.yel > 0); if (y && y.p > 0.06) C.push({ score: prCl(35 + y.p * 220, 0, 100), kind: 'red_card', text: prS(y.pl) + ' is one tackle from a red', why: y.why + ' (' + prP(y.p) + ' card chance in 10\')' });
  if (mn > 80 && Math.abs(diff) <= 1 && !S.over) { const any = 1 - ng.none; C.push({ score: prCl(30 + any * 120 + (mn - 80) * 2, 0, 100), kind: 'late_drama', text: diff ? 'One goal in it, ' + Math.round(mn) + ' minutes gone' : 'All square late on', why: prP(any) + ' chance of a goal in the last ' + Math.max(1, Math.round(prLeft())) + '\'; ' + (diff ? prT(diff > 0 ? 1 : 0) + ' need one to rescue a point' : 'the next goal probably wins it') }); }
  const P0 = PR.prior; if (P0 && S.started) { const fav = P0.home >= P0.away ? 0 : 1, pf = fav === 0 ? P0.home : P0.away, now = fav === 0 ? res.home : res.away;
    if (pf > 0.42 && now < pf * 0.5) C.push({ score: prCl(30 + (pf - now) * 120, 0, 100), kind: 'upset', text: 'Upset alert: ' + prT(1 - fav) + ' against the odds', why: prT(fav) + ' were ' + prP(pf) + ' to win before kick-off' + (R.pri ? ' on Elo' : ' on ratings') + '; now ' + prP(now) }); }
  for (const p of players) if (!p.off && p.pr && p.pr.g >= 2 && !S.over) { const g2 = p.pr.g2pm ?? PR.pm; C.push({ score: Math.max(40, 72 - 1.2 * (PR.pm - g2)), kind: 'milestone', text: prS(p) + ' is on a hat-trick', why: prS(p) + ' has ' + p.pr.g + ' goals; one more is the match ball' }); break; }
  if (!EX.km10) { let b = null; for (const p of players) if (p.xs && !p.off && (!b || p.xs.dm > b.xs.dm)) b = p; if (b) { const km = exKm(b.xs); if (km > 9.7 && km < 10) C.push({ score: 46, kind: 'milestone', text: prS(b) + ' closing on 10 km', why: prS(b) + ' has covered ' + km.toFixed(1) + ' km of match distance' }); } }
  C.sort((a, b) => b.score - a.score); const w = C[0]; return w && w.score >= 45 ? { score: Math.round(w.score), kind: w.kind, text: w.text, why: w.why } : null;
}
// ---- the director's call: which player and which camera now, held for at least 4 s so the cut never flickers ----
function prFocus(keys, D, wild, cards) {
  const c = [], own = S.owner, R = S.restart, si = S.shotInfo;
  const kp = (p) => keys.find((k) => k.p === p); const add = (p, cam, score, reason, hard) => { if (p && !p.off) c.push({ p, cam, score, reason, hard: !!hard }); };
  if (S.celebrate > 0 && S.scorer) add(S.scorer, 'player', 100, 'Goal: stay on the scorer', true);
  if (R && R.taker && (R.type === 'penalty')) add(R.taker, 'goal', 95, 'Penalty: behind-the-goal on the taker', true);
  else if (R && R.taker && R.type === 'corner') add(R.taker, 'goal', 70, 'Corner: the box from behind the goal');
  else if (R && R.taker && R.type === 'freekick' && R.spot && R.spot.distanceTo(goalOf(R.team)) < 32) add(R.taker, 'goal', 80, 'Free kick in shooting range');
  if (si && S.t - si.t < 1.5) add(si.p, 'goal', 90, 'Shot: ' + si.kmh + ' km/h, xG ' + si.xg.toFixed(2), true);
  // restarts that reset the shape (kick-off, goal kick) are the moment to show both teams' structure from the tactical camera
  if (R && R.taker && (R.type === 'kickoff' || R.type === 'goalkick')) add(R.taker, 'high', 66, (R.type === 'kickoff' ? 'Kick-off' : 'Goal kick') + ': tactical camera on the shapes (' + TEAMS[0].tac.form + ' v ' + TEAMS[1].tac.form + ')');
  if (own && !R) { const ox = prOwnX(own.ti, own.pos2.x), k = kp(own), ks = k ? k.score * 0.25 : 0, fast = S.possHow === 'won' && S.t - (S.possT || 0) < 6 && ox < 75;
    if (fast) add(own, 'ball', 62 + ks, 'Counter-attack: ball camera rides with ' + prS(own));
    else if (ox > 70) add(own, 'dynamic', 60 + ks, prS(own) + ' on the ball in the final third');
    else add(own, 'broadcast', 42 + ks, prS(own) + ' on the ball, ' + (ox < 36 ? 'building from the back' : 'in midfield'));
    // isolation: the side's danger-flank attacker off the ball while his team has it, near enough to be the next pass
    if (D && D.mu && D.mu.at && D.ti === own.ti && D.mu.at !== own && D.mu.at.pos2.distanceTo(own.pos2) < 30) add(D.mu.at, 'player', 55 + 60 * (D.p - 0.3) + 25 * (D.mu.m - 1), 'Isolate ' + prS(D.mu.at) + ' (' + D.mu.at.rating + ') v ' + prS(D.mu.fb) + ' (' + prP(D.mu.fb.stamina) + ' stamina) on the ' + D.zone);
    const top = keys.find((x) => x.role === 'threat' && x.ti === own.ti && x.p !== own); if (top && ox > 55 && top.p.pos2.distanceTo(own.pos2) < 25) add(top.p, 'player', 50 + top.score * 0.15, 'Key threat ' + prS(top.p) + ' lurking (' + top.score + ')'); }
  const t = PR.tac[PR.tac.length - 1]; if (t && S.t - t.t < 8) add(prLive(t.ti).find((p) => p.pos === 'DM' || p.pos === 'CM') || prLive(t.ti)[1], 'high', 75, 'Tactical camera: ' + prT(t.ti) + ' just changed shape');
  if (wild && wild.kind === 'chaos' && own) add(own, 'broadcast', 60, 'Wide shot: ' + wild.text.toLowerCase());
  const cr = cards[0]; if (cr && cr.yel && cr.p > 0.08 && own && own.ti !== cr.ti && cr.pl.pos2.distanceTo(own.pos2) < 8) add(cr.pl, 'player', 72, prS(cr.pl) + ' (on a yellow) is closing in on ' + prS(own));
  if (!c.length) return PR.focus;
  c.sort((a, b) => b.score - a.score); const b = c[0], f = PR.focus;
  const keepOk = f && f.pl && !f.pl.off && S.t < f.until; const same = f && f.pl === b.p && f.cam === b.cam;
  if (same) { f.reason = b.reason; f.score = b.score; f.until = Math.max(f.until, S.t + (b.hard ? 4 : 2)); return f; }
  if (keepOk && !(b.hard && b.score > f.score + 10)) return f;
  PR.focus = { name: b.p.name, num: b.p.num, ti: b.p.ti, cam: b.cam, reason: b.reason, until: +(S.t + 4).toFixed(2), score: b.score, pl: b.p }; return PR.focus;
}
// ---- storylines: ranked on-air ideas built from the snapshot ----
function prStories(o, R) {
  const s = [], mn = Math.floor(S.mclock / 60), ng = o.nextGoal, fav = ng.home >= ng.away ? 0 : 1, pf = fav ? ng.away : ng.home;
  s.push({ id: 'ng', priority: Math.round(prCl(35 + pf * 160, 0, 95)), title: 'Next goal: ' + prT(fav) + ' ' + prP(pf), text: (ng.why[0] || '') + '. ' + prP(ng.none) + ' chance of no goal in the next ' + ng.horizonMin + '\'.', graphic: 'prediction' });
  const k = o.keyPlayers[0]; if (k) s.push({ id: 'kp-' + k.ti + '-' + k.num, priority: Math.round(prCl(k.score * 0.8, 0, 90)), title: 'Key ' + k.role + ': ' + k.name, text: k.why, graphic: 'player' });
  if (o.wild) s.push({ id: 'wild-' + o.wild.kind, priority: o.wild.score, title: o.wild.text, text: o.wild.why, graphic: o.wild.kind === 'upset' ? 'history' : 'stat' });
  const cr = o.cardRisk[0]; if (cr && cr.p > 0.1) s.push({ id: 'card-' + cr.ti + '-' + cr.num, priority: Math.round(prCl(30 + cr.p * 150, 0, 85)), title: 'Card watch: ' + cr.name, text: cr.why + '. ' + prP(cr.p) + ' to be booked in the next 10\'.', graphic: 'player' });
  const ft = o.fatigue[0]; if (ft && ft.stamina < 0.5) s.push({ id: 'fat-' + ft.ti + '-' + ft.num, priority: Math.round(prCl(25 + (0.5 - ft.stamina) * 120 + ft.subSoon * 20, 0, 80)), title: 'Running on empty: ' + ft.name, text: ft.why + '. A manager would be warming someone up (' + prP(ft.subSoon) + ').', graphic: 'player' });
  const t = o.tactical[0]; if (t && t.p > 0.25) s.push({ id: 'tac-' + t.ti + '-' + t.kind, priority: Math.round(prCl(30 + t.p * 50, 0, 85)), title: 'Tactical watch: ' + prT(t.ti), text: t.text + ' (' + prP(t.p) + '). ' + t.why + '.', graphic: 'tactic' });
  if (o.danger) s.push({ id: 'dz-' + o.danger.ti, priority: Math.round(prCl(20 + (o.danger.p - 0.33) * 150, 0, 70)), title: 'Danger zone: ' + prT(o.danger.ti) + ' ' + o.danger.zone, text: o.danger.why + '.', graphic: 'tactic' });
  if (R.pri && mn < 30) s.push({ id: 'hist', priority: 40, title: 'Elo prior', text: TEAMS[0].club + ' ' + prP(R.pri[0]) + ' · draw ' + prP(R.pri[1]) + ' · ' + TEAMS[1].club + ' ' + prP(R.pri[2]) + ' before kick-off; live now ' + prP(o.result.home) + ' · ' + prP(o.result.draw) + ' · ' + prP(o.result.away) + '.', graphic: 'history' });
  const sc = predScore().overall; if (sc.n >= 6) s.push({ id: 'calib', priority: 30, title: 'Model scorecard: ' + sc.hits + '/' + sc.n, text: 'Our live calls are ' + prP(sc.hitRate) + ' right, Brier ' + sc.brier.toFixed(3) + ' (lower is better).', graphic: 'prediction' });
  return s.sort((a, b) => b.priority - a.priority).slice(0, 6);
}
// ---- the snapshot (cached, recomputed at most every 0.5 sim seconds) ----
function prCompute() {
  const R = prRates(), left = prLeft(), H = Math.min(10, left), mn = Math.floor(S.mclock / 60);
  const result = prResult(R, left), n = prNext(R.lam, H);
  const D = prDanger(R), why = [], fav = R.lam[0] >= R.lam[1] ? 0 : 1;
  why.push(...prWhy(R, fav)); const w2 = prWhy(R, 1 - fav)[0]; if (w2) why.push(w2); if (D.mu && D.ti === fav) why.push(prS(D.mu.at) + ' (' + D.mu.at.pos + ', rated ' + D.mu.at.rating + ') is up against ' + prS(D.mu.fb) + ' at ' + prP(D.mu.fb.stamina) + ' stamina');
  if (!why.length) why.push('No strong signal yet: base scoring rates for this half length');
  const cards = prCards(H), fat = prFatigue(H), keys = prKeys(R), nextGoal = { home: n.home, away: n.away, none: n.none, horizonMin: 10, why: why.slice(0, 4), lam: R.lam.slice(), horizonUsed: +H.toFixed(2) };
  const tac = prTactics(R, H, D), wild = prWild(R, result, nextGoal, cards), foc = prFocus(keys, D, wild, cards);
  const o = { simT: +S.t.toFixed(2), minute: mn, result, nextGoal, danger: { ti: D.ti, zone: D.zone, p: D.p, why: D.why, probs: D.probs },
    keyPlayers: keys.map(({ p, ...k }) => k), cardRisk: cards.slice(0, 3).map(({ pl, yel, ...c }) => c), fatigue: fat.slice(0, 4).map(({ pl, slope, ...f }) => f),
    tactical: tac.slice(0, 4).map(({ rule, ...t }) => t), wild, focus: foc ? { name: foc.name, num: foc.num, ti: foc.ti, cam: foc.cam, reason: foc.reason, until: foc.until } : { name: '', num: 0, ti: 0, cam: 'broadcast', reason: 'Waiting for kick-off', until: S.t + 4 }, storylines: [] };
  o.storylines = prStories(o, R);
  // invariants the Verifier row audits: every probability inside 0..1, result and next goal each summing to 1
  const pr = [result.home, result.draw, result.away, n.home, n.away, n.none, D.p, ...o.cardRisk.map((c) => c.p), ...o.fatigue.map((f) => f.subSoon), ...o.tactical.map((t) => t.p)];
  const okP = pr.every((x) => Number.isFinite(x) && x >= 0 && x <= 1), s1 = Math.abs(result.home + result.draw + result.away - 1), s2 = Math.abs(n.home + n.away + n.none - 1);
  if (!okP || s1 > 1e-6 || s2 > 1e-6) { PR.bad++; PR.badNote = !okP ? 'A probability fell outside 0..1' : 'Probabilities summed to ' + (s1 > 1e-6 ? (1 + s1).toFixed(4) : (1 + s2).toFixed(4)); }
  return { o, R, H, D, cards, fat, keys, tac };
}
function predNow() {
  if (PR.snap && Math.abs(S.t - PR.snap.o.simT) < 0.5 && PR.snap.sc === S.score[0] * 100 + S.score[1]) return PR.snap.o;
  try { PR.snap = prCompute(); PR.snap.sc = S.score[0] * 100 + S.score[1]; } catch (e) { console.error('predict', e); if (!PR.snap) return { simT: S.t, minute: 0, result: { home: 0.4, draw: 0.3, away: 0.3 }, nextGoal: { home: 0, away: 0, none: 1, horizonMin: 10, why: ['Model warming up'] }, danger: { ti: 0, zone: 'centre', p: 0.4, why: '' }, keyPlayers: [], cardRisk: [], fatigue: [], tactical: [], wild: null, focus: { name: '', num: 0, ti: 0, cam: 'broadcast', reason: '', until: S.t + 4 }, storylines: [] }; }
  return PR.snap.o;
}
// ---- accountability: falsifiable claims, resolved at their horizon, scored with hit rate and Brier ----
function onPrediction(fn) { PR.subs.push(fn); }
function predLog() { return PR.log; }
const prEmit = (r) => { for (const f of PR.subs) { try { f(r); } catch (e) { console.error(e); } } };
function prClaim(kind, subject, claim, p, H, extra) {
  const r = Object.assign({ id: 'pr' + (++PR.seq), simT: +S.t.toFixed(2), minute: Math.floor(S.mclock / 60), kind, subject, claim, p: +prCl(p, 0, 1).toFixed(4), horizonS: +(H * 60 / (S.mscale || 1)).toFixed(1), resolved: null, resolvedAt: null }, extra || {});
  r.pm0 = PR.pm; r.pmEnd = PR.pm + H; PR.log.push(r); PR.pend.push(r);
  dataEvent('prediction', { id: r.id, kind, subject, claim, p: r.p, horizonMin: +H.toFixed(1) }); prEmit(r); return r;
}
function prResolve(r, ok, note) {
  if (r.resolved !== null) return; r.resolved = !!ok; r.resolvedAt = +S.t.toFixed(2); r.note = note || ''; PR.pend = PR.pend.filter((x) => x !== r);
  if (r.probs) { const o = r.outcome || 'none'; r.brier3 = ['home', 'away', 'none'].reduce((a, k) => a + DM.sq(r.probs[k] - (k === o ? 1 : 0)), 0); if (r.base3) r.brier3b = ['home', 'away', 'none'].reduce((a, k) => a + DM.sq(r.base3[k] - (k === o ? 1 : 0)), 0); }
  dataEvent('prediction_result', { id: r.id, kind: r.kind, subject: r.subject, p: r.p, hit: (r.p >= 0.5) === r.resolved, happened: r.resolved, note: r.note }); prEmit(r);
  // Verifier: only a broken model fails (a probability out of range or not summing to 1); a missed rare call is not a fault
  if (!VER.c.pred) VER.c.pred = { ok: 0, bad: 0, note: '' }; const fine = PR.bad === 0 && r.p >= 0 && r.p <= 1;
  vRes('pred', fine, fine ? '' : PR.badNote || 'Claim probability out of range'); PR.bad = 0; prVerRow();
}
function predScore() {
  const g = (L) => { const n = L.length, hits = L.filter((r) => (r.p >= 0.5) === r.resolved).length, br = n ? L.reduce((a, r) => a + DM.sq(r.p - (r.resolved ? 1 : 0)), 0) / n : null; const B = L.filter((r) => r.base != null);
    return { n, hits, hitRate: n ? hits / n : null, brier: br, meanP: n ? L.reduce((a, r) => a + r.p, 0) / n : null, freq: n ? L.filter((r) => r.resolved).length / n : null, brierBase: B.length ? B.reduce((a, r) => a + DM.sq(r.base - (r.resolved ? 1 : 0)), 0) / B.length : null }; };
  const done = PR.log.filter((r) => r.resolved !== null), byKind = {};
  for (const r of done) (byKind[r.kind] = byKind[r.kind] || []).push(r);
  for (const k in byKind) { const L = byKind[k]; byKind[k] = g(L); const M = L.filter((r) => r.brier3 != null); if (M.length) { byKind[k].brier3 = M.reduce((a, r) => a + r.brier3, 0) / M.length; byKind[k].brier3Base = M.reduce((a, r) => a + r.brier3b, 0) / M.length; } }
  return { overall: g(done), byKind, pending: PR.pend.length };
}
// the Verifier row's description doubles as the live calibration report (honest numbers, never a pass/fail on hit rate)
function prVerRow() { const row = VCHK.find((x) => x[0] === 'pred'); if (!row) return; const s = predScore(), o = s.overall, ng = s.byKind.next_goal;
  row[3] = o.n ? 'Probabilities valid (0..1, sum to 1). ' + o.hits + '/' + o.n + ' calls right (' + prP(o.hitRate) + '), Brier ' + o.brier.toFixed(3) + (o.brierBase != null ? ' vs ' + o.brierBase.toFixed(3) + ' no-information baseline' : '') + (ng ? '; next goal ' + ng.n + ' calls, Brier ' + ng.brier.toFixed(3) + ' vs ' + ng.brierBase.toFixed(3) : '') + '. Fails only if the model breaks.' : 'Every forecast is a probability in 0..1 and each set sums to 1; claims are resolved at their horizon and scored (hit rate, Brier). Fails only if the model breaks, never for a missed rare call.'; }
VCHK.push(['pred', 'Prediction calibration', 'Predict', 'Every forecast is a probability in 0..1 and each set sums to 1; claims are resolved at their horizon and scored (hit rate, Brier). Fails only if the model breaks, never for a missed rare call.']);
// ---- the claim schedule: run on the 0.5 s model tick ----
function prSchedule(X) {
  const { o, R, H, D, cards, fat, keys, tac } = X, left = prLeft(); if (!S.started || S.over || left < 1 || S.celebrate > 0) return;
  const base = prBase(), sb = prShotBase();
  if (PR.pm >= PR.nextNG) { PR.nextNG += 5; const ng = o.nextGoal, any = 1 - ng.none, b = prNext([base, base], H), fav = ng.home >= ng.away ? 0 : 1;
    prClaim('next_goal', 'goal in ' + Math.round(H) + '\'', 'A goal in the next ' + Math.round(H) + '\' (' + TEAMS[0].key + ' ' + prP(ng.home) + ' · ' + TEAMS[1].key + ' ' + prP(ng.away) + '), likeliest ' + prT(fav), any, H, { probs: { home: ng.home, away: ng.away, none: ng.none }, base: 1 - b.none, base3: b, why: ng.why[0] || '' });
    PR.feat.push({ pm: PR.pm, H, left, res: Object.assign({}, o.result), lam: R.lam.slice(), f: R.f.map((f) => Object.assign({}, f)), rc: R.rec.map((f) => Object.assign({}, f)), sc: S.score.slice(), base, rec: PR.log[PR.log.length - 1] }); }
  if (PR.pm >= PR.nextDZ) { PR.nextDZ += 10; const rate = PRK.ft90 * DM.pow((SET.half || 3) / 3, PRK.fte) / 90; const n = PR.att.filter((a) => a.ti === D.ti && a.ft).length; const r = (n + rate * 15) / (PR.pm + 15); const pAny = 1 - DM.exp(-r * H * PRK.dzAny);
    prClaim('danger', prT(D.ti) + ' ' + D.zone, prT(D.ti) + '\'s next attack into the final third comes down the ' + D.zone + ' within ' + Math.round(H) + '\'', D.p * pAny, H, { ti: D.ti, zone: D.zone, base: pAny / 3, why: D.why }); }
  if (PR.pm >= PR.nextCD) { PR.nextCD += 10; const c = cards[0]; if (c && c.p >= PRK.cardMin) { const avg = cards.reduce((a, x) => a + x.p, 0) / cards.length; prClaim('card', c.name, c.name + ' is booked within ' + Math.round(H) + '\'', c.p, H, { player: c.name, ti: c.ti, base: avg, why: c.why }); } }
  if (PR.pm >= PR.nextSB) { PR.nextSB += 10; const f = fat.find((x) => x.stamina > 0.35); if (f) { prClaim('sub', f.name, f.name + ' hits the substitution threshold (35% stamina) within ' + Math.round(H) + '\'', f.subSoon, H, { player: f.name, ti: f.ti, base: fat.filter((x) => x.stamina > 0.35).reduce((a, x, i, L) => a + x.subSoon / L.length, 0), why: f.why }); } }
  if (PR.pm >= PR.nextKP) { PR.nextKP += 15; const k = keys.find((x) => x.role === 'threat'); if (k) { const p = k.p, T = prLive(p.ti); const w = (q) => (roleCat(q.pos) === 3 ? 1 : roleCat(q.pos) === 2 ? 0.45 : 0.12) * (0.5 + q.shotS) * (1 + q.pr.sh); const sh = w(p) / T.reduce((a, q) => a + w(q), 0); const sr = sb * Math.sqrt(prCl(R.lam[p.ti] / base, 0.4, 2.5)); const pp = 1 - DM.exp(-PRK.kpC * sr * sh * H);
    prClaim('key_player', p.name, p.name + ' has a shot within ' + Math.round(H) + '\'', pp, H, { player: p.name, ti: p.ti, base: 1 - DM.exp(-sb * 0.2 * H), why: k.why }); } }
  for (const t of tac) { if (!t.rule || t.p < 0.25) continue; const key = t.ti + t.rule; if (PR.tacDone[key] && PR.pm < PR.tacDone[key]) continue; PR.tacDone[key] = PR.pm + H; prClaim('tactical', prT(t.ti) + ': ' + t.rule, t.text + ' within ' + Math.round(H) + '\'', t.p, H, { ti: t.ti, rule: t.rule, why: t.why }); }
}
// resolve claims whose horizon has run out (false) or whose subject is state-checked (sub threshold)
function prSweep(final) {
  for (const r of PR.pend.slice()) {
    if (r.kind === 'sub') { const p = players.find((q) => q.name === r.player && q.ti === r.ti); if (p && p.stamina < 0.35) { prResolve(r, true, 'stamina ' + prP(p.stamina)); continue; } if (p && p.off) { prResolve(r, false, 'sent off'); continue; } }
    if (final || PR.pm >= r.pmEnd) prResolve(r, false, final ? 'full time' : 'horizon passed');
  }
}
// ---- event intake ----
onMatchEvent((ev) => {
  if (ev.type === 'kickoff' && ev.half === 1) { prReset(); return; }
  if (!players[0] || !players[0].pr || ev.type === 'prediction' || ev.type === 'prediction_result') return;
  const ti = ev.team ? exTeam(ev.team) : -1, p = ev.player ? exPl(ev.player, ti) : null;
  if (ev.type === 'shot') { const oy = prOwnY(ti, ev.y), s = { pm: PR.pm, ti, xg: ev.xg || 0, zone: prZone(oy), p }; PR.shots.push(s); if (PR.shots.length > 300) PR.shots.shift(); if (p) { p.pr.sh++; p.pr.xg += ev.xg || 0; }
    const lp = S.passInfo; if (lp && lp.to === p && S.t - lp.t < 6 && lp.from && lp.from.pr) lp.from.pr.kp++;
    const ft = PR.ft[ti]; PR.att.push({ pm: PR.pm, ti, zone: ft && S.t - ft.t < 10 ? ft.zone : prZone(oy), shot: true });
    for (const r of PR.pend) if (r.kind === 'key_player' && r.player === ev.player && r.ti === ti) prResolve(r, true, 'shot ' + (ev.xg || 0).toFixed(2) + ' xG');
    return; }
  if (ev.type === 'goal') { if (p && !ev.ownGoal) { p.pr.g++; if (p.pr.g === 2) p.pr.g2pm = PR.pm; } PR.goals.push({ pm: PR.pm, ti }); for (const r of PR.pend.slice()) if (r.kind === 'next_goal') { r.outcome = ti === 0 ? 'home' : 'away'; prResolve(r, true, ev.team + ' scored'); } PR.snap = null; return; }
  if (ev.type === 'foul') { if (p) p.pr.fo++; return; }
  if (ev.type === 'slide_tackle') { if (p) p.pr.sl++; return; }
  if (ev.type === 'turnover') { if (p) p.pr.tk++; return; }
  if (ev.type === 'yellow_card' || ev.type === 'red_card') { if (p) p.pr.y++; for (const r of PR.pend.slice()) if (r.kind === 'card' && r.player === ev.player && r.ti === ti) prResolve(r, true, ev.type.replace('_', ' ')); PR.snap = null; return; }
  if (ev.type === 'tactical_change') { PR.tac.push({ ti, t: S.t, why: ev.why }); for (const r of PR.pend.slice()) if (r.kind === 'tactical' && r.ti === ti && r.rule === ev.why) prResolve(r, true, ev.why); PR.snap = null; return; }
  if (ev.type === 'full_time') { prSweep(true); return; }
});
// an attack into the box (shot or box entry) resolves danger-zone claims for that side
function prAttack(ti, zone) { for (const r of PR.pend.slice()) if (r.kind === 'danger' && r.ti === ti) prResolve(r, r.zone === zone, 'came down the ' + zone); }
// ---- per-step tracking (allocation-free): match minutes of play, final-third and box entries by zone; 0.5 s model tick ----
function prStep(dt) {
  if (!S.started || S.over || S.hold || !players[0] || !players[0].pr) return;
  PR.pm += dt * (S.mscale || 1) / 60; const o = S.owner;
  if (o && !S.restart) { const ti = o.ti, ox = prOwnX(ti, o.pos2.x), oy = prOwnY(ti, o.pos2.y);
    const inFT = ox >= 70; if (inFT && !PR.ftIn[ti]) { const f = PR.ft[ti] || (PR.ft[ti] = { t: -99, zone: 'centre' }); if (S.t - f.t > 4) { PR.att.push({ pm: PR.pm, ti, zone: prZone(oy), ft: true }); if (PR.att.length > 400) PR.att.shift(); prAttack(ti, prZone(oy)); } f.t = S.t; f.zone = prZone(oy); } PR.ftIn[ti] = inFT; PR.ftIn[1 - ti] = false;
    const box = ox > 88.5 && Math.abs(oy - 34) < 20.16 ? ti : -1;
    if (box >= 0 && PR.boxTi !== box && S.t - PR.boxT[box] > 3) { PR.boxT[box] = S.t; const ft = PR.ft[box], z = ft && S.t - ft.t < 10 ? ft.zone : prZone(oy); PR.att.push({ pm: PR.pm, ti: box, zone: z, box: true }); if (PR.att.length > 400) PR.att.shift(); }
    PR.boxTi = box; }
  const mn = Math.floor(S.mclock / 60); if (mn !== PR.lastMin) { PR.lastMin = mn; for (const p of players) { if (p.off) continue; let h = PR.stH.get(p); if (!h) PR.stH.set(p, (h = [])); h.push(p.stamina); if (h.length > 6) h.shift(); } }
  if (!PR.snap || S.t - PR.snap.o.simT >= 0.5) { predNow(); if (!PR.prior && PR.pm > 0.2) { PR.prior = prResult(prRates({}), 95); } prSweep(false); if (PR.snap) prSchedule(PR.snap); }
}
{ const _stepP = stepSim; stepSim = function (dt) { _stepP(dt); prStep(dt); }; window.__mc.stepSim = stepSim; }
// ---- what-if: a model-only counterfactual for one side (never touches the engine) ----
function predWhatIf(q) {
  q = q || {}; const ti = q.ti === 1 ? 1 : 0, j = 1 - ti, v = q.value, T = prT(ti), O = prT(j), left = prLeft(), H = Math.min(10, left);
  const R0 = prRates(), mul = [1, 1], stam = new Map(), rt = [0, 0], why = []; let text = '';
  const amt = typeof v === 'number' ? prCl(v, -1, 1.5) : 1;
  if (q.change === 'press') { mul[ti] *= 1 + 0.18 * amt; mul[j] *= 1 + 0.1 * amt; for (const p of prLive(ti)) if (!p.gk) stam.set(p, prCl(p.stamina - 0.08 * amt, 0.12, 1));
    const up = amt >= 0; text = T + (up ? ' press higher' : ' drop off and press less');
    why.push((up ? 'more' : 'fewer') + ' high turnovers: ' + T + '\'s rate ×' + (1 + 0.18 * amt).toFixed(2), (up ? 'more' : 'less') + ' space behind the line: ' + O + ' ×' + (1 + 0.1 * amt).toFixed(2), (up ? 'pressing costs' : 'sitting off saves') + ' about ' + Math.abs(Math.round(8 * amt)) + ' stamina points over 10\', which the fatigue term ' + (up ? 'turns against ' : 'credits to ') + T); }
  else if (q.change === 'tempo') { mul[ti] *= 1 + 0.12 * amt; mul[j] *= 1 + 0.06 * amt; text = T + (amt >= 0 ? ' up the tempo' : ' slow the game down'); why.push((amt >= 0 ? 'quicker, more vertical play: ' : 'slower, safer circulation: ') + T + ' ×' + (1 + 0.12 * amt).toFixed(2), (amt >= 0 ? 'a more open game for both: ' : 'a quieter game for both: ') + O + ' ×' + (1 + 0.06 * amt).toFixed(2)); }
  else if (q.change === 'defend_deep') { const d = prCl(amt, 0, 1.5); mul[ti] *= 1 - 0.22 * d; mul[j] *= 1 - 0.18 * d; text = T + ' sit deep'; why.push('fewer bodies forward: ' + T + ' ×' + mul[ti].toFixed(2), 'no space in behind for ' + O + ': ×' + mul[j].toFixed(2) + ' (more territory, worse chances)'); }
  else if (q.change === 'formation') { const f = FORMATIONS[v] ? v : '3-4-3', cur = FORMATIONS[TEAMS[ti].tac.form] || FORMATIONS['4-3-3'];
    const cnt = (F, c) => F.reduce((a, s) => a + (roleCat(s[0]) === c ? 1 : s[0] === 'AM' && c === 3 ? 0.5 : 0), 0); const da = cnt(FORMATIONS[f], 3) - cnt(cur, 3), dd = cnt(FORMATIONS[f], 1) - cnt(cur, 1);
    mul[ti] *= DM.exp(0.12 * da); mul[j] *= DM.exp(-0.1 * dd); text = T + ' switch to ' + f; why.push((da >= 0 ? '+' : '') + da + ' forward' + (Math.abs(da) === 1 ? '' : 's') + ': ' + T + ' ×' + DM.exp(0.12 * da).toFixed(2), (dd >= 0 ? '+' : '') + dd + ' defender' + (Math.abs(dd) === 1 ? '' : 's') + ': ' + O + ' ×' + DM.exp(-0.1 * dd).toFixed(2)); }
  else if (q.change === 'sub') { const L = prLive(ti).filter((p) => !p.gk); const nm = typeof v === 'string' ? v : v && v.out; const out = (nm && L.find((p) => p.name === nm)) || L.slice().sort((a, b) => a.stamina - b.stamina)[0];
    if (out) { stam.set(out, 1); const dr = v && v.rating ? (v.rating - out.rating) / Math.max(1, L.length + 1) : 0; rt[ti] = dr; text = T + ' bring on fresh legs for ' + prS(out); why.push(prS(out) + ' (' + prP(out.stamina) + ' stamina) replaced at 100%', dr ? 'team rating ' + (dr > 0 ? '+' : '') + dr.toFixed(2) : 'like-for-like rating'); } }
  else text = 'No change';
  const R1 = prRates({ mul, stam, rt }); const b = { result: prResult(R0, left), nextGoal: prNext(R0.lam, H) }, a = { result: prResult(R1, left), nextGoal: prNext(R1.lam, H) };
  b.nextGoal.horizonMin = a.nextGoal.horizonMin = 10; const k = ti === 0 ? 'home' : 'away', ko = ti === 0 ? 'away' : 'home';
  const p1 = (x) => (x * 100).toFixed(1) + '%'; text += ': next goal ' + TEAMS[ti].key + ' ' + p1(b.nextGoal[k]) + ' → ' + p1(a.nextGoal[k]) + ', ' + TEAMS[j].key + ' ' + p1(b.nextGoal[ko]) + ' → ' + p1(a.nextGoal[ko]) + '; ' + T + ' win ' + p1(b.result[k]) + ' → ' + p1(a.result[k]);
  return { before: b, after: a, text, why: why.join('; ') };
}
window.__mc.pred = { now: predNow, log: predLog, score: predScore, whatIf: predWhatIf, onPrediction, _dbg: () => ({ PRK, pm: PR.pm, feat: PR.feat.map((f) => ({ pm: f.pm, H: f.H, left: f.left, res: f.res, lam: f.lam, f: f.f, rc: f.rc, sc: f.sc, base: f.base, out: f.rec.resolved ? f.rec.outcome : 'none', p: f.rec.p })), att: PR.att.map((a) => [+a.pm.toFixed(1), a.ti, a.zone, a.box ? 1 : 0]), shots: PR.shots.map((a) => [+a.pm.toFixed(1), a.ti, a.xg]), goals: PR.goals.map((g) => [+g.pm.toFixed(1), g.ti]) }) };
