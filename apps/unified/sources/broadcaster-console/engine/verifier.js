// ============ VERIFIER: the checking agent ============
// Watches every match independently of the engine that runs it. It re-derives each refereeing decision from the raw ball and
// player state (IFAB Laws 8-17) and samples the animation for teleports, spins and body pops. Every check keeps a pass/fail
// tally and the last problem it saw, shown live in the Copilot's Verify tab and exposed to automated test runs.
const VCHK = [
  ['ko', 'Kick-off', 'Law 8', 'Everyone in their own half, opponents outside the circle, the right team kicks off'],
  ['half', 'Second half', 'Law 8', 'Teams change ends and the other team kicks off'],
  ['out', 'Ball out of play', 'Laws 9, 15-17', 'Ball wholly over the line; throw-in, corner or goal kick to the right side'],
  ['throw', 'Throw-in technique', 'Law 15', 'Taken where it went out, from on or behind the line, both hands over the head'],
  ['restart', 'Restarts taken', 'Laws 13-17', 'Every restart is taken, none hangs for more than 20 seconds'],
  ['goal', 'Goals', 'Law 10', 'Whole ball over the line, between the posts, under the bar'],
  ['foul', 'Fouls and penalties', 'Laws 12, 14', 'Penalty only for a foul inside the box, free kick outside'],
  ['offside', 'Offside', 'Law 11', 'Flagged player was in the opponents\' half and past the second-last defender'],
  ['refpos', 'Referee positioning', 'Law 5', 'Referee keeps within 40 m of the ball and out of the way'],
  ['motion', 'Smooth motion', 'Animation', 'No teleports, spins or pops in any player\'s movement'],
  ['bodies', 'No overlapping bodies', 'Animation', 'Players never stand inside each other'],
  ['onpitch', 'Players on the pitch', 'Law 3', 'Nobody wanders off: players stay on the field or its run-off'],
];
const VER = { c: {}, log: [], pending: [], prevR: null, acc: 0, mot: new Map(), lastLine: -99, half: 1 };
function verifierReset() {
  VER.c = {}; for (const [k] of VCHK) VER.c[k] = { ok: 0, bad: 0, note: '' }; VER.log = []; VER.pending = []; VER.prevR = null; VER.acc = 0; VER.mot = new Map(); VER.lastLine = S.t; VER.half = 1; VER.nextKO = 0;
  if ($('vf-list')) renderVerify();
}
function vRes(k, ok, note) {
  const c = VER.c[k]; if (!c) return; if (ok) c.ok++; else { c.bad++; c.note = note || ''; VER.log.unshift({ k, min: minuteLabel(), note: note || '' }); VER.log.length = Math.min(VER.log.length, 30); dataEvent('verifier_flag', { check: k, note: note || '' }); }
}
const lastSide = () => (S.lastTouch ? S.lastTouch.ti : null);
S.check = {
  out(type, team, spot) {
    const b = ball.p; const overTouch = b.z < -BR * 0.9 || b.z > 68 + BR * 0.9; const overGoal = b.x < -BR * 0.9 || b.x > 105 + BR * 0.9;
    const lt = lastSide(); let exp = null, expTeam = null;
    if (overTouch && !overGoal) { exp = 'throw'; expTeam = lt === null ? team : 1 - lt; }
    else if (overGoal) { const defTeam = ownGoal(0).x === (b.x < 52.5 ? 0 : 105) ? 0 : 1; exp = lt === defTeam ? 'corner' : 'goalkick'; expTeam = exp === 'corner' ? 1 - defTeam : defTeam; }
    const ok = exp === type && expTeam === team;
    vRes('out', ok, ok ? '' : 'Ball at ' + b.x.toFixed(1) + ', ' + b.z.toFixed(1) + ' gave ' + type + ' to ' + TEAMS[team].key + ', expected ' + exp + ' to ' + (expTeam !== null ? TEAMS[expTeam].key : '?'));
    if (type === 'throw') VER.outAt = V2(clamp(b.x, 0, 105), b.z < 34 ? 0 : 68);
  },
  restartTaken(R, tk) {
    if (R.type !== 'throw') return;
    const behind = R.spot.y < 34 ? tk.pos2.y <= 0.45 : tk.pos2.y >= 67.55; const near = VER.outAt ? Math.abs(tk.pos2.x - VER.outAt.x) < 1.6 : true;
    const overhead = ball.p.y > 2.0;
    vRes('throw', behind && near && overhead, !behind ? 'Taker ' + surname(tk.name) + ' was inside the pitch' : !near ? 'Taken ' + Math.abs(tk.pos2.x - VER.outAt.x).toFixed(1) + ' m from where it went out' : 'Ball released below head height');
  },
  goal(ti) {
    VER.nextKO = 1 - ti;
    const b = ball.p; const gx = goalOf(ti).x; const over = gx === 105 ? b.x > 105 + BR * 0.9 : b.x < -BR * 0.9; const posts = b.z > 30.34 && b.z < 37.66 && b.y < 2.44;
    vRes('goal', over && posts, 'Ball at ' + b.x.toFixed(2) + ', ' + b.y.toFixed(2) + ', ' + b.z.toFixed(2));
  },
  foul(off, vic, inBox) {
    const sp = vic.pos2; const og = ownGoal(off.ti); const box = Math.abs(sp.x - og.x) <= 16.5 + 0.3 && Math.abs(sp.y - 34) <= 20.16 + 0.3; const box0 = Math.abs(sp.x - og.x) <= 16.5 - 0.3 && Math.abs(sp.y - 34) <= 20.16 - 0.3;
    vRes('foul', inBox ? box : !box0, (inBox ? 'Penalty given for a foul outside the box' : 'Free kick given for a foul inside the box') + ' (' + sp.x.toFixed(1) + ', ' + sp.y.toFixed(1) + ')');
  },
  offside(p, at) { const o = w2own(p.ti, at); vRes('offside', o.x > 52.5, surname(p.name) + ' flagged in his own half'); },
  secondHalf() { VER.half = 2; VER.lastLine = S.t; VER.pend2 = true; VER.nextKO = 1; if (S.restart) S.restart.expTeam = 1; },
  resumed() { VER.nextKO = undefined; },
};
function verifierTick(dt) {
  if (!S.started || S.over) return;
  const R = S.restart;
  // restart transitions: judge kick-offs at the moment they are taken, and anything left hanging
  if (VER.prevR && VER.prevR !== R) {
    const P = VER.prevR;
    if (P.type === 'kickoff') {
      let bad = null; for (const q of players) { if (q.off || q === P.taker) continue; const ox = w2own(q.ti, q.pos2).x; if (ox > 52.7) bad = surname(q.name) + ' was in the opponents\' half'; else if (q.ti !== P.team && q.pos2.distanceTo(V2(52.5, 34)) < 9.0) bad = surname(q.name) + ' was inside the centre circle'; }
      let expTeam = P.expTeam; vRes('ko', !bad && (expTeam === undefined || expTeam === P.team), bad || ('Wrong team kicked off: ' + TEAMS[P.team].key));
      if (VER.pend2) { VER.pend2 = false; vRes('half', S.flip === 1 && P.team === 1 && goalOf(0).x === 0, 'Second half: flip ' + S.flip + ', kick-off by ' + TEAMS[P.team].key); }
    }
  }
  if (R && R !== VER.prevR) { R.vT = 0; if (R.type === 'kickoff') R.expTeam = VER.nextKO; }
  if (R) { if (!(S.celebrate > 0) && !S.hold) R.vT = (R.vT || 0) + dt; if (R.vT > 20 && !R.vFlag && !S.hold && !(S.celebrate > 0)) { R.vFlag = true; vRes('restart', false, R.type + ' for ' + TEAMS[R.team].key + ' not taken after 20 s'); } }
  if (VER.prevR && VER.prevR !== R && !VER.prevR.vFlag) vRes('restart', true);
  VER.prevR = R;
  // once a second: referee, motion and bodies
  VER.acc += dt; const sample = VER.acc >= 1; if (sample) VER.acc = 0;
  let tele = null, spin = null;
  for (const p of players) {
    if (p.off) continue; const m = VER.mot.get(p);
    if (m && S.t - VER.lastLine > 0.5) { const jump = m.pos.distanceTo(p.pos2); if (jump > 0.75 && !(S.hold)) tele = surname(p.name) + ' jumped ' + jump.toFixed(1) + ' m'; }
    if (Math.abs(p.yawV || 0) > 9.5) spin = surname(p.name) + ' turned at ' + Math.abs(p.yawV).toFixed(1) + ' rad/s';
    if (m) m.pos.copy(p.pos2); else VER.mot.set(p, { pos: p.pos2.clone() });
  }
  if (tele) VER.tele = tele; if (spin) VER.spin = spin;
  if (sample) {
    vRes('motion', !VER.tele && !VER.spin, VER.tele || VER.spin); VER.tele = null; VER.spin = null;
    const ref = officials.find((o) => o.role === 'ref'); const d = ref ? ref.pos2.distanceTo(bp2()) : 0; const inWay = ref && S.owner && ref.pos2.distanceTo(S.owner.pos2) < 1.2;
    if (!R && !S.dead && Math.hypot(ball.v.x, ball.v.z) < 15) vRes('refpos', d < 40 && !inWay, inWay ? 'Referee in the ball carrier\'s path' : 'Referee ' + d.toFixed(0) + ' m from the ball');
    let ov = null; const ps = players.filter((q) => !q.off && !(q.act && ['fall', 'slide', 'dive', 'celebrate', 'header'].includes(q.act.type)));
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (ps[i].pos2.distanceTo(ps[j].pos2) < 0.45) ov = surname(ps[i].name) + ' and ' + surname(ps[j].name);
    vRes('bodies', !ov, ov ? ov + ' overlapping' : '');
    let offp = null; for (const q of players) { if (q.off || (R && R.taker === q) || (S.dead) || q.act?.type === 'celebrate' || q.act?.type === 'slide') continue; if (q.pos2.x < -4 || q.pos2.x > 109 || q.pos2.y < -4 || q.pos2.y > 72) offp = surname(q.name) + ' at ' + q.pos2.x.toFixed(1) + ', ' + q.pos2.y.toFixed(1) + (R ? ' during ' + R.type : '') + (q.act ? ' (' + q.act.type + ')' : '') + (S.owner === q ? ' on the ball' : ''); }
    if (!S.celebrate) vRes('onpitch', !offp, offp ? offp + ' off the field of play' : '');
    if (CP && $('cp-verify') && !$('cp-verify').hidden) renderVerify();
    $('ag-ver').textContent = verifierSummary().line;
  }
}
function verifierSummary() {
  let ok = 0, bad = 0; for (const k in VER.c) { ok += VER.c[k].ok; bad += VER.c[k].bad; }
  const pct = ok + bad ? Math.round(ok / (ok + bad) * 1000) / 10 : 100; const issues = VCHK.filter(([k]) => VER.c[k] && VER.c[k].bad).length;
  return { ok, bad, pct, issues, line: (ok + bad) + ' checks · ' + (bad ? bad + ' flagged' : 'all clear') };
}
function verifierReport() { const s = verifierSummary(); return { passRatePct: s.pct, checks: VCHK.map(([k, name, law]) => ({ id: k, name, law, passed: VER.c[k]?.ok || 0, failed: VER.c[k]?.bad || 0, lastIssue: VER.c[k]?.note || null })), recent: VER.log.slice(0, 10) }; }
function renderVerify() {
  const el = $('vf-list'); if (!el) return; const s = verifierSummary();
  $('vf-score').innerHTML = '<b>' + s.pct.toFixed(1) + '%</b><span>' + s.ok + ' passed · ' + s.bad + ' flagged across ' + VCHK.length + ' checks</span>';
  el.innerHTML = VCHK.map(([k, name, law, desc]) => { const c = VER.c[k] || { ok: 0, bad: 0 }; const st = c.bad ? 'bad' : c.ok ? 'ok' : 'wait';
    return '<div class="vf-r ' + st + '"><i aria-hidden="true">' + (st === 'bad' ? '!' : st === 'ok' ? '✓' : '·') + '</i><div><b>' + name + '</b><small>' + law + ' · ' + (c.bad ? c.note : desc) + '</small></div><span>' + c.ok + (c.bad ? ' / <em>' + c.bad + '</em>' : '') + '</span></div>'; }).join('');
}
$('vf-ai').onclick = async () => {
  const out = $('vf-sum'); const rep = verifierReport(); out.hidden = false;
  if (!SAMPLE) { const bad = rep.checks.filter((c) => c.failed); out.textContent = bad.length ? 'Flagged: ' + bad.map((c) => c.name + ' (' + c.failed + ', last: ' + c.lastIssue + ')').join('; ') + '.' : 'Every refereeing decision and motion sample so far checks out against the Laws of the Game.'; return; }
  out.textContent = 'Verifier is reviewing…';
  try { const { text } = await SAMPLE('You are the Verifier agent in MatchCast, a football match simulator. Review this live audit of the simulated match against the IFAB Laws of the Game and animation realism. In at most 4 short sentences, plain text: say whether the match is being refereed correctly, name any flagged problem and its likely cause, and say what to watch. Use only the JSON.\n\n' + JSON.stringify(rep), { modelTier: 'quick', cache: false, onText: ({ text }) => { out.textContent = text; } }); out.textContent = text; }
  catch (e) { out.textContent = 'The Verifier could not reach the model just now. The table above is still live.'; }
};
window.verifierReset = verifierReset; window.__mc.verifier = { report: verifierReport, summary: verifierSummary };
