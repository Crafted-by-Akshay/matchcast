// ---- unified console: match highlights (Watch, after full time). The key moments of the match, one card each: the goals, the red cards
// and the big chances (xG 0.25 or more, the line feed.js draws). A card has its commentary, why the moment mattered, the strategy
// (phase of play and shape) and the technique (shot type, final pass). Every number on a card is recounted from the stored Watch events
// by a second, separate pass, and a card that does not recount is held, not shown. Simulated: the rules write the cards in this page.
// Planned: the 3D replay of each moment. CM (feed.js) passes the events in; index.html shows the panel.
const HL = (() => {
  const MAX = 8, BIG = 0.25, RING_S = 40, PRE_S = 6, POST_S = 4, MIN_FRAMES = 4;   // a clip: 6 s of match clock before the event and 4 s after
  const RANK = { goal: 0, red_card: 1, big_chance: 2 }, LABEL = { goal: 'Goal', red_card: 'Red card', big_chance: 'Big chance' };
  let evs = [], sideOf = () => -1, nm = null, forms = [], cards = [], held = 0, more = 0, ring = [], clips = new Map();
  const f1 = (x) => (+x || 0).toFixed(1), f2 = (x) => (+x || 0).toFixed(2);
  const club = (s) => (s === 0 ? nm.home : nm.away);
  const dist = (e) => { const x = +e.x, y = +e.y; return Number.isFinite(x) && Number.isFinite(y) ? Math.hypot(Math.min(x, 105 - x), y - 34) : null; };   // metres to the nearer goal centre
  const before = (idx, fn) => evs.slice(0, idx).filter(fn);

  const reset = (names, formations) => { evs = []; nm = names || null; forms = formations || []; cards = []; held = 0; more = 0; ring = []; clips = new Map(); };
  const add = (batch) => {
    // the whole match is kept: the counts before a moment need every earlier event
    for (const e of batch || []) if (e && e.minute != null && e.type) evs.push(Object.assign({}, e, { side: sideOf(e.team) }));
    build();
  };

  // Watch's frames (about four a second, match clock in seconds): the last RING_S seconds are kept, and each key moment gets the frames from
  // PRE_S seconds before it to POST_S seconds after, counted from the latest frame when its event arrives (events come a second late at most)
  const frame = (f) => {
    const c = +(f && f.mclock);
    if (!Number.isFinite(c) || (ring.length && c <= ring[ring.length - 1].c)) return;   // a paused Watch repeats its clock: keep the frames that move it on
    ring.push({ c, f }); while (ring.length && ring[0].c < c - RING_S) ring.shift();
    for (const k of clips.values()) if (!k.done) { if (c >= k.from) k.frames.push(f); if (c >= k.until) k.done = true; }
  };
  // one clip per event: the event's place in the match list (a minute and a player can have two shots)
  const clipKey = (idx) => 'e' + idx;
  const clipFor = (idx) => {
    const key = clipKey(idx);
    if (!clips.has(key)) {
      const t = ring.length ? ring[ring.length - 1].c : 0;
      clips.set(key, { from: t - PRE_S, until: t + POST_S, frames: ring.filter((r) => r.c >= t - PRE_S).map((r) => r.f), done: false });
    }
    return clips.get(key);
  };
  const finish = () => { for (const k of clips.values()) k.done = true; build(); };
  // the frames are read when asked: a clip keeps filling until its last frame is in
  const withFrames = (c) => { const k = clips.get(c.key); return Object.assign({}, c, { frames: k ? k.frames.slice() : [], clipDone: !!(k && k.done) }); };

  // the next shot or goal by the same player: a shot that is followed by that player's goal is the goal's own shot
  const sameNext = (idx, p) => { for (let j = idx + 1; j < evs.length; j++) if (evs[j].player === p && (evs[j].type === 'shot' || evs[j].type === 'goal')) return +evs[j].minute - +evs[idx].minute <= 1 ? evs[j].type : null; return null; };

  // the candidates in match order, then the first MAX by rank. A shot that is the goal's own shot is not a card of its own
  const pick = () => {
    const out = [];
    evs.forEach((e, idx) => {
      if (e.side < 0) return;
      if (e.type === 'goal' && !e.ownGoal) out.push({ kind: 'goal', e, idx });
      else if (e.type === 'red_card') out.push({ kind: 'red_card', e, idx });
      else if (e.type === 'shot' && (+e.xg || 0) >= BIG && sameNext(idx, e.player) !== 'goal') out.push({ kind: 'big_chance', e, idx });
    });
    const ranked = out.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.idx - b.idx);
    more = Math.max(0, ranked.length - MAX);
    return ranked.slice(0, MAX).sort((a, b) => a.idx - b.idx);
  };

  // the numbers of a card, counted from the events before its own index
  const figures = (c) => {
    const { e, idx } = c, s = e.side, m = +e.minute;
    // an own goal counts for the side the engine credits (its team field), as the Watch score does
    const goals = (k) => evs.slice(0, k + 1).filter((x) => x.type === 'goal');
    const scoreAt = (k) => [0, 1].map((t) => goals(k).filter((x) => x.side === t).length);
    const shotsOf = (k) => before(k, (x) => x.type === 'shot' && x.side === s);
    const lastPass = before(idx, (x) => x.type === 'pass' && x.side === s && x.minute >= m - 1 && typeof x.x0 === 'number' && typeof x.x1 === 'number' && typeof x.y0 === 'number' && typeof x.y1 === 'number').pop() || null;
    // a goal's shot: the scorer's own last shot in the minute before the goal, else the side's; no such record means no shot type
    const recent = (x) => x.type === 'shot' && x.side === s && x.minute >= m - 1 && x.minute <= m;
    const shot = c.kind === 'goal' ? evs.slice(0, idx + 1).reverse().find((x) => recent(x) && x.player === e.player) || evs.slice(0, idx + 1).reverse().find(recent) || null : e;
    return {
      minute: m, score: scoreAt(idx), prev: idx ? scoreAt(idx - 1) : [0, 0],
      passes: before(idx, (x) => x.type === 'pass' && x.side === s && x.minute >= m - 1).length,
      turn: before(idx, (x) => (x.type === 'possession_change' || x.type === 'turnover') && x.side === s && x.minute >= m - 1).length > 0,
      reds: before(idx + 1, (x) => x.type === 'red_card' && x.side === s).length,
      shots: shotsOf(idx).length, xg: +shotsOf(idx).reduce((a, x) => a + (+x.xg || 0), 0).toFixed(2),
      shot, dist: shot ? dist(shot) : null,
      lastPass: lastPass ? Math.hypot(+lastPass.x1 - +lastPass.x0, +lastPass.y1 - +lastPass.y0) : null,
    };
  };
  // the recount: the same numbers again, from the raw list by minute (not by index), so a wrong index or count does not pass unnoticed
  const recount = (c) => {
    const s = c.e.side, m = +c.e.minute;
    const earlier = (x) => x.minute < m || (x.minute === m && evs.indexOf(x) < c.idx);
    const scored = (t) => evs.filter((x) => x.type === 'goal' && x.side === t && earlier(x)).length + (c.kind === 'goal' && c.e.side === t ? 1 : 0);
    const shots = evs.filter((x) => x.type === 'shot' && x.side === s && earlier(x));
    const passes = evs.filter((x) => x.type === 'pass' && x.side === s && x.minute >= m - 1 && x.minute <= m && earlier(x)).length;
    return { score: [scored(0), scored(1)], passes, shots: shots.length, xg: +shots.reduce((a, x) => a + (+x.xg || 0), 0).toFixed(2) };
  };
  const same = (f, r) => f.score.join() === r.score.join() && f.passes === r.passes && f.shots === r.shots && f.xg === r.xg;

  const shapeOf = (idx, s) => { const t = before(idx, (x) => x.type === 'tactical_change' && x.side === s).pop(); return (t && t.formation) || forms[s] || null; };

  const card = (c) => {
    const { e, idx, kind } = c, s = e.side, f = figures(c), who = e.player || 'A player', tc = club(s);
    const score = f.score.join('-');
    const phase = f.turn ? 'Counter-attack after winning the ball' : f.passes >= 6 ? 'Patient build-up: ' + f.passes + ' passes in the last minute' : 'Direct: ' + f.passes + (f.passes === 1 ? ' pass' : ' passes') + ' in the last minute';
    const count = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
    const shotTech = (sh) => (!sh ? 'Shot type not recorded' : sh.kind === 'penalty' ? 'Penalty' : sh.kind === 'header' ? 'Header' : dist(sh) != null ? 'Shot from ' + f1(dist(sh)) + ' m' : 'Shot type not recorded');
    let commentary, why, technique, insight;
    if (kind === 'goal') {
      commentary = f.minute + "' " + who + ' scores for ' + tc + '. ' + nm.home + ' ' + score + ' ' + nm.away + ' after the goal.';
      if (f.prev[0] + f.prev[1] === 0) why = 'Opens the scoring.';
      else if (f.prev[0] === f.prev[1]) why = 'Puts ' + tc + ' ahead, ' + score + '.';
      else if (f.score[0] === f.score[1]) why = 'Levels it at ' + score + '.';
      else why = 'Makes it ' + score + '.';
      technique = shotTech(f.shot) + (f.lastPass != null ? '. Last pass by the side before it: ' + f1(f.lastPass) + ' m' : '');
      insight = tc + ' had ' + count(f.shots, 'shot') + ' and ' + f2(f.xg) + ' xG before this goal.';
    } else if (kind === 'red_card') {
      commentary = f.minute + "' " + who + ' is sent off for ' + tc + '.';
      why = tc + ' are down to ' + (11 - f.reds) + ' men.';
      technique = 'Dismissal';
      insight = tc + ' had ' + count(f.shots, 'shot') + ' and ' + f2(f.xg) + ' xG before this dismissal.';
    } else {
      const outcome = e.fate === 'goal' ? ' and scores' : e.fate === 'save' ? ' and the keeper saves' : e.fate === 'miss' ? ' and misses' : '';
      const best = Math.max(0, ...before(idx, (x) => x.type === 'shot').map((x) => +x.xg || 0));
      commentary = f.minute + "' " + who + ' gets a clear chance for ' + tc + (f.dist == null ? '' : ' from ' + f1(f.dist) + ' m') + outcome + '.';
      why = 'A ' + f2(e.xg) + ' xG chance' + (+e.xg > best ? ', the best of the match so far.' : '.');
      technique = shotTech(e);
      insight = 'Shot ' + (f.shots + 1) + ' for ' + tc + ', with ' + f2(f.xg) + ' xG before it.';
    }
    const r = recount(c);
    clipFor(idx);
    return { id: 'hl' + idx, kind, key: clipKey(idx), label: LABEL[kind], minute: f.minute, club: tc, title: LABEL[kind] + ' · ' + who, commentary, why, strategy: { phase, shape: shapeOf(idx, s) }, technique, insight, numbers: r, checked: same(f, r) };
  };

  // every candidate becomes a card; a card that does not recount is held (counted, never shown)
  const build = () => {
    if (!nm) return;
    cards = []; held = 0;
    for (const c of pick()) { const k = card(c); if (k.checked) cards.push(k); else held++; }
  };

  return {
    reset, add, frame, finish, cards: () => cards.map(withFrames), get held() { return held; }, get more() { return more; }, get count() { return cards.length; },
    // the clips to play in 3D, in match order: a card with at least MIN_FRAMES frames
    plan: () => cards.map(withFrames).filter((c) => c.frames.length >= MIN_FRAMES).map((c) => ({ id: c.id, title: c.title, commentary: c.commentary, why: c.why, insight: c.insight, frames: c.frames })),
    set side(fn) { sideOf = fn || (() => -1); },
  };
})();
if (typeof window !== 'undefined') window.HL = HL;
