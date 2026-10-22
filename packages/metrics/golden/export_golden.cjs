// Writes golden.json: 54 seeded cases with expected values from the JavaScript reference formulas.
// An independent JavaScript implementation of the formulas in docs/metrics.md (see ADR-0016). The xG curve and the
// pass-difficulty terms follow the engine's curve and explain.js passDifficulty, except that the lane term is a distance.
//   node packages/metrics/golden/export_golden.cjs > packages/metrics/golden/golden.json
'use strict';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const B = { b0: -1.464609, b1: 1.413822, b2: -0.089141 };
let s = 20261022;
const rnd = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const near = (o, x, y) => o.reduce((m, [a, b]) => Math.min(m, Math.hypot(a - x, b - y)), 99);
function xg(sh, opp) {
  if (sh.kind === 'penalty') return 0.76;
  const dx = Math.abs(sh.attack_x - sh.x), dy = sh.y - 34, dist = Math.hypot(dx, dy);
  let ang = Math.atan2(7.32 * dx, dx * dx + dy * dy - 3.66 * 3.66); if (ang < 0) ang += Math.PI;
  let p = 1 / (1 + Math.exp(-(B.b0 + B.b1 * ang + B.b2 * dist)));
  if (sh.kind === 'header' || sh.body_part === 'head') p *= 0.8;
  if (opp && near(opp, sh.x, sh.y) < 2) p *= 0.7;
  return clamp(p, 0.005, 0.95);
}
function lane(p, opp) {
  const vx = p.x1 - p.x0, vy = p.y1 - p.y0, L2 = vx * vx + vy * vy; let best = 6;
  for (const [ox, oy] of opp) { const t = L2 === 0 ? 0 : clamp(((ox - p.x0) * vx + (oy - p.y0) * vy) / L2, 0, 1); best = Math.min(best, Math.hypot(ox - (p.x0 + t * vx), oy - (p.y0 + t * vy))); }
  return best;
}
function difficulty(p, opp) {
  const d = Math.hypot(p.x1 - p.x0, p.y1 - p.y0), press = near(opp, p.x0, p.y0), mark = near(opp, p.x1, p.y1), safe = lane(p, opp);
  const T = { distance: 30 * clamp((d - 2) / 48, 0, 1), pressure: 18 * clamp((5 - press) / 4, 0, 1), lane: 22 * clamp((4 - safe) / 6, 0, 1), marking: 15 * clamp((5 - mark) / 4, 0, 1), flight: (p.lofted ? 7 : 0) + (p.through_or_cross ? 5 : 0), weak_foot: p.weak_foot ? 8 : 0 };
  return clamp(Object.values(T).reduce((a, v) => a + Math.round(v), 0), 0, 100);
}
function quality(p, opp) {
  const gain = (p.x1 - p.x0) * (p.attack_x > 52.5 ? 1 : -1);
  return clamp((p.completed ? 1 : 0.25) * (0.2 + 0.4 * difficulty(p, opp) / 100 + 0.4 * clamp(gain / 30, 0, 1)), 0, 1);
}
function speed(samples, t, win) {
  const w = samples.filter((q) => Math.abs(q[0] - t) <= win).sort((a, b) => a[0] - b[0]);
  if (w.length < 2 || w[w.length - 1][0] === w[0][0]) return 0;
  const a = w[0], b = w[w.length - 1];
  return Math.hypot(b[1] - a[1], b[2] - a[2], b[3] - a[3]) / ((b[0] - a[0]) / 1000) * 3.6;
}
function pressure(x, y, opp, r) {
  const ds = opp.map(([a, b]) => Math.hypot(a - x, b - y));
  return 0.7 * clamp((r - Math.min(99, ...ds)) / (r - 1), 0, 1) + 0.3 * Math.min(ds.filter((d) => d <= r).length, 3) / 3;
}
const TS = { goal: 80, penalty: 70, red_card: 65, corner: 20, yellow_card: 15, foul: 10, pass: 5 };
function moment(events, minute, margin) {
  const sc = events.map((e) => e.type === 'shot' ? clamp(25 + 120 * (e.xg || 0), 25, 75) : (TS[e.type] || 0)).sort((a, b) => b - a);
  if (!sc.length) return 0;
  let v = sc[0] + Math.min(30, 10 * (sc.length - 1));
  if (minute >= 75) v *= 1.1; if (Math.abs(margin) <= 1) v *= 1.1;
  return clamp(v, 0, 100);
}
const r = (a, b) => a + (b - a) * rnd(), r1 = (v) => Math.round(v * 100) / 100;
const opps = (n) => Array.from({ length: n }, () => [r1(r(0, 105)), r1(r(0, 68))]);
const cases = [];
for (let i = 0; i < 12; i++) { const sh = { x: r1(r(60, 104)), y: r1(r(8, 60)), attack_x: 105, kind: ['open_play', 'header', 'free_kick', 'penalty', 'open_play'][i % 5], body_part: i % 3 === 0 ? 'head' : 'foot' }; const o = i % 2 ? opps(10) : null; cases.push({ metric: 'xg', input: { shot: sh, opponents: o }, expected: xg(sh, o) }); }
for (let i = 0; i < 4; i++) { const sh = { x: r1(r(1, 45)), y: r1(r(8, 60)), attack_x: 0, kind: 'open_play', body_part: 'foot' }; cases.push({ metric: 'xg', input: { shot: sh, opponents: opps(10) }, expected: 0 }); cases[cases.length - 1].expected = xg(sh, cases[cases.length - 1].input.opponents); }
for (let i = 0; i < 12; i++) { const x0 = r1(r(5, 95)), y0 = r1(r(5, 63)), p = { x0, y0, x1: r1(clamp(x0 + r(-20, 35), 1, 104)), y1: r1(r(3, 65)), attack_x: i % 4 === 3 ? 0 : 105, completed: rnd() < 0.8, lofted: rnd() < 0.3, through_or_cross: rnd() < 0.2, weak_foot: rnd() < 0.15 }; const o = opps(10); cases.push({ metric: 'pass_difficulty', input: { pass: p, opponents: o }, expected: difficulty(p, o) }); cases.push({ metric: 'pass_quality', input: { pass: p, opponents: o }, expected: quality(p, o) }); }
for (let i = 0; i < 4; i++) { const t = 9000 + i * 100, S = Array.from({ length: 8 }, (_, k) => [t - 600 + k * 150, r1(30 + k * 2.5 * (i + 1)), r1(30 + k), r1(k * 0.2)]); cases.push({ metric: 'ball_speed_kmh', input: { samples: S, event_time_ms: t, window_ms: 500 }, expected: speed(S, t, 500) }); }
for (let i = 0; i < 4; i++) { const o = opps(10), x = r1(r(10, 95)), y = r1(r(5, 63)), rad = [5, 5, 8, 3][i]; cases.push({ metric: 'pressure_index', input: { x, y, opponents: o, radius_m: rad }, expected: pressure(x, y, o, rad) }); }
const evs = [[{ type: 'goal' }], [{ type: 'shot', xg: 0.3 }, { type: 'corner' }], [{ type: 'foul' }, { type: 'yellow_card' }, { type: 'pass' }, { type: 'pass' }], [{ type: 'red_card' }, { type: 'foul' }], [{ type: 'shot', xg: 0.05 }], []];
for (let i = 0; i < evs.length; i++) { const minute = [10, 80, 50, 88, 30, 45][i], margin = [0, 3, 1, 2, 0, 0][i]; cases.push({ metric: 'moment_score', input: { events: evs[i], minute, goal_margin: margin }, expected: moment(evs[i], minute, margin) }); }
process.stdout.write(JSON.stringify({ generated_by: 'export_golden.cjs', tolerance: 0.001, cases }, null, 1) + '\n');
