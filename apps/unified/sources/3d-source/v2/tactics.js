// ============ TACTICS: formations, team styles, phases of play, the laws (offside, fouls, cards, set pieces) ============
// Slots are [role, x, y] in a team's own frame (attacking +x, own goal at x=0, left touchline y=0), drawn at the depth
// a team holds in a mid-block. think() stretches or squeezes them by phase of play and team style.
const FORMATIONS = {
  '4-3-3':   [['LB', 18, 9], ['CB', 16, 26], ['CB', 16, 42], ['RB', 18, 59], ['CM', 36, 22], ['DM', 31, 34], ['CM', 36, 46], ['LW', 52, 10], ['ST', 55, 34], ['RW', 52, 58]],
  '4-2-3-1': [['LB', 18, 9], ['CB', 16, 26], ['CB', 16, 42], ['RB', 18, 59], ['DM', 30, 27], ['DM', 30, 41], ['LW', 46, 11], ['AM', 44, 34], ['RW', 46, 57], ['ST', 55, 34]],
  '4-4-2':   [['LB', 18, 9], ['CB', 16, 26], ['CB', 16, 42], ['RB', 18, 59], ['LM', 38, 9], ['CM', 34, 27], ['CM', 34, 41], ['RM', 38, 59], ['ST', 53, 29], ['ST', 53, 40]],
  '4-1-4-1': [['LB', 18, 9], ['CB', 16, 26], ['CB', 16, 42], ['RB', 18, 59], ['DM', 28, 34], ['LM', 38, 9], ['CM', 37, 26], ['CM', 37, 42], ['RM', 38, 59], ['ST', 54, 34]],
  '3-5-2':   [['CB', 16, 20], ['CB', 14, 34], ['CB', 16, 48], ['LWB', 32, 6], ['DM', 30, 34], ['CM', 37, 24], ['CM', 37, 44], ['RWB', 32, 62], ['ST', 53, 29], ['ST', 53, 40]],
  '3-4-3':   [['CB', 16, 20], ['CB', 14, 34], ['CB', 16, 48], ['LM', 35, 8], ['CM', 33, 27], ['CM', 33, 41], ['RM', 35, 60], ['LW', 51, 13], ['ST', 55, 34], ['RW', 51, 55]],
  '5-3-2':   [['LWB', 20, 6], ['CB', 15, 21], ['CB', 13, 34], ['CB', 15, 47], ['RWB', 20, 62], ['CM', 33, 22], ['DM', 30, 34], ['CM', 33, 46], ['ST', 50, 29], ['ST', 50, 40]],
  '5-4-1':   [['LWB', 19, 6], ['CB', 15, 21], ['CB', 13, 34], ['CB', 15, 47], ['RWB', 19, 62], ['LM', 33, 10], ['CM', 31, 27], ['CM', 31, 41], ['RM', 33, 58], ['ST', 50, 34]],
};
// how often each shape is seen in top-flight football today (rough share of starting line-ups)
const FORM_W = { '4-3-3': 24, '4-2-3-1': 24, '4-4-2': 13, '4-1-4-1': 8, '3-5-2': 9, '3-4-3': 10, '5-3-2': 7, '5-4-1': 5 };
const STYLES = {
  balanced:   { label: 'Balanced', blurb: 'Mid-block, mixes short and long', press: 0.5, line: 0.5, width: 1.0, direct: 0.45, tempo: 0.6, short: 0.6, cpress: 0.5, runs: 0.5, foul: 0 },
  possession: { label: 'Possession', blurb: 'Short build-up from the keeper, patient, high line', press: 0.6, line: 0.7, width: 1.12, direct: 0.15, tempo: 0.45, short: 0.95, cpress: 0.7, runs: 0.35, foul: -0.02 },
  gegenpress: { label: 'Gegenpress', blurb: 'Win it back within seconds, high line, fast vertical attacks', press: 0.95, line: 0.85, width: 1.0, direct: 0.55, tempo: 0.9, short: 0.7, cpress: 1, runs: 0.7, foul: 0.05 },
  counter:    { label: 'Counter', blurb: 'Deep block, then sprint into the space behind', press: 0.3, line: 0.3, width: 0.92, direct: 0.8, tempo: 0.95, short: 0.3, cpress: 0.2, runs: 0.9, foul: 0.02 },
  direct:     { label: 'Direct', blurb: 'Long balls to the forwards, win the second ball', press: 0.55, line: 0.5, width: 1.05, direct: 0.95, tempo: 0.75, short: 0.15, cpress: 0.5, runs: 0.75, foul: 0.04 },
  lowblock:   { label: 'Low block', blurb: 'Park the bus: two banks deep, clear the lines', press: 0.15, line: 0.1, width: 0.85, direct: 0.7, tempo: 0.4, short: 0.25, cpress: 0.1, runs: 0.4, foul: 0.03 },
};
const STYLE_W = { balanced: 28, possession: 20, gegenpress: 14, counter: 16, direct: 12, lowblock: 10 };
const roleCat = (r) => (r === 'GK' ? 0 : ['LB', 'RB', 'CB', 'LWB', 'RWB'].includes(r) ? 1 : ['DM', 'CM', 'LM', 'RM', 'AM'].includes(r) ? 2 : 3);
const wPick = (w) => { let s = 0; for (const k in w) s += w[k]; let r = rnd() * s; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return Object.keys(w)[0]; };
// put the outfielders into a shape: each slot takes the free player whose natural role and side fit best
function applyFormation(ti, name) {
  const T = TEAMS[ti]; T.tac.form = name; let slots = FORMATIONS[name].map((s) => s.slice());
  const out = teamOf(ti).filter((p) => !p.gk);
  while (slots.length > out.length) { // down to ten: lose a wide forward or a second striker first
    let k = slots.findIndex((s) => ['LW', 'RW', 'AM', 'LM', 'RM'].includes(s[0])); if (k < 0) k = slots.map((s) => s[0]).lastIndexOf('ST'); if (slots.filter((s) => s[0] === 'ST').length < 2 && slots[k][0] === 'ST') k = slots.length - 2; slots.splice(k, 1);
  }
  const free = new Set(out); const order = slots.map((s, i) => i).sort((a, b) => roleCat(slots[a][0]) - roleCat(slots[b][0]) || Math.abs(slots[b][2] - 34) - Math.abs(slots[a][2] - 34));
  for (const i of order) {
    const [r, x, y] = slots[i]; let best = null, bc = 1e9;
    for (const p of free) { const c = 10 * Math.abs(roleCat(p.nat) - roleCat(r)) + Math.abs(p.natSlot.y - y) / 5 + (p.nat === r ? -2 : 0); if (c < bc) { bc = c; best = p; } }
    free.delete(best); best.pos = r; best.slot = V2(x, y);
  }
}
function setStyle(ti, key) { const T = TEAMS[ti]; T.tac.style = key; T.tac.cur = Object.assign({}, STYLES[key]); }
function setupTactics(set) {
  TEAMS.forEach((T, ti) => {
    const c = set.tactics[ti]; const form = c.form === 'auto' ? wPick(FORM_W) : c.form; const style = c.style === 'auto' ? wPick(STYLE_W) : c.style;
    T.tac = { form, style, cur: null, chasing: false, protecting: false, saving: false, wet: false, applied: [] }; setStyle(ti, style); applyFormation(ti, form);
  });
}
// ---- phase of play for a team: what it is trying to do right now ----
function phaseOf(ti) {
  const T = TEAMS[ti], tc = T.tac.cur; const bo = w2own(ti, bp2()).x; const since = S.t - (S.possT || 0);
  if (S.poss === ti) {
    if (S.possHow === 'won' && since < 6 && bo < 75 && tc.runs > 0.45) return 'counter';
    return bo < 36 ? 'build-up' : bo < 70 ? 'progression' : 'final third';
  }
  if (S.possHow === 'won' && since < 4.5 && tc.cpress > 0.45) return 'counter-press';
  return tc.press > 0.75 ? 'high press' : tc.line < 0.3 ? 'low block' : 'mid block';
}
// ---- the laws ----
// offside: judged at the moment a team-mate plays the ball; penalised only if that player then becomes involved
function markOffside(p) {
  S.offSet = null; const ti = p.ti; const line = offsideLine(ti); const bx = w2own(ti, bp2()).x; const set = new Map();
  for (const q of teamOf(ti)) { if (q === p) continue; const x = w2own(ti, q.pos2).x; if (x > 52.5 && x > bx + 0.2 && x > line + 0.3) set.set(q, q.pos2.clone()); }
  if (set.size) S.offSet = set;
}
function callOffside(p) {
  const at = S.offSet.get(p); S.offSet = null; STATS.offsides[p.ti]++; S.check && S.check.offside(p, at);
  const ar = officials.find((o) => o.role === (at.x > 52.5 ? 'ar1' : 'ar2')); if (ar) ar.act = { type: 'flag', t: 0, dur: 2.4 }; whistle('short'); signal('ref', V2(0, 0), 1.45, { dur: 2.4 }); // indirect free kick: arm straight up
  say('The flag is up. ' + p.name + ' strayed offside.'); dataEvent('offside', { team: p.T.key, player: p.name, x: +at.x.toFixed(1), y: +at.y.toFixed(1) });
  setRestart('freekick', 1 - p.ti, at); S.restart.indirect = true;
}
function foul(off, vic, kind) {
  const spot = vic.pos2.clone(); const tc = off.T.tac.cur;
  vic.act = { type: 'fall', t: 0, dur: 2.6 }; vic.vel.multiplyScalar(0.4); off.vel.multiplyScalar(0.5); STATS.fouls[off.ti]++;
  // denying an obvious goal-scoring opportunity: attacker clean through centrally with no outfield defender goal-side
  const vo = w2own(vic.ti, spot); const goalSide = teamOf(off.ti).filter((d) => !d.gk && d !== off && w2own(vic.ti, d.pos2).x > vo.x - 1).length;
  const og = ownGoal(off.ti); const inBox = Math.abs(spot.x - og.x) <= 16.5 && Math.abs(spot.y - 34) <= 20.16;
  const dogso = vo.x > 72 && Math.abs(vo.y - 34) < 18 && goalSide === 0 && vic === (S.owner || vic);
  const tactical = phaseOf(vic.ti) === 'counter' && vic.vel.length() > 4.5;
  let card = null; const pc = { slide: 0.42, 'from behind': 0.3, trip: 0.1, pull: 0.22 }[kind] + (tactical ? 0.3 : 0) + tc.foul;
  if (dogso) card = inBox && kind !== 'pull' ? 'yellow' : 'red'; // a penalty for a genuine attempt at the ball is only a caution (IFAB Law 12)
  else if (rnd() < pc) card = 'yellow';
  dataEvent('foul', { team: off.T.key, player: off.name, on: vic.name, kind, x: +spot.x.toFixed(1), y: +spot.y.toFixed(1), inBox, dogso, card });
  say(off.name + (kind === 'slide' ? ' goes to ground and catches ' : kind === 'from behind' ? ' clips ' : kind === 'pull' ? ' hauls back ' : ' trips ') + surname(vic.name) + '. ' + (inBox ? 'PENALTY!' : 'Free kick.'));
  const ref = officials.find((o) => o.role === 'ref');
  if (card) {
    off.yellows = (off.yellows || 0) + (card === 'yellow' ? 1 : 0); const red = card === 'red' || off.yellows >= 2;
    if (ref) ref.act = { type: 'card', t: 0, dur: 2.4 };
    if (red) sendOff(off, card === 'red' ? (dogso ? 'denying a goal-scoring chance' : 'serious foul play') : 'a second yellow');
    else { STATS.yellows[off.ti]++; toast('<span class="card y"></span>YELLOW CARD<small>' + off.name + ' · ' + off.T.club + '</small>', 2.2); dataEvent('yellow_card', { team: off.T.key, player: off.name, reason: tactical ? 'stopping a counter-attack' : 'reckless challenge' }); }
  } else if (ref && inBox) signal('ref', own2w(off.ti, 11, 34).sub(ref.pos2), -0.4, { dur: 2.4 });
  else signal('ref', V2(dirOf(vic.ti), 0), 0.15, { dur: 2.2 }); // direct free kick: arm points the way the fouled side attacks
  whistle(inBox ? 'double' : 'short'); S.check && S.check.foul(off, vic, inBox);
  if (inBox) { setRestart('penalty', vic.ti, own2w(off.ti, 11, 34)); toast('PENALTY<small>' + vic.T.club + '</small>', 2); }
  else { setRestart('freekick', vic.ti, spot); }
  S.restart.wait = 3.2;
}
function sendOff(p, why) {
  STATS.reds[p.ti]++; p.off = true; p.act = null; p.vel.set(0, 0); p.pos2.set(52.5, -8); p.model.visible = false; if (S.owner === p) S.owner = null;
  toast('<span class="card r"></span>RED CARD<small>' + p.name + ' · ' + why + '</small>', 2.6); say(p.name + ' is sent off for ' + why + '. ' + p.T.club + ' are down to ten.');
  dataEvent('red_card', { team: p.T.key, player: p.name, reason: why }); applyFormation(p.ti, p.T.tac.form);
}
// set-piece taker: penalties and shooting-range free kicks go to the best striker of the ball
function setPieceTaker(type, team, spot) {
  const T = teamOf(team).filter((p) => !p.gk); const dGoal = spot.distanceTo(goalOf(team));
  if (type === 'penalty' || (type === 'freekick' && dGoal < 32)) return T.slice().sort((a, b) => b.shotS + b.passS * 0.5 - a.shotS - a.passS * 0.5)[0];
  return T.slice().sort((a, b) => a.pos2.distanceTo(spot) - b.pos2.distanceTo(spot))[0];
}
function setPieceKick(R, tk) {
  const dGoal = R.spot.distanceTo(goalOf(R.team)); const central = Math.abs(R.spot.y - 34) < 15; const own = w2own(R.team, R.spot);
  S.restart = null; S.owner = tk; tk.ownT = 1; let plan;
  if (R.type === 'penalty') { plan = { type: 'shot', xg: 0.76, pen: true }; say(tk.name + ' steps up...'); }
  else if (!R.indirect && dGoal < 30 && central && rnd() < 0.6) { plan = { type: 'shot', xg: clamp(0.1 - (dGoal - 18) * 0.005, 0.03, 0.1), fk: true }; say(tk.name + ' goes for goal from the free kick.'); }
  else if (own.x > 66) {
    const box = teamOf(R.team).filter((q) => q !== tk && !q.gk && w2own(R.team, q.pos2).x > 84).sort((a, b) => Math.abs(a.pos2.y - 34) - Math.abs(b.pos2.y - 34));
    const q = box[Math.floor(rnd() * Math.min(3, box.length))] || teamOf(R.team).find((m) => m !== tk && !m.gk);
    plan = { type: 'pass', q, tgt: q.pos2.clone(), lofted: true, d: q.pos2.distanceTo(tk.pos2), cross: true }; say(surname(tk.name) + ' whips the free kick into the box.');
  } else { plan = decide(tk); if (plan.type !== 'pass') { const q = teamOf(R.team).filter((m) => m !== tk && !m.gk).sort((a, b) => a.pos2.distanceTo(tk.pos2) - b.pos2.distanceTo(tk.pos2))[0]; plan = { type: 'pass', q, tgt: q.pos2.clone(), lofted: false, d: q.pos2.distanceTo(tk.pos2) }; } }
  startKick(tk, plan); tk.act.t = tk.act.dur * 0.25; ball.last = tk;
}
// where everyone stands for a free kick or penalty (the wall stands 9.15 m back, everyone else outside the box for a penalty)
function setPieceShape(R, p) {
  const atk = p.ti === R.team; const gx = goalOf(R.team); const dGoal = R.spot.distanceTo(gx);
  if (R.type === 'penalty') {
    if (p.gk && !atk) { p.tgt.set(gx.x + (gx.x > 50 ? -0.15 : 0.15), 34); p.urg = 0.5; p.lookAt = R.spot; return true; }
    if (p.gk) return false;
    const sx = gx.x > 50 ? -1 : 1; p.tgt.set(gx.x + sx * (19.5 + (p.i % 4) * 1.6), 34 + ((p.i * 7 + p.ti * 3) % 30) - 15); p.urg = 0.55; p.lookAt = R.spot; return true;
  }
  if (atk || p.gk) {
    if (atk && !p.gk && dGoal < 36 && roleCat(p.pos) >= 1 && !(['LB', 'RB'].includes(p.pos) && p.i % 2)) { const sx = gx.x > 50 ? -1 : 1; p.tgt.set(gx.x + sx * (9 + (p.i % 4) * 2.2), 34 + ((p.i * 5) % 16) - 8); p.urg = 0.6; p.lookAt = R.spot; return true; }
    return false;
  }
  const nWall = dGoal < 30 && Math.abs(R.spot.y - 34) < 18 ? (dGoal < 22 ? 4 : 3) : dGoal < 36 ? 2 : 0;
  if (!R.wall) { R.wall = teamOf(p.ti).filter((q) => !q.gk).sort((a, b) => a.pos2.distanceTo(R.spot) - b.pos2.distanceTo(R.spot)).slice(0, nWall); }
  const k = R.wall.indexOf(p);
  if (k >= 0) { const u = gx.clone().sub(R.spot).normalize(); const n = V2(-u.y, u.x); const c = R.spot.clone().addScaledVector(u, 9.15).addScaledVector(n, (k - (R.wall.length - 1) / 2) * 0.72 + (R.spot.y < 34 ? 0.6 : -0.6)); p.tgt.copy(c); p.urg = 0.6; p.lookAt = R.spot; p.wallT = 1; return true; }
  if (dGoal < 36) { const sx = gx.x > 50 ? -1 : 1; p.tgt.set(gx.x + sx * (7 + (p.i % 3) * 2.4), 34 + ((p.i * 7) % 18) - 9); p.urg = 0.6; p.lookAt = R.spot; return true; }
  if (p.pos2.distanceTo(R.spot) < 9.3) { p.tgt.copy(R.spot.clone().add(p.pos2.clone().sub(R.spot).setLength(9.5))); p.urg = 0.6; return true; }
  return false;
}
// ---- the manager on the bench: in-game changes from the scoreline, the clock, the heat and the pitch ----
function adaptTactics(mn) {
  TEAMS.forEach((T, ti) => {
    const tac = T.tac; const diff = S.score[ti] - S.score[1 - ti]; const c = tac.cur; const opp = TEAMS[1 - ti];
    const change = (form, mods, line, why) => { if (form && form !== tac.form) applyFormation(ti, form); Object.assign(c, mods); say(line); toast('🔁<small>' + T.club.toUpperCase() + ' · ' + (form || tac.form) + ' · ' + why + '</small>', 2.2); dataEvent('tactical_change', { team: T.key, formation: tac.form, why, press: +c.press.toFixed(2), line: +c.line.toFixed(2), direct: +c.direct.toFixed(2) }); };
    if (!tac.chasing && mn >= 62 && diff < 0 && rnd() < 0.5) { tac.chasing = true; const f = ['3-5-2', '3-4-3', '5-3-2', '5-4-1'].includes(tac.form) ? '3-4-3' : diff <= -2 ? '3-4-3' : '4-2-3-1'; change(f, { press: Math.min(1, c.press + 0.25), line: Math.min(1, c.line + 0.2), direct: Math.min(1, c.direct + 0.15), runs: Math.min(1, c.runs + 0.2) }, T.club + ' chase the game. They switch to ' + f + ' and push men forward.', 'chasing the game'); }
    if (!tac.protecting && mn >= 76 && diff > 0 && rnd() < 0.55) { tac.protecting = true; const f = diff >= 2 ? '4-4-2' : '5-4-1'; change(f, { press: Math.max(0.1, c.press - 0.3), line: Math.max(0.05, c.line - 0.3), tempo: 0.35 }, T.club + ' shut up shop: ' + f + ', deep and narrow, protecting the lead.', 'protecting the lead'); }
    if (!tac.saving && mn >= 55 && ENV.heat > 0.75 && c.press > 0.6 && rnd() < 0.6) { tac.saving = true; change(null, { press: c.press - 0.25, tempo: c.tempo - 0.15 }, 'In this heat ' + T.club + ' drop off and stop pressing so high to save their legs.', 'heat: pressing less'); }
    if (!tac.wet && ENV.puddle > 0.35 && c.short > 0.6 && rnd() < 0.6) { tac.wet = true; change(null, { short: 0.2, direct: Math.max(c.direct, 0.85) }, 'The ball is holding up in the water, so ' + T.club + ' abandon the short game and go long.', 'waterlogged: going long'); }
  });
}
