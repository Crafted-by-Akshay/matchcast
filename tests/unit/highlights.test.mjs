// Unit checks for apps/unified/highlights.js (HL): the candidates, the cards, and the recount that holds a card.
// Run: node --test tests/unit/highlights.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'apps', 'unified', 'highlights.js'), 'utf8');

function load() {
  const window = {};
  vm.runInNewContext(src, { window, Math, Number, Array, Object, String, Set, Map });
  const HL = window.HL;
  HL.side = (team) => (team === 'ARG' ? 0 : team === 'BRA' ? 1 : -1);
  HL.reset({ home: 'Argentina', away: 'Brazil' }, ['4-3-3', '4-2-3-1']);
  // JSON copies: the cards come from the vm realm, and deepStrictEqual compares prototypes
  return { get more() { return HL.more; }, add: (b) => HL.add(b), frame: (f) => HL.frame(f), finish: () => HL.finish(), plan: () => JSON.parse(JSON.stringify(HL.plan())), cards: () => JSON.parse(JSON.stringify(HL.cards())), get count() { return HL.count; }, get held() { return HL.held; } };
}

const shot = (minute, team, player, xg, extra = {}) => ({ type: 'shot', minute, team, player, xg, x: 92, y: 34, fate: 'miss', ...extra });
const goal = (minute, team, player, extra = {}) => ({ type: 'goal', minute, team, player, ...extra });
const pass = (minute, team, player, extra = {}) => ({ type: 'pass', minute, team, player, ...extra });
const turnover = (minute, team) => ({ type: 'turnover', minute, team });

test('a goal becomes a card with commentary, why, strategy, technique and an insight', () => {
  const HL = load();
  HL.add([
    pass(25, 'ARG', 'Messi'), pass(25.5, 'ARG', 'Di Maria'), pass(26, 'ARG', 'Messi', { x0: 10, y0: 34, x1: 28, y1: 34 }),
    shot(26.5, 'ARG', 'Lautaro', 0.31, { fate: 'goal' }),
    goal(27, 'ARG', 'Lautaro'),
  ]);
  const [c] = HL.cards();
  assert.equal(c.kind, 'goal');
  assert.equal(c.minute, 27);
  assert.match(c.commentary, /scores for Argentina\. Argentina 1-0 Brazil/);
  assert.equal(c.why, 'Opens the scoring.');
  assert.match(c.strategy.phase, /in the last minute/);
  assert.match(c.technique, /Last pass by the side before it: 18\.0 m/);
  assert.equal(c.insight, 'Argentina had 1 shot and 0.31 xG before this goal.');
  assert.equal(c.checked, true);
  assert.equal(HL.held, 0);
});

test('a big chance without a goal is a card; the shot that is the goal is not counted twice', () => {
  const HL = load();
  HL.add([
    shot(40, 'BRA', 'Vini', 0.4),
    shot(41, 'ARG', 'Lautaro', 0.3, { fate: 'goal' }),
    goal(41, 'ARG', 'Lautaro'),
  ]);
  const cards = HL.cards();
  assert.deepEqual(cards.map((c) => c.kind), ['big_chance', 'goal']);
  assert.match(cards[0].why, /best of the match so far/);
  assert.match(cards[0].commentary, /Vini gets a clear chance for Brazil/);
});

test('a red card says how many are left, from the dismissals counted so far', () => {
  const HL = load();
  HL.add([{ type: 'red_card', minute: 60, team: 'BRA', player: 'Casemiro' }]);
  const [c] = HL.cards();
  assert.equal(c.kind, 'red_card');
  assert.equal(c.why, 'Brazil are down to 10 men.');
});

test('events of no known side and empty input make no cards', () => {
  const HL = load();
  HL.add([goal(10, 'XXX', 'Nobody'), null, { type: 'pass' }]);
  assert.equal(HL.count, 0);
  HL.add([]);
  assert.equal(HL.count, 0);
});

