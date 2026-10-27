// ============ EXPLAIN: interpret → explain → render (v9) ============
// Stage (b) turns raw sim state into metrics (pass difficulty, ball/shot speed, per-player distance and top speed).
// Stage (c) runs deterministic rules over rolling windows (control vs chaos, momentum, rhythm) and a key-moment detector
// that writes a "why it matters" line from a template; Claude (SAMPLE) may only polish the wording, never the facts.
// Stage (d) shows a compact Match Pulse widget, lower-third moment cards and name-tag chips, and writes every graphic
// it shows as a timed, machine-readable overlay record so a broadcast renderer can sync the same graphics to video.
//
// TIME BASES. The sim plays at real speed but the match clock runs S.mscale times faster (a 3-minute half is 45 match
// minutes, mscale 15). Rates that describe how football is played (passes per minute, turnovers per minute, spell length)
// are therefore measured per minute OF PLAY in sim seconds, which is what the viewer actually watches. Totals that a
// broadcast quotes against the match clock (distance covered) are scaled by mscale: each sim second a player runs stands
// for mscale seconds of match time, so the raw total is Σ |v|·dt·mscale (distanceRawKm). The sim keeps the ball in play
// ~88% of the time where real matches manage ~58% (about 55 of 95 minutes), so the raw total over-weights live play.
// The figure we show (distanceKm) re-weights the player's own average speed in play and out of play to the real split:
//   distanceKm = (dLive/tLive · 0.58 + dDead/tDead · 0.42) · match seconds elapsed
// It is a time re-weighting, not a fudge factor. Overlay records carry t (sim/video seconds) and matchClock (mm:ss).
const EX = { tl: 0, td: 0, W: 60, Wm: 90, ev: [], bs: [], spells: [], cur: null, ft: { ti: -1, ox: 0 }, ctl: 60, ctlRaw: 60, ctlHist: [], mom: 0, momHist: [], spark: [], lastMin: -1, tempo: 0, breaks: 0, terr: [0.5, 0.5], ppda: [null, null], ent: [0, 0], parts: {},
  moments: [], subs: [], q: [], card: null, cardGap: 0, ov: [], ovN: 0, bsT: 0, pulseT: 0, swing: { ext: 0, t: 0, last: -99 }, wave: [-99, -99], tac: [], topKmh: 0, topRecs: 0, km10: false, pend: [], last: null, lastPass: null, passLog: [], uiT: 0, open: null, busy: false };
const exTeam = (k) => (TEAMS[0].key === k ? 0 : 1);
const exPl = (name, ti) => players.find((p) => p.name === name && (ti == null || p.ti === ti));
const exClock = () => { const m = Math.floor(S.mclock / 60), s = Math.floor(S.mclock % 60); return m + ':' + (s < 10 ? '0' : '') + s; };
const exAnchor = (p) => 'player:' + p.T.key + '-' + p.num;
const exMin = () => Math.floor(S.mclock / 60) + 1;
// ---- pass difficulty, 0-100: six additive terms, each capped, summing to at most 100 ----
//   distance  30 · clamp((d-2)/48)            a 50 m ball is the hardest to weight
//   pressure  18 · clamp((5-press)/4)         nearest opponent to the passer inside 5 m, full at 1 m
//   lane      22 · clamp((4-laneSafety)/6)    laneSafety (main.js) is the margin in "beats" between ball and best interceptor
//   marking   15 · clamp((5-mark)/4)          nearest opponent to the receiver's landing point
//   flight     7 if lofted (+5 for a through ball or cross: they must beat a line)  capped with the rest
//   weak foot  8 if struck with the weaker foot
function passDifficulty(p, q, tgt, plan, press, weak) {
  let mark = 99; for (const o of teamOf(1 - p.ti)) if (!o.off) mark = Math.min(mark, o.pos2.distanceTo(tgt));
  const safe = laneSafety(p.pos2, tgt, p.ti);
  const P = { distance: 30 * clamp((plan.d - 2) / 48, 0, 1), pressure: 18 * clamp((5 - press) / 4, 0, 1), lane: 22 * clamp((4 - safe) / 6, 0, 1), marking: 15 * clamp((5 - mark) / 4, 0, 1), flight: (plan.lofted ? 7 : 0) + (plan.through || plan.cross ? 5 : 0), weakFoot: weak > 1 ? 8 : 0 };
  for (const k in P) P[k] = Math.round(P[k]); EX.parts = P;
  return clamp(Object.values(P).reduce((a, b) => a + b, 0), 0, 100);
}
// ---- overlay track: every graphic shown is also one timed record ----
function exOverlay(type, anchor, durationS, payload, explanation) {
  const r = { id: 'ov' + (++EX.ovN), t: +S.t.toFixed(2), matchClock: exClock(), durationS: +durationS.toFixed(2), type, anchor, payload, explanation: explanation || '' };
  EX.ov.push(r); if (EX.ov.length > 20000) EX.ov.shift(); return r;
}
function exReset() {
  Object.assign(EX, { tl: 0, td: 0, ev: [], bs: [], spells: [], cur: null, ft: { ti: -1, ox: 0 }, ctl: 60, ctlRaw: 60, ctlHist: [], mom: 0, momHist: [], spark: [], lastMin: -1, tempo: 0, breaks: 0, terr: [0.5, 0.5], ppda: [null, null], ent: [0, 0], moments: [], q: [], card: null, cardGap: 0, ov: [], ovN: 0, bsT: 0, pulseT: 0, swing: { ext: 0, t: 0, last: -99 }, wave: [-99, -99], tac: [], topKmh: 0, topRecs: 0, km10: false, pend: [], last: null, lastPass: null, passLog: [] });
  EX.t0 = S.t;
  for (const p of players) { p.xs = { d: 0, dl: 0, dd: 0, dm: 0, spd: 0, top: 0, sprints: 0, spr: false, passes: 0, comp: 0, diffSum: 0, km: 0, chipT: -99, cd: -99, chip: null }; exChip(p, null); }
  if ($('px-feed')) $('px-feed').innerHTML = ''; exCardHide();
}
// ---- name-tag chips (speed, distance) ----
function exChip(p, html) {
  let c = p.el.querySelector('.xc');
  if (!html) { if (c) c.remove(); if (p.xs) p.xs.chip = null; return; }
  if (!c) { c = document.createElement('span'); c.className = 'xc'; p.el.insertBefore(c, p.el.children[1] || null); }
  c.innerHTML = html;
}
function exTag(p, kind, text, why, payload) {
  const dur = 3; p.xs.chipT = S.t + dur; exChip(p, text); p.xs.chip = kind;
  exOverlay(kind, exAnchor(p), dur, Object.assign({ player: p.name, team: p.T.key, num: p.num, text: text.replace(/<[^>]+>/g, ''), pitchXY: [+p.pos2.x.toFixed(1), +p.pos2.y.toFixed(1)] }, payload), why);
}
// ---- per-step accounting: runs inside stepSim so headless runs measure exactly what the viewer sees ----
function exStep(dt) {
  if (!S.started || S.over || S.hold || !players[0] || !players[0].xs) return;
  const ms = S.mscale || 1, stop = !!(S.dead || S.restart); if (stop) EX.td += dt; else EX.tl += dt;
  for (const p of players) {
    if (p.off) continue; const x = p.xs; const v = p.vel.length();
    x.d += v * dt; x.dm += v * dt * ms; if (stop) x.dd += v * dt; else x.dl += v * dt; // sim metres, raw match-scaled, live/dead split
    x.spd += (v - x.spd) * clamp(dt / 0.3, 0, 1); // 0.3 s smoothing, like a tracking system's speed filter
    const kmh = x.spd * 3.6; if (kmh > x.top) x.top = kmh;
    if (!x.spr && kmh > 25.2) { x.spr = true; x.sprints++; } else if (x.spr && kmh < 21) x.spr = false; // sprint effort: >25.2 km/h, re-armed under 21
    // speed tag: 30 km/h threshold, 25 s cooldown per player so a long run gets one chip
    if (kmh > 30 && S.t > x.cd) { x.cd = S.t + 25; exTag(p, 'speed_tag', '⚡ ' + kmh.toFixed(1) + ' km/h', 'Smoothed speed crossed the 30 km/h sprint threshold' + (kmh >= EX.topKmh ? '; fastest in the match so far' : ''), { kmh: +kmh.toFixed(1) });
      if (kmh > 33 && kmh > EX.topKmh + 0.4 && EX.topRecs < 2 && !p.gk) { EX.topRecs++; exMoment('milestone', p.ti, '⚡', 'Top speed: ' + surname(p.name) + ' ' + kmh.toFixed(1) + ' km/h', surname(p.name) + ' hits ' + kmh.toFixed(1) + ' km/h, the fastest sprint of the match. Raw pace like this is how ' + p.T.club + ' stretch a back line.', { player: p.name, kmh: +kmh.toFixed(1) }, 1); } }
    if (kmh > EX.topKmh) EX.topKmh = kmh;
    // distance milestones in match-time km: halfway marker then every km from 9
    const dk = exKm(x), km = Math.floor(dk); if (km > x.km) { x.km = km; if ((km === 5 || km === 10 || km === 12) && !p.gk) { exTag(p, 'distance_tag', '📏 ' + dk.toFixed(1) + ' km', 'Distance milestone: ' + km + ' km of match time (ball-in-play re-weighted, see schema)', { km: +dk.toFixed(2) });
      if (km === 10 && !EX.km10) { EX.km10 = true; exMoment('milestone', p.ti, '📏', surname(p.name) + ' passes 10 km', surname(p.name) + ' (' + p.T.key + ') is the first player past 10 km, at ' + exMin() + '\', with ' + x.sprints + ' sprints and a top speed of ' + x.top.toFixed(1) + ' km/h: the engine behind ' + p.T.club + '\'s ' + (p.T.tac.cur.press > 0.6 ? 'press' : 'shape') + '.', { player: p.name, km: 10 }, 1); } } }
    if (x.chip && S.t > x.chipT) exChip(p, null);
  }
  // possession spells and final-third entries
  if (!EX.cur || EX.cur.ti !== S.poss) { if (EX.cur) EX.spells.push({ ti: EX.cur.ti, t0: EX.cur.t0, t1: S.t }); EX.cur = { ti: S.poss, t0: S.t }; EX.ft = { ti: S.poss, ox: S.owner ? w2own(S.poss, S.owner.pos2).x : 0 }; }
  if (S.owner && S.owner.ti === EX.ft.ti) { const ox = w2own(S.owner.ti, S.owner.pos2).x; if (EX.ft.ox < 70 && ox >= 70) exPush({ type: 'entry', ti: S.owner.ti }); EX.ft.ox = ox; }
  // pass accuracy: a pass is resolved as completed when the engine marks it done, failed when the other side has it or 6 s pass
  for (const r of EX.pend) { if (r.res != null) continue; if (r.pi.done) r.res = 1; else if (S.t - r.t > 6 || (S.poss !== r.ti && S.owner)) r.res = 0; else continue;
    const x = r.p.xs; if (r.res) x.comp++; if (r.ov) r.ov.payload.completed = !!r.res; }
  EX.pend = EX.pend.filter((r) => r.res == null);
  // ball samples every 0.25 s: speed, heading, which half, whether play is stopped
  EX.bsT += dt; if (EX.bsT >= 0.25) { EX.bsT = 0; const sp = DM.hypot(ball.v.x, ball.v.z); EX.bs.push({ t: S.t, sp, hd: DM.atan2(ball.v.z, ball.v.x), x: ball.p.x, stop: !!(S.dead || S.restart) }); }
  const cut = S.t - 130; while (EX.bs.length && EX.bs[0].t < cut) EX.bs.shift(); while (EX.ev.length && EX.ev[0].t < cut) EX.ev.shift(); while (EX.spells.length && EX.spells[0].t1 < cut) EX.spells.shift();
  EX.pulseT += dt; if (EX.pulseT >= 1) { EX.pulseT = 0; exPulse(); exDetect(); }
  exCards();
}
// match-equivalent distance in km (see TIME BASES): falls back to the raw scaled figure until both phases have been seen
const exKm = (x) => (EX.tl > 5 && EX.td > 5 ? (x.dl / EX.tl * 0.58 + x.dd / EX.td * 0.42) * S.mclock : x.dm) / 1000;
const exPush = (r) => { r.t = S.t; r.mc = S.mclock; EX.ev.push(r); return r; };
// ---- the explainability engine: rolling rules over the last minute (control, rhythm) and 90 s (momentum) of play ----
function exPulse() {
  const now = S.t, W = Math.min(EX.W, Math.max(10, now - EX.t0)), Wm = Math.min(EX.Wm, Math.max(10, now - EX.t0));
  const inW = (r) => r.t >= now - W; const E = EX.ev.filter(inW);
  // control vs chaos (0 chaos ... 100 control)
  const sp = EX.spells.filter((s) => s.t1 >= now - W).map((s) => s.t1 - Math.max(s.t0, now - W)); if (EX.cur) sp.push(now - Math.max(EX.cur.t0, now - W));
  const spell = sp.length ? sp.reduce((a, b) => a + b, 0) / sp.length : W;
  const turns = E.filter((r) => r.type === 'turnover').length, tpm = turns / (W / 60);
  const pr = E.filter((r) => r.type === 'pass' && r.res != null), comp = pr.length ? pr.filter((r) => r.res).length / pr.length : 0.8;
  const B = EX.bs.filter((b) => b.t >= now - W && !b.stop && b.sp > 1); let sd = 0, turn = 0;
  if (B.length > 4) { const m = B.reduce((a, b) => a + b.sp, 0) / B.length; sd = Math.sqrt(B.reduce((a, b) => a + DM.sq(b.sp - m), 0) / B.length); for (let i = 1; i < B.length; i++) { let d = Math.abs(B[i].hd - B[i - 1].hd); if (d > Math.PI) d = 2 * Math.PI - d; turn += d; } turn = turn / (B.length * 0.25); }
  const c = { spell: clamp((spell - 4) / 16, 0, 1), turnovers: 1 - clamp((tpm - 1) / 5, 0, 1), completion: clamp((comp - 0.6) / 0.32, 0, 1), ball: 1 - 0.5 * clamp(sd / 8, 0, 1) - 0.5 * clamp(turn / 1.2, 0, 1) };
  EX.ctlRaw = 100 * (0.3 * c.spell + 0.25 * c.turnovers + 0.25 * c.completion + 0.2 * c.ball);
  EX.ctl += (EX.ctlRaw - EX.ctl) * 0.2; EX.ctlC = { spell: +spell.toFixed(1), turnoversPerMin: +tpm.toFixed(1), completion: Math.round(comp * 100), ballSpeedSd: +sd.toFixed(1), turnRate: +turn.toFixed(2) };
  EX.ctlHist.push({ t: now, v: EX.ctl, mc: S.mclock }); if (EX.ctlHist.length > 200) EX.ctlHist.shift();
  // momentum: territory, final-third entries, threat (xG + shots + corners) and pressing (defensive actions, PPDA-style)
  const Em = EX.ev.filter((r) => r.t >= now - Wm); const Bm = EX.bs.filter((b) => b.t >= now - Wm && !b.stop);
  const terr = [0, 1].map((ti) => Bm.length ? Bm.filter((b) => (goalOf(ti).x > 52.5 ? b.x > 52.5 : b.x < 52.5)).length / Bm.length : 0.5);
  const ent = [0, 1].map((ti) => Em.filter((r) => r.type === 'entry' && r.ti === ti).length);
  const thr = [0, 1].map((ti) => Em.filter((r) => r.ti === ti).reduce((a, r) => a + (r.type === 'shot' ? r.xg + 0.04 : r.type === 'corner' ? 0.03 : 0), 0));
  const def = [0, 1].map((ti) => Em.filter((r) => r.ti === ti && r.def).length); const oppP = [0, 1].map((ti) => Em.filter((r) => r.type === 'pass' && r.ti !== ti && r.deep).length);
  EX.ppda = [0, 1].map((ti) => def[ti] ? +(oppP[ti] / def[ti]).toFixed(1) : null);
  const sh = (a, i, k) => (a[i] + k) / (a[0] + a[1] + 2 * k); // shares with a prior (k) so one entry or one shot does not read as total dominance
  const mi = [0, 1].map((i) => 0.3 * terr[i] + 0.25 * sh(ent, i, 1.5) + 0.3 * sh(thr, i, 0.08) + 0.15 * sh(def, i, 1.5));
  EX.momRaw = (mi[0] - mi[1]) * 140; EX.mom += (clamp(EX.momRaw, -100, 100) - EX.mom) * 0.25;
  EX.terr = terr; EX.ent = ent; EX.momC = { territory: terr.map((v) => Math.round(v * 100)), entries: ent, threat: thr.map((v) => +v.toFixed(2)), defActions: def };
  EX.momHist.push({ t: now, v: EX.mom, mc: S.mclock }); if (EX.momHist.length > 200) EX.momHist.shift();
  // rhythm: tempo (passes per minute of play) and the share of time the ball is dead
  EX.tempo = E.filter((r) => r.type === 'pass').length / (W / 60); const Bw = EX.bs.filter((b) => b.t >= now - W); EX.breaks = Bw.length ? Bw.filter((b) => b.stop).length / Bw.length : 0;
  // one pulse record and one sparkline point per match minute
  const mn = Math.floor(S.mclock / 60); if (mn !== EX.lastMin) { EX.lastMin = mn; EX.spark.push(Math.round(EX.mom)); const P = exPulseObj(); exOverlay('pulse', 'pulse_widget', 60 / (S.mscale || 1), { control: P.control, controlTeam: P.controlTeam, momentum: P.momentum, tempo: P.tempo, breaksPct: P.breaksPct, rhythm: P.rhythm, ballKmh: P.ballKmh }, P.why); }
}
function exRhythm() { return EX.breaks > 0.4 ? 'Stop-start' : EX.tempo >= 15 ? 'High tempo' : EX.tempo < 8 ? 'Slow build-up' : 'Steady'; }
function exPulseObj() {
  const ctl = Math.round(EX.ctl), m = Math.round(EX.mom); const sp = EX.spells.filter((s) => s.t1 > S.t - EX.W); const hold = [0, 0]; for (const s of sp) hold[s.ti] += s.t1 - Math.max(s.t0, S.t - EX.W); if (EX.cur) hold[EX.cur.ti] += S.t - Math.max(EX.cur.t0, S.t - EX.W);
  const ct = hold[0] + hold[1] > 0 ? (hold[0] >= hold[1] ? 0 : 1) : S.poss;
  const why = ctl >= 60 ? TEAMS[ct].club + ' are dictating: ' + (EX.ctlC ? EX.ctlC.completion + '% passing, spells of ' + Math.round(EX.ctlC.spell) + 's' : '') : ctl <= 40 ? 'Chaos: ' + (EX.ctlC ? EX.ctlC.turnoversPerMin + ' turnovers per minute of play, ' + EX.ctlC.completion + '% passing' : '') : 'An even contest for control';
  return { control: ctl, chaos: 100 - ctl, controlTeam: TEAMS[ct].key, controlParts: EX.ctlC || null, momentum: m, momentumTeam: m >= 0 ? TEAMS[0].key : TEAMS[1].key, momentumParts: EX.momC || null, momentumSeries: EX.spark.slice(), tempo: +EX.tempo.toFixed(1), breaksPct: Math.round(EX.breaks * 100), rhythm: exRhythm(), ppda: EX.ppda.slice(), ballKmh: Math.round(DM.hypot(ball.v.x, ball.v.y, ball.v.z) * 3.6), why };
}
const exCtlAgo = (sec) => { const h = EX.ctlHist; for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= S.t - sec) return h[i].v; return h.length ? h[0].v : EX.ctl; };
// ---- event intake: every dataEvent becomes a windowed record; some trigger moments directly ----
onMatchEvent((ev) => {
  if (ev.type === 'kickoff' && ev.half === 1) { exReset(); $('pulse').hidden = false; return; }
  if (!players[0] || !players[0].xs) return;
  const ti = ev.team ? exTeam(ev.team) : -1;
  if (ev.type === 'pass') { const p = exPl(ev.player, ti); const ox = p ? w2own(ti, p.pos2).x : 50; const r = exPush({ type: 'pass', ti, deep: ox < 63, p, pi: S.passInfo, res: null });
    if (p) { p.xs.passes++; p.xs.diffSum += ev.difficulty || 0; } EX.lastPass = { from: ev.player, to: ev.to, kind: ev.kind, distM: ev.distM, difficulty: ev.difficulty, quality: ev.quality, parts: Object.assign({}, EX.parts), t: S.t, r };
    const P = EX.parts; r.ov = exOverlay('pass_graphic', 'lower_third', 2.5, { from: ev.player, to: ev.to, team: ev.team, kind: ev.kind, distM: ev.distM, difficulty: ev.difficulty ?? null, quality: ev.quality, completed: null, fromXY: p ? [+p.pos2.x.toFixed(1), +p.pos2.y.toFixed(1)] : null }, ev.difficulty != null ? 'Difficulty ' + ev.difficulty + ' = distance ' + P.distance + ' + pressure ' + P.pressure + ' + lane ' + P.lane + ' + marking ' + P.marking + ' + flight ' + P.flight + ' + weak foot ' + P.weakFoot : '');
    if (p) EX.pend.push(r); r.p = p; return; }
  if (ev.type === 'turnover') { exPush({ type: 'turnover', ti, def: ev.ownX > 42, high: ev.ownX > 55 }); return; }
  if (ev.type === 'slide_tackle' || ev.type === 'foul') { const p = exPl(ev.player, ti); const ox = p ? w2own(ti, p.pos2).x : 50; exPush({ type: ev.type, ti, def: ox > 42 }); }
  if (ev.type === 'corner') exPush({ type: 'corner', ti });
  if (ev.type === 'shot') { exPush({ type: 'shot', ti, xg: ev.xg || 0 }); exOverlay('shot_graphic', 'lower_third', 1.6, { player: ev.player, team: ev.team, kmh: ev.kmh, xg: ev.xg, kind: ev.kind }, 'Shot speed from the strike velocity; xG from distance, angle, pressure and shot type');
    if (ev.xg > 0.25) EX.q.push({ big: true, at: S.t + 2.5, ev, ti, goals: STATS.goals.length }); return; }
  if (ev.type === 'goal') exGoal(ev, ti);
  if (ev.type === 'red_card') { const n = teamOf(ti).filter((p) => !p.off).length; exMoment('red_card', ti, '🟥', 'Red card: ' + ev.player, TEAMS[ti].club + ' are down to ' + n + ' for ' + ev.reason + '. With ' + Math.max(0, 90 - exMin()) + ' minutes left they lose a runner, and the control index (' + Math.round(EX.ctl) + ') should tilt towards ' + TEAMS[1 - ti].club + '.', { player: ev.player, reason: ev.reason, playersLeft: n }, 2); }
  if (ev.type === 'tactical_change') EX.tac.push({ ti, t: S.t, m0: ti === 0 ? EX.mom : -EX.mom, form: ev.formation, min: exMin() });
});
function exGoal(ev, ti) {
  const sc = S.score.slice(), mine = sc[ti], theirs = sc[1 - ti]; const si = S.shotInfo && S.t - S.shotInfo.t < 6 ? S.shotInfo : null; const lp = EX.lastPass && S.t - EX.lastPass.t < 8 && EX.lastPass.r.ti === ti ? EX.lastPass : null;
  const state = ev.ownGoal ? 'An own goal' : mine === theirs ? 'Level again at ' + sc.join('-') : mine === theirs + 1 && mine === 1 ? TEAMS[ti].club + ' break the deadlock' : mine === theirs + 1 ? TEAMS[ti].club + ' lead ' + mine + '-' + theirs : TEAMS[ti].club + ' extend it to ' + mine + '-' + theirs;
  // turning point: a goal that turns a level (not 0-0) game into a lead, or a late equaliser
  const turning = !ev.ownGoal && ((mine === theirs + 1 && theirs > 0) || (mine === theirs && exMin() >= 75));
  const momT = ti === 0 ? EX.mom : -EX.mom; const brace = EX.moments.filter((m) => (m.type === 'goal' || m.type === 'turning_point') && m.data.player === ev.player && !ev.ownGoal).length + 1;
  const bits = []; if (si && si.xg) bits.push('a ' + si.xg.toFixed(2) + ' xG chance at ' + si.kmh + ' km/h' + (si.xg < 0.1 ? ', a low-percentage finish' : ''));
  if (lp && lp.difficulty != null) bits.push('set up by a difficulty-' + lp.difficulty + ' ' + lp.kind + ' from ' + surname(lp.from));
  const ctx = momT < -20 ? ' It came against the run of play (momentum ' + Math.round(momT) + ').' : momT > 25 ? ' It rewards a spell of pressure (momentum +' + Math.round(momT) + ').' : '';
  const why = state + (bits.length ? ': ' + bits.join(', ') + '.' : '.') + ctx + (turning ? ' A turning point in the match.' : '') + (brace === 2 ? ' His second of the game.' : brace === 3 ? ' Hat-trick!' : '');
  exMoment(turning ? 'turning_point' : 'goal', ti, '⚽', 'GOAL · ' + ev.player + (ev.ownGoal ? ' (o.g.)' : ''), why, { player: ev.player, score: sc.join('-'), xg: si ? si.xg : null, shotKmh: si ? si.kmh : null, assistDifficulty: lp ? lp.difficulty : null, momentum: Math.round(momT) }, 3);
}
// ---- periodic detectors: pressing waves, momentum swings, turning points after tactical changes, delayed big chances ----
function exDetect() {
  const now = S.t;
  for (const ti of [0, 1]) { const hi = EX.ev.filter((r) => r.type === 'turnover' && r.ti === ti && r.high && r.t > now - 40); if (hi.length >= 3 && now - EX.wave[ti] > 90) { EX.wave[ti] = now;
    const mins = Math.max(1, Math.ceil((S.mclock - hi[0].mc) / 60)); const c0 = Math.round(exCtlAgo(30)), c1 = Math.round(EX.ctl);
    exMoment('pressing_wave', ti, '⚡', TEAMS[ti].club + '\'s press is biting', TEAMS[ti].club + '\'s ' + ['', '', '', 'third', 'fourth', 'fifth', 'sixth'][Math.min(hi.length, 6)] + ' high turnover in ' + mins + ' minute' + (mins > 1 ? 's' : '') + ': the press is working' + (c1 < c0 - 4 ? ' and the control index fell from ' + c0 + ' to ' + c1 : c1 > c0 + 4 ? ' and the control index rose from ' + c0 + ' to ' + c1 + ' as they pin ' + TEAMS[1 - ti].club + ' in' : ', with ' + TEAMS[1 - ti].club + ' unable to play out') + '.', { regains: hi.length, minutes: mins, controlFrom: c0, controlTo: c1 }, 2); } }
  // control and chaos spells: the index crossing 72 (one side dictating) or 22 (the game has broken up), re-armed in the middle
  const c = EX.ctl, cs = EX.cst = EX.cst || { s: 'mid', t: -99 }; const C = EX.ctlC || {};
  if (c > 45 && c < 60) cs.s = 'mid';
  if (c >= 72 && cs.s !== 'ctl' && now - cs.t > 75 && c - exCtlAgo(30) >= 12) { cs.s = 'ctl'; cs.t = now; const P = exPulseObj(), ti = exTeam(P.controlTeam), c0 = Math.round(exCtlAgo(30));
    exMoment('control_spell', ti, '🎯', TEAMS[ti].club + ' take control', TEAMS[ti].club + ' are dictating: ' + C.completion + '% passing and possession spells of ' + Math.round(C.spell) + ' s. The control index climbed from ' + c0 + ' to ' + Math.round(c) + '.', { control: Math.round(c), from: c0, completion: C.completion, spell: C.spell }, 1); }
  if (c <= 22 && cs.s !== 'chaos') { cs.s = 'chaos'; if (now - cs.t > 75 && now - Math.max(...EX.wave) > 25) { cs.t = now; const c0 = Math.round(exCtlAgo(30));
    exMoment('chaos_spell', -1, '🌀', 'The game has broken up', C.turnoversPerMin + ' turnovers per minute of play and ' + C.completion + '% passing: nobody can keep the ball. The control index fell from ' + c0 + ' to ' + Math.round(c) + '.', { control: Math.round(c), from: c0, turnoversPerMin: C.turnoversPerMin, completion: C.completion }, 1); } }
  // momentum swing: from beyond ±25 one way to beyond ±25 the other within 75 s of play
  const m = EX.mom, sw = EX.swing; if (Math.abs(m) > 25 && Math.sign(m) !== Math.sign(sw.ext) && Math.abs(sw.ext) > 25 && now - sw.t < 75 && now - sw.last > 45) {
    const ti = m > 0 ? 0 : 1, c = EX.momC, drv = [['territory ' + c.territory[ti] + '%', c.territory[ti] / 100 - 0.5], [c.entries[ti] + ' final-third entr' + (c.entries[ti] === 1 ? 'y' : 'ies'), (c.entries[ti] - c.entries[1 - ti]) / 6], ['xG and shots', (c.threat[ti] - c.threat[1 - ti]) * 3], [c.defActions[ti] + ' defensive actions in their attacking 60%', (c.defActions[ti] - c.defActions[1 - ti]) / 6]].sort((a, b) => b[1] - a[1]);
    const mins = Math.max(1, Math.round((S.mclock - (sw.mc || S.mclock)) / 60)); sw.last = now;
    exMoment('momentum_swing', ti, '↗', 'Momentum swings to ' + TEAMS[ti].club, 'From ' + (ti === 0 ? Math.round(sw.ext) : -Math.round(sw.ext)) + ' to +' + Math.round(Math.abs(m)) + ' for ' + TEAMS[ti].club + ' in ' + mins + ' minute' + (mins > 1 ? 's' : '') + ', driven by ' + drv[0][0] + (drv[1][1] > 0.05 ? ' and ' + drv[1][0] : '') + '.', { from: Math.round(sw.ext), to: Math.round(m), drivers: [drv[0][0], drv[1][0]] }, 2); sw.ext = m; sw.t = now; sw.mc = S.mclock; }
  if (Math.abs(m) > Math.abs(sw.ext) || Math.sign(m) !== Math.sign(sw.ext) && Math.abs(m) > 25) { sw.ext = m; sw.t = now; sw.mc = S.mclock; }
  for (const k of EX.tac) { if (k.done || now - k.t < 40) continue; k.done = true; const m1 = k.ti === 0 ? EX.mom : -EX.mom; if (m1 - k.m0 >= 30 && m1 > -5) exMoment('turning_point', k.ti, '🔁', 'The switch is working', 'Since moving to ' + k.form + ' at ' + k.min + '\', ' + TEAMS[k.ti].club + '\'s momentum has gone from ' + Math.round(k.m0) + ' to ' + Math.round(m1) + '.', { formation: k.form, from: Math.round(k.m0), to: Math.round(m1) }, 2); }
}
// ---- moments: build, store, notify, queue a card, feed the Copilot ----
function exMoment(type, ti, icon, title, why, data, prio) {
  const m = { id: 'km' + (EX.moments.length + 1), t: +S.t.toFixed(2), matchClock: exClock(), minute: exMin(), type, team: ti >= 0 ? TEAMS[ti].key : null, icon, title, why, aiWhy: null, data: data || {}, prio: prio || 1 };
  EX.moments.push(m); EX.last = m;
  for (const f of EX.subs) { try { f(m); } catch (e) { console.error(e); } }
  EX.q.push({ m }); if (EX.q.filter((x) => x.m).length > 3) { const lo = EX.q.filter((x) => x.m).sort((a, b) => a.m.prio - b.m.prio)[0]; EX.q.splice(EX.q.indexOf(lo), 1); }
  if (typeof CP !== 'undefined' && $('cp-feed')) { const f = { id: m.id, icon, title, text: why, n: Math.max(1, EX.ev.filter((r) => r.t > S.t - EX.Wm).length), min: m.minute }; CP.insights.unshift(f); addInsight(f); if (!CP.open) $('cpbtn').classList.add('ping'); }
  exPolish(m); exFeed(m); return m;
}
// optional Claude wording pass: same facts, better sentence; the template stays as the overlay's explanation
async function exPolish(m) {
  if (!SAMPLE || EX.busy || m.prio < 2) return; EX.busy = true;
  try { const { text } = await SAMPLE('Rewrite this live football broadcast "why it matters" line as one vivid sentence of at most 30 words. Keep every number, name and fact exactly; add nothing new. Plain text only.\n\nLine: ' + m.why + '\nFacts: ' + JSON.stringify(m.data), { modelTier: 'quick', cache: false });
    const t = (text || '').trim().replace(/^"|"$/g, ''); if (t && t.length < 260) { m.aiWhy = t; if (EX.card && EX.card.m === m) $('mc-why').textContent = t; exFeed(m, true); } } catch (e) {}
  EX.busy = false;
}
// ---- lower-third moment cards: one at a time, a short gap between, durations in sim seconds ----
function exCards() {
  const now = S.t;
  for (const b of EX.q.filter((x) => x.big && now >= x.at)) { EX.q.splice(EX.q.indexOf(b), 1); if (STATS.goals.length > b.goals) continue; const ev = b.ev, ti = b.ti; const best = Math.max(0, ...EX.moments.filter((m) => m.type === 'big_chance').map((m) => m.data.xg));
    const nth = EX.moments.filter((m) => m.type === 'big_chance' && m.team === TEAMS[ti].key).length + 1;
    exMoment('big_chance', ti, '🎯', 'Big chance · ' + ev.player, 'A ' + ev.xg.toFixed(2) + ' xG chance' + (ev.xg > best ? ', the best of the match so far' : '') + ', struck at ' + ev.kmh + ' km/h. ' + (nth > 1 ? TEAMS[ti].club + '\'s ' + nth + (nth === 2 ? 'nd' : nth === 3 ? 'rd' : 'th') + ' big chance: the pressure is building.' : 'It stays ' + S.score.join('-') + ', but ' + TEAMS[ti].club + ' have found a way through.'), { player: ev.player, xg: ev.xg, kmh: ev.kmh, nth }, 2); }
  if (EX.card && now >= EX.card.until) { exCardHide(); EX.cardGap = now + 1.2; }
  if (!EX.card && now >= EX.cardGap) { const i = EX.q.findIndex((x) => x.m); if (i >= 0) { const { m } = EX.q.splice(i, 1)[0]; if (now - m.t < 20) exCardShow(m); } }
}
function exCardShow(m) {
  const dur = m.prio >= 3 ? 7 : 5.5; EX.card = { m, until: S.t + dur }; const c = m.team ? TEAMS[exTeam(m.team)].css : '#9FB0C2';
  const el = $('mcard'); el.style.setProperty('--tc', c); $('mc-k').textContent = 'KEY MOMENT · ' + m.minute + '\''; $('mc-t').textContent = m.icon + ' ' + m.title; $('mc-why').textContent = m.aiWhy || m.why; el.hidden = false; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
  exOverlay('moment_card', 'lower_third', dur, { momentId: m.id, momentType: m.type, team: m.team, title: m.title, data: m.data }, m.why);
}
function exCardHide() { EX.card = null; const el = $('mcard'); if (el) el.hidden = true; }
// ---- Match Pulse widget ----
function exFeed(m, upd) {
  const el = $('px-moment'); if (!el || EX.last !== m) return; el.innerHTML = '<b></b><p></p>'; el.querySelector('b').textContent = m.minute + '\' ' + m.icon + ' ' + m.title; el.querySelector('p').textContent = m.aiWhy || m.why;
}
function exSpark() {
  const s = EX.spark.slice(-45); if (s.length < 2) return ''; const w = 100, h = 28, dx = w / (s.length - 1); const y = (v) => (h / 2 - v / 100 * (h / 2)).toFixed(1);
  const pts = s.map((v, i) => (i * dx).toFixed(1) + ',' + y(v)).join(' ');
  return '<defs><clipPath id="pxa"><rect x="0" y="0" width="100" height="14"/></clipPath><clipPath id="pxb"><rect x="0" y="14" width="100" height="14"/></clipPath></defs><line x1="0" y1="14" x2="100" y2="14" stroke="rgba(255,255,255,.18)" stroke-width=".6"/>'
    + '<polygon clip-path="url(#pxa)" points="0,14 ' + pts + ' 100,14" fill="' + TEAMS[0].css + '" opacity=".55"/><polygon clip-path="url(#pxb)" points="0,14 ' + pts + ' 100,14" fill="' + TEAMS[1].css + '" opacity=".55"/><polyline points="' + pts + '" fill="none" stroke="#E6EDF3" stroke-width=".9" vector-effect="non-scaling-stroke"/>';
}
function exUI() {
  const el = $('pulse'); if (!el) return; el.hidden = $('bug').hidden || !players[0] || !players[0].xs; if (el.hidden) return;
  const t = performance.now(); if (t - EX.uiT < 250) return; EX.uiT = t; const P = exPulseObj();
  $('px-ball').textContent = '⚽ ' + P.ballKmh + ' km/h';
  $('px-ctl').style.left = P.control + '%'; $('px-ctlv').textContent = P.control >= 60 ? 'CONTROL ' + P.control + ' · ' + P.controlTeam : P.control <= 40 ? 'CHAOS ' + P.chaos : 'BALANCED ' + P.control;
  const mt = P.momentum >= 0 ? 0 : 1; $('px-momv').innerHTML = '<span style="color:' + TEAMS[mt].css + '">' + (Math.abs(P.momentum) < 8 ? 'EVEN' : TEAMS[mt].key + ' +' + Math.abs(P.momentum)) + '</span>';
  $('px-spark').innerHTML = exSpark();
  $('px-rhy').textContent = P.rhythm + ' · ' + Math.round(P.tempo) + ' passes/min · ' + P.breaksPct + '% stopped';
  const lp = EX.lastPass; $('px-pass').textContent = lp && lp.difficulty != null ? 'Last pass ' + Math.round(lp.distM) + ' m · difficulty ' + lp.difficulty + (lp.r.res === 1 ? ' ✓' : lp.r.res === 0 ? ' ✗' : '') : '';
  $('px-mini').textContent = (P.control >= 60 ? 'Control ' : P.control <= 40 ? 'Chaos ' : 'Even ') + (P.control <= 40 ? P.chaos : P.control) + ' · ' + (Math.abs(P.momentum) < 8 ? 'level' : '▲ ' + TEAMS[mt].key);
  if (!EX.last) $('px-moment').innerHTML = '<p class="px-none">Key moments will appear here with why they matter.</p>';
}
function exSetOpen(o) { EX.open = o; $('pulse').classList.toggle('min', !o); $('px-head').setAttribute('aria-expanded', o); $('px-tog').textContent = o ? '▾' : '▸'; document.body.classList.toggle('px-open', o); try { localStorage.setItem('mcx-pulse', o ? '1' : '0'); } catch (e) {} }
{ let o = null; try { o = localStorage.getItem('mcx-pulse'); } catch (e) {} exSetOpen(o == null ? innerWidth > 760 : o === '1'); $('px-head').onclick = () => exSetOpen(!EX.open); }
// ---- hooks: per sim step (metrics, rules, cards) and per HUD frame (widget) ----
{ const _step = stepSim; stepSim = function (dt) { _step(dt); exStep(dt); }; window.__mc.stepSim = stepSim; }
{ const _hud = hud; hud = function () { _hud(); exUI(); }; }
// ---- overlay track export, beside the dataset downloads ----
function overlayTrack() {
  return { schema: 'matchcast.overlay-track/1', generator: 'MatchCast explain module', match: { home: TEAMS[0].club, away: TEAMS[1].club, score: S.score.join('-'), seed: SET.seed, halfLengthRealMin: SET.half, matchSecondsPerSimSecond: S.mscale, kickoffT: +(EX.t0 || 0).toFixed(2) },
    timing: 't = the sim clock S.t in seconds (advances 1:1 with video at 1x playback, frozen during holds); subtract match.kickoffT to align with a video that starts at kick-off; durationS in sim seconds; matchClock = scoreboard mm:ss', anchors: 'lower_third | pulse_widget | player:<TEAM>-<num> (payload.pitchXY = metres, x along the length from the home goal line at kick-off)', count: EX.ov.length, overlays: EX.ov };
}
for (const b of document.querySelectorAll('.dl-ovl')) b.onclick = () => saveFile(fileBase() + '_overlays.json', JSON.stringify(overlayTrack(), null, 1), 'application/json');
// ---- public API for the fan-mode and Copilot agents ----
function exPlayerStats(p) {
  if (typeof p === 'string') p = exPl(p); if (!p || !p.xs) return null; const x = p.xs;
  return { name: p.name, num: p.num, team: p.T.key, pos: p.pos, distanceKm: +exKm(x).toFixed(2), distanceRawKm: +(x.dm / 1000).toFixed(2), distanceSimM: Math.round(x.d), speedKmh: +(x.spd * 3.6).toFixed(1), topSpeedKmh: +x.top.toFixed(1), sprints: x.sprints, passes: x.passes, passesCompleted: x.comp, passAccuracyPct: x.passes ? Math.round(x.comp / x.passes * 100) : null, avgPassDifficulty: x.passes ? Math.round(x.diffSum / x.passes) : null, stamina: +p.stamina.toFixed(2) };
}
window.MCX = {
  metrics: () => ({ ballKmh: Math.round(DM.hypot(ball.v.x, ball.v.y, ball.v.z) * 3.6), lastShot: S.shotInfo ? { player: S.shotInfo.p.name, kmh: S.shotInfo.kmh, xg: +S.shotInfo.xg.toFixed(3) } : null, lastPass: EX.lastPass ? Object.assign({}, EX.lastPass, { r: undefined, completed: EX.lastPass.r.res == null ? null : !!EX.lastPass.r.res }) : null, topSpeedKmh: +EX.topKmh.toFixed(1), players: players.map(exPlayerStats) }),
  get moments() { return EX.moments; }, onMoment: (fn) => { EX.subs.push(fn); }, pulse: exPulseObj, playerStats: exPlayerStats, overlays: () => EX.ov, overlayTrack, passDifficulty,
};