test('at most eight cards, in match order, goals first when the list is full', () => {
  const HL = load();
  const batch = [];
  for (let m = 1; m <= 12; m++) batch.push(shot(m * 5, 'ARG', 'Lautaro', 0.3, { fate: 'miss' }));
  batch.push(goal(70, 'BRA', 'Vini'));
  HL.add(batch);
  const cards = HL.cards();
  assert.equal(cards.length, 8);
  assert.ok(cards.some((c) => c.kind === 'goal'));
  assert.equal(HL.more, 5);   // 13 candidates, 8 shown
  const mins = cards.map((c) => c.minute);
  assert.deepEqual(mins, [...mins].sort((a, b) => a - b));
});

test('a key moment keeps the frames from 6 s before it to 4 s after, counted from the match clock', () => {
  const HL = load();
  const frames = (from, to) => { const out = []; for (let c = from; c <= to + 1e-9; c += 0.25) out.push({ mclock: +c.toFixed(2), score: [0, 0] }); return out; };
  for (const f of frames(0, 60)) HL.frame(f);
  HL.add([{ type: 'red_card', minute: 1, team: 'BRA', player: 'Casemiro' }]);
  for (const f of frames(60.25, 70)) HL.frame(f);
  const [c] = HL.cards();
  assert.equal(c.frames.length, 41);                  // 54.00 to 64.00 at a quarter second
  assert.equal(c.frames[0].mclock, 54);
  assert.equal(c.frames.at(-1).mclock, 64);
  assert.equal(c.clipDone, true);
  assert.equal(HL.plan().length, 1);
});

test('a clip too short to play is not in the plan, and finish() closes what is still open', () => {
  const HL = load();
  HL.frame({ mclock: 100, score: [0, 0] });
  HL.add([{ type: 'red_card', minute: 2, team: 'BRA', player: 'Casemiro' }]);
  assert.equal(HL.plan().length, 0);                  // one frame so far
  HL.finish();
  assert.equal(HL.cards()[0].clipDone, true);
});

test('a shot far before a later goal by the same player is still its own card', () => {
  const HL = load();
  HL.add([shot(20, 'ARG', 'Lautaro', 0.4), goal(70, 'ARG', 'Lautaro')]);
  assert.deepEqual(HL.cards().map((c) => c.kind), ['big_chance', 'goal']);
  assert.equal(HL.cards()[1].technique, 'Shot type not recorded');   // no shot record in the goal's minute
});

test('two shots by one player in one minute get their own clips', () => {
  const HL = load();
  const frames = (from, to) => { const out = []; for (let c = from; c <= to + 1e-9; c += 0.25) out.push({ mclock: +c.toFixed(2), score: [0, 0], half: 1, ht: false, over: false, stats: {}, players: [], officials: [], ball: [0, 0, 0] }); return out; };
  for (const f of frames(0, 30)) HL.frame(f);
  HL.add([shot(12, 'BRA', 'Vini', 0.3), shot(12, 'BRA', 'Vini', 0.5)]);
  for (const f of frames(30.25, 40)) HL.frame(f);
  const [a, b] = HL.cards();
  assert.notEqual(a.key, b.key);
  assert.ok(a.frames.length >= 4 && b.frames.length >= 4);
});

test('an own goal counts for the side it is credited to in the score', () => {
  const HL = load();
  HL.add([{ type: 'goal', minute: 10, team: 'ARG', player: 'Own', ownGoal: true }, goal(30, 'BRA', 'Vini')]);
  assert.match(HL.cards()[0].commentary, /Argentina 1-1 Brazil/);
});

test('a turnover to the side just before a goal reads as a counter-attack', () => {
  const HL = load();
  HL.add([turnover(29, 'ARG'), pass(29.5, 'ARG', 'Messi'), pass(29.7, 'ARG', 'Di Maria'), goal(30, 'ARG', 'Lautaro')]);
  assert.match(HL.cards()[0].strategy.phase, /Counter-attack after winning the ball/);
});

test('a paused Watch repeats its clock; the clip keeps only the frames that move it on', () => {
  const HL = load();
  HL.frame({ mclock: 100, score: [0, 0] });
  HL.frame({ mclock: 100, score: [0, 0] });
  HL.frame({ mclock: 100.25, score: [0, 0] });
  HL.add([{ type: 'red_card', minute: 2, team: 'BRA', player: 'Casemiro' }]);
  HL.finish();
  assert.equal(HL.cards()[0].frames.length, 2);
});
