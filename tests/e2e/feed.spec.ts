import { test, expect, type Frame, type Page } from './fixtures';
import { collectErrors, openShell, stepSim, viewFrame } from './helpers';

// Experience lane, continuous commentary feed (apps/unified/feed.js, embed/feed.js): a seeded Watch match keeps a line on screen,
// Broadcast draws the same feed, Ask counts from the event log, and a talk order always gets a reply in the chat.
declare const post: (view: string, msg: unknown) => void; // top-level function of the shell
declare const AG: any;
declare const VC: any;

async function openWatch(page: Page, query = '?seed=2026&speed=4'): Promise<Frame> {
  await openShell(page, 'watch', query);
  const f = await viewFrame(page, 'watch');
  await expect.poll(() => f.evaluate(() => !!((window as any).__mc?.players.length && document.getElementById('load')!.hidden)).catch(() => false), { timeout: 240_000, message: 'Watch never finished loading' }).toBe(true);
  return f;
}

test('Watch keeps a commentary line on screen while the match runs', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  const f = await openWatch(page);
  // the match clock runs on the sim's own steps, so the test drives it the way the other Watch specs do
  for (let i = 0; i < 60 && (await f.evaluate(() => (window as any).MCFeed.shown)) < 4; i++) await stepSim(f, 3000);
  expect(await f.evaluate(() => (window as any).MCFeed.shown), 'the feed showed at least four lines').toBeGreaterThanOrEqual(4);
  const top = await f.evaluate(() => (window as any).MCFeed.top);
  expect(top.length, 'the newest line is shown beside the match').toBeGreaterThan(10);
  await f.click('#mcf-tog');
  const rows = await f.locator('#mcf-list li').allTextContents();
  expect(rows.some((t) => /Rules/.test(t)), 'each line says it was written by the rules, checked in page').toBe(true);
  expect(rows.some((t) => /Producer › Analyst › Narrator › Verifier/.test(t)), 'each line names the agents that made it').toBe(true);
  expect(rows.some((t) => /^\d+'/.test(t)), 'each line has a match minute').toBe(true);
  expect(errs, 'no page errors').toEqual([]);
});

test('Ask counts from the event log and says so', async ({ page }) => {
  test.setTimeout(300_000);
  const f = await openWatch(page);
  for (let i = 0; i < 60 && (await page.evaluate(() => AG.run && AG.run.events.some((e: any) => e.type === 'pass' && e.player))) !== true; i++) await stepSim(f, 3000);
  // a shell-side check of the rules answerer on the run the Watch match is writing
  const answer = await page.evaluate(() => {
    const ev = AG.run.events.find((e: any) => e.type === 'pass' && e.player);
    return ev ? AG.ask('how many passes has ' + ev.player + ' made?') : null;
  });
  expect(answer, 'a pass has been logged').not.toBeNull();
  expect(answer.verdict).toBe('verified');
  expect(answer.text).toMatch(/has \d+ pass(es)? by \d+'/);
  expect(answer.citations.length).toBeGreaterThan(0);
  // "scored" is a goal count, and a word that only contains a count word ("goalkeeper") is not one
  const player = await page.evaluate(() => AG.run.events.find((e: any) => e.type === 'pass' && e.player).player);
  const scored = await page.evaluate((n) => AG.ask('how many goals has ' + n + ' scored?'), player);
  expect(scored.text).toMatch(/has \d+ goals? by \d+'/);
  const keeper = await page.evaluate(() => AG.ask('who is the goalkeeper for ' + AG.run.names.home + '?'));
  expect(keeper.verdict).toBe('abstained');
});

test('Broadcast draws the same feed', async ({ page }) => {
  test.setTimeout(300_000);
  await openShell(page, 'broadcast', '?seed=2026');
  const f = await viewFrame(page, 'broadcast');
  await expect.poll(() => f.evaluate(() => !!document.getElementById('mcf')), { timeout: 240_000 }).toBe(true);
  // the shell also pushes its own feed, so post again until the whole frame state matches
  const lines = [
    { id: 'l1', minute: 3, text: 'Shot for Thames Rovers. xG 0.12.', kind: 'shot', tone: '', source: 'rules', label: 'Rules · recounted', chain: ['Producer', 'Analyst', 'Narrator', 'Verifier'] },
    { id: 'l2', minute: 4, text: 'GOAL! A header from the corner.', kind: 'goal', tone: 'big', source: 'live', label: 'Live agents · verified', chain: ['Producer', 'Analyst', 'Narrator', 'Verifier', 'Live agents'] },
  ];
  await expect.poll(async () => {
    await page.evaluate((items) => post('broadcast', { src: 'matchcast-shell', type: 'feed-lines', items }), lines);
    return f.evaluate(() => ({
      top: document.getElementById('mcf-top')!.textContent,
      rows: document.querySelectorAll('#mcf-list li').length,
      big: document.querySelector('#mcf-list li.big')?.textContent ?? '',
    }));
  }, { timeout: 60_000, message: 'the frame never drew the posted lines' }).toMatchObject({
    top: expect.stringContaining('GOAL! A header from the corner.'),
    rows: 2,
    big: expect.stringContaining('Live agents'),
  });
  await f.click('#mcf-tog');
  await expect(f.locator('#mcf-list')).toBeVisible();
});

test('a talk order always gets a reply in the chat, checked or not', async ({ page }) => {
  test.setTimeout(300_000);
  const f = await openWatch(page);
  await f.evaluate(() => { const w = window as any; w.__tp = w.__mc.players[0]; w.mcTalkApi(w.__tp, 'press higher'); });
  // no agent api in this test: the rules fallback answers in the chat, inside the role bounds, rather than staying silent
  await expect.poll(() => f.evaluate(() => (window as any).__mcTalkLog((window as any).__tp).length), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(f.locator('#tk-note')).toContainText('Rules fallback', { timeout: 20_000 });
});

test('a typed question with no agent api says plainly that it cannot answer here, and gives no "I hear you"', async ({ page }) => {
  test.setTimeout(300_000);
  const f = await openWatch(page);
  await f.evaluate(() => { const w = window as any; w.__tp = w.__mc.players[0]; w.mcTalkApi(w.__tp, 'Where should you pass next?'); });
  await expect.poll(() => f.evaluate(() => (window as any).__mcTalkLog((window as any).__tp).join('|')), { timeout: 20_000 }).toContain("can't act on or answer that here");
  expect(await f.evaluate(() => (window as any).__mcTalkLog((window as any).__tp).join('|'))).not.toContain('I hear you');
});

test('the booth calls the play between the key events, counted from the actions', async ({ page }) => {
  await openShell(page, 'watch', '?seed=2026');
  const lines = await page.evaluate(() => {
    const pass = (minute: number, team: string, player: string) => ({ minute, type: 'pass', team, player });
    CM.reset('booth', { home: 'Ridgeview', away: 'Thames Rovers', hk: 'H', ak: 'A' });
    CM.fromWatch([pass(1, 'H', 'Ana'), pass(1.1, 'H', 'Ben'), pass(1.2, 'H', 'Cal'), pass(1.3, 'H', 'Ana'), pass(1.4, 'H', 'Ben'), { minute: 1.6, type: 'slide_tackle', team: 'A', player: 'Dev' }], []);
    CM.fromWatch([pass(1.7, 'A', 'Eli')], []);   // 0.1 minutes after the last call, past the 0.05 gap: the carrier is named
    CM.fromWatch([pass(2.2, 'A', 'Eli'), pass(2.3, 'A', 'Fay')], []);
    return CM.view().filter((l: any) => l.kind === 'play').map((l: any) => ({ minute: l.minute, text: l.text, label: l.label }));
  });
  expect(lines).toEqual([
    { minute: 1.6, text: 'Dev challenges for Thames Rovers.', label: 'Rules · recounted' },
    { minute: 1.7, text: 'Eli plays it on for Thames Rovers.', label: 'Rules · recounted' },
    { minute: 2.3, text: 'Thames Rovers keep the ball: 3 passes, last from Fay.', label: 'Rules · recounted' },
  ]);
});

test('each feed line keeps the persona it was written under', async ({ page }) => {
  await openShell(page, 'broadcast', '?seed=2026');
  const personas = await page.evaluate(() => {
    CM.reset('lens', { home: 'Ridgeview', away: 'Thames Rovers', hk: 'H', ak: 'A' });
    CM.setPersona('analyst');
    CM.api('Sharp shot from the edge.', 3, 'shot', 'lens-1');
    CM.setPersona('club:ridgeview');
    CM.api('Ridgeview push forward.', 4, 'shot', 'lens-2');
    CM.setPersona('fan');   // the casual default, the name the Watch chip sends
    CM.api('Quiet spell.', 5, 'summary', 'lens-3');
    return CM.view().filter((l: any) => l.source === 'live').map((l: any) => [l.text, l.persona]);
  });
  expect(personas).toEqual([
    ['Sharp shot from the edge.', 'analyst'],
    ['Ridgeview push forward.', 'club:ridgeview'],
    ['Quiet spell.', 'casual'],
  ]);
});

test('a play line is never overwritten by an api line, and a run of passes stops at the other side', async ({ page }) => {
  await openShell(page, 'watch', '?seed=2026');
  const names = { home: 'Ridgeview', away: 'Thames Rovers', hk: 'H', ak: 'A' };
  const upgrade = await page.evaluate((nm) => {
    const pass = (minute: number, team: string, player: string) => ({ minute, type: 'pass', team, player });
    CM.reset('upgrade', nm);
    CM.fromWatch([pass(34, 'H', 'Ana')], [{ id: 'g34', minute: 34, type: 'goal', title: 'Goal for Ridgeview', why: '' }]);
    CM.api('Ana scores for Ridgeview, a sweeping finish.', 34, 'goal', 'g34-api');
    return CM.view().filter((l: any) => l.kind === 'goal' || l.kind === 'play').map((l: any) => [l.kind, l.source, l.text]);
  }, names);
  expect(upgrade).toEqual([
    ['goal', 'live', 'Ana scores for Ridgeview, a sweeping finish.'],
    ['play', 'rules', 'Ana plays it on for Ridgeview.'],
  ]);
  const run = await page.evaluate((nm) => {
    const pass = (minute: number, team: string, player: string) => ({ minute, type: 'pass', team, player });
    CM.reset('run', nm);
    CM.fromWatch([pass(10, 'H', 'Ana'), { minute: 10.05, type: 'interception', team: 'A', player: 'Eli' }, pass(10.1, 'H', 'Ben'), pass(10.2, 'H', 'Cal')], []);
    return CM.view().filter((l: any) => l.kind === 'play').map((l: any) => l.text);
  }, names);
  expect(run).toEqual(['Cal plays it on for Ridgeview.']);   // the interception ended Ana's run, so Ben and Cal are two passes, not three
});

test('a build-up of three passes is a hot line, and a single pass is calm', async ({ page }) => {
  await openShell(page, 'watch', '?seed=2026');
  const plays = await page.evaluate(() => {
    const pass = (minute: number, team: string, player: string) => ({ minute, type: 'pass', team, player });
    CM.reset('booth', { home: 'Ridgeview', away: 'Thames Rovers', hk: 'H', ak: 'A' });
    CM.fromWatch([pass(1, 'H', 'Ana'), pass(1.1, 'H', 'Ben'), pass(1.2, 'H', 'Cal')], []);
    CM.fromWatch([pass(2.5, 'A', 'Eli')], []);
    return CM.view().filter((l: any) => l.kind === 'play').map((l: any) => ({ text: l.text, tone: l.tone }));
  });
  expect(plays).toEqual([
    { text: 'Ridgeview keep the ball: 3 passes, last from Cal.', tone: 'hot' },
    { text: 'Eli plays it on for Thames Rovers.', tone: '' },
  ]);
});

test('a possession change is called at once, even inside the gap', async ({ page }) => {
  await openShell(page, 'watch', '?seed=2026');
  const plays = await page.evaluate(() => {
    const pass = (minute: number, team: string, player: string) => ({ minute, type: 'pass', team, player });
    CM.reset('booth', { home: 'Ridgeview', away: 'Thames Rovers', hk: 'H', ak: 'A' });
    CM.fromWatch([pass(3, 'H', 'Ana')], []);
    CM.fromWatch([pass(3.01, 'A', 'Eli')], []);   // 0.01 minutes later: inside the gap, but the ball has changed side
    CM.fromWatch([pass(3.02, 'A', 'Eli')], []);   // same side, inside the gap: no new line
    return CM.view().filter((l: any) => l.kind === 'play').map((l: any) => l.text);
  });
  expect(plays).toEqual(['Ana plays it on for Ridgeview.', 'Eli plays it on for Thames Rovers.']);
});

test('a run of passes is counted across calls, within one minute', async ({ page }) => {
  await openShell(page, 'watch', '?seed=2026');
  const text = await page.evaluate(() => {
    const names = ['Ana', 'Ben', 'Cal'];
    const pass = (i: number) => ({ minute: 5 + i * 0.05, type: 'pass', team: 'H', player: names[i % 3] });
    CM.reset('span', { home: 'Ridgeview', away: 'Thames Rovers', hk: 'H', ak: 'A' });
    CM.fromWatch([0, 1, 2, 3, 4].map(pass), []);     // one call at 5.20, after five passes (the newest pass is at 5.20)
    CM.fromWatch([5, 6, 7, 8].map(pass), []);        // 5.25 to 5.40: the call at 5.40 is 0.2 minutes after the first (the gap is 0.05), and counts all nine passes from 5.00
    return CM.view().filter((l: any) => l.kind === 'play').map((l: any) => l.text);
  });
  expect(text.at(-1)).toBe('Ridgeview keep the ball: 9 passes, last from Cal.');
});

test('the pre-match build-up is a play-by-play call and a colour line, each on its own voice', async ({ page }) => {
  await openShell(page, 'watch', '?seed=2026');
  await page.evaluate(() => { VC.set(true); });
  const spoken = await page.evaluate(async () => {
    const calls: [string, string][] = [];
    const say = VC.say;
    VC.say = (text: string, o: any) => { calls.push([text, o.role]); return say(text, o); };
    CM.reset('kick', { home: 'Ridgeview', away: 'Thames Rovers', hk: 'H', ak: 'A' });
    await new Promise((r) => setTimeout(r, 600));
    VC.say = say;
    return { calls, lines: CM.view().filter((l: any) => l.kind === 'buildup').map((l: any) => ({ text: l.text, speaker: l.speaker })) };
  });
  expect(spoken.lines.map((l) => l.speaker), 'the build-up has a call, then a colour line').toEqual(['pbp', 'colour']);
  expect(spoken.lines[0].text).toContain('Ridgeview');
  // the Watch frame may post its own batches meanwhile, so only the two build-up lines are checked
  const booth = spoken.calls.filter(([text]) => spoken.lines.some((l) => l.text === text));
  expect(booth, 'each line is spoken once, on the voice its speaker has').toEqual([
    [spoken.lines[0].text, 'playByPlay'],
    [spoken.lines[1].text, 'analyst'],
  ]);
});

test('a quiet stretch gets a booth exchange drawn from the match state, and not again straight away', async ({ page }) => {
  await openShell(page, 'watch', '?seed=2026');
  const out = await page.evaluate(() => {
    CM.reset('fill', { home: 'Ridgeview', away: 'Thames Rovers', hk: 'H', ak: 'A' });
    CM.fromWatch([{ minute: 1, type: 'pass', team: 'H', player: 'Ana' }, { minute: 1.5, type: 'pass', team: 'H', player: 'Ben' }, { minute: 2, type: 'pass', team: 'H', player: 'Cal' }], []);
    CM.fill(Date.now() + 9000);   // nine seconds of real time with no line
    const first = CM.view().filter((l: any) => l.kind === 'filler').map((l: any) => ({ speaker: l.speaker, text: l.text }));
    CM.fill(Date.now());         // straight after: the booth is still talking, so nothing new
    return { first, after: CM.view().filter((l: any) => l.kind === 'filler').length };
  });
  expect(out.first.map((l) => l.speaker), 'a play-by-play line, then a colour line').toEqual(['pbp', 'colour']);
  expect(out.first[0].text, 'the play-by-play line counts the passes from the events').toContain('Ridgeview: 3 passes in the last two minutes.');
  expect(out.after).toBe(2);
});

test('a silence that goes on gets a fresh booth exchange every few seconds, and no line repeats its last one', async ({ page }) => {
  await openShell(page, 'watch', '?seed=2026');
  const out = await page.evaluate(() => {
    CM.reset('long', { home: 'Ridgeview', away: 'Thames Rovers', hk: 'H', ak: 'A' });
    CM.fromWatch([{ minute: 1, type: 'pass', team: 'H', player: 'Ana' }], []);
    const t0 = Date.now();
    // twelve seconds of real time with no new action: the booth keeps talking, and each exchange is worded fresh
    for (let s = 5; s <= 12; s += 1) CM.fill(t0 + s * 1000);
    const fillers = CM.view().filter((l: any) => l.kind === 'filler').map((l: any) => l.text);
    return { count: fillers.length, texts: fillers };
  });
  expect(out.count, 'a fill every 4 s of silence: two exchanges in 12 s').toBeGreaterThanOrEqual(4);
  for (let i = 1; i < out.texts.length; i++) expect(out.texts[i], 'the booth does not repeat its last line').not.toBe(out.texts[i - 1]);
});

test('before any action the booth talks from the kick-off score, and names no player', async ({ page }) => {
  await openShell(page, 'watch', '?seed=2026');
  const out = await page.evaluate(() => {
    CM.reset('start', { home: 'Ridgeview', away: 'Thames Rovers', hk: 'H', ak: 'A' });
    CM.fill(Date.now() + 9000);   // nine seconds of real time, and not one event yet
    return CM.view().filter((l: any) => l.kind === 'filler').map((l: any) => ({ speaker: l.speaker, text: l.text }));
  });
  expect(out.map((l) => l.speaker), 'a play-by-play line, then a colour line').toEqual(['pbp', 'colour']);
  expect(out[0].text, 'the score is the kick-off score').toContain('Ridgeview 0–0 Thames Rovers');
});

test('a live booth line keeps the speaker its persona gives it', async ({ page }) => {
  await openShell(page, 'watch', '?seed=2026');
  // one synchronous step: the Watch frame may reset the feed between awaits, so the lines are read straight after they are added
  const lines = await page.evaluate(() => {
    CM.reset('live', { home: 'Ridgeview', away: 'Thames Rovers', hk: 'H', ak: 'A' });
    CM.api('Ana wins it back and the crowd rises.', 4, 'line', 'booth-colour-1', 'colour');
    CM.api('Ben drives at the box.', 4.2, 'line', 'booth-pbp-1', 'pbp');
    return CM.view().filter((l: any) => l.source === 'live').map((l: any) => ({ text: l.text, speaker: l.speaker }));
  });
  expect(lines).toEqual([
    { text: 'Ana wins it back and the crowd rises.', speaker: 'colour' },
    { text: 'Ben drives at the box.', speaker: 'pbp' },
  ]);
});

test('the booth speaks each new feed line once, play-by-play and colour on different voices', async ({ page }) => {
  await page.route(/\/(watch|broadcast)\/index\.html/, (rt) => rt.abort());   // no 3D view: its own kick-off would reset the feed (and add a pre-match build-up) under the test
  await openShell(page, 'watch', '?seed=2026');
  await page.evaluate(() => { VC.set(true); });
  const spoken = await page.evaluate(async () => {
    const calls: [string, string][] = [];
    const say = VC.say;
    VC.say = (text: string, o: any) => { calls.push([text, o.role]); return say(text, o); };
    const pass = (minute: number, team: string, player: string) => ({ minute, type: 'pass', team, player });
    CM.reset('voice', { home: 'Ridgeview', away: 'Thames Rovers', hk: 'H', ak: 'A' });
    CM.fromWatch([pass(1, 'H', 'Ana'), { minute: 1.6, type: 'slide_tackle', team: 'A', player: 'Dev' }], []);
    CM.api('Dev tries to win it back and the referee waves play on.', 1.6, 'summary', 'voice-1');
    await new Promise((r) => setTimeout(r, 600));
    VC.say = say;
    return calls;
  });
  const play = spoken.filter(([t]) => /Dev challenges/.test(t));
  const colour = spoken.filter(([t]) => /referee waves/.test(t));
  expect(play, 'the play line is spoken once').toEqual([['Dev challenges for Thames Rovers.', 'playByPlay']]);
  expect(colour, 'the colour line is spoken once, by the analyst voice').toEqual([['Dev tries to win it back and the referee waves play on.', 'analyst']]);
});

test('Voice on starts the crowd bed, labelled simulated, and Voice off stops it', async ({ page }) => {
  await openShell(page, 'watch', '?seed=2026');
  await page.evaluate(() => VC.set(false));
  await page.click('#voice-btn');
  await expect(page.locator('#voice-src')).toContainText('crowd bed (simulated)');
  expect(await page.evaluate(() => VC.crowd)).toBe(true);
  await page.click('#voice-btn');
  expect(await page.evaluate(() => VC.crowd)).toBe(false);
});

test('the commentary card says Sound is off until Voice is on', async ({ page }) => {
  await openShell(page, 'broadcast', '?seed=2026');
  const f = await viewFrame(page, 'broadcast');
  await expect.poll(() => f.evaluate(() => !!document.getElementById('mcf')), { timeout: 240_000 }).toBe(true);
  // Voice is off by default, so the card must learn that from the shell (the hint is hidden until then)
  await expect(f.locator('#mcf-sound')).toBeVisible({ timeout: 10_000 });
  await expect(f.locator('#mcf-sound')).toContainText('Voice: off');
  await page.click('#voice-btn');
  await expect(f.locator('#mcf-sound')).toBeHidden();
  await page.click('#voice-btn');
  await expect(f.locator('#mcf-sound')).toBeVisible();
});

test('the commentary card says when the live booth is off, and why, and hides that once it is on', async ({ page }) => {
  await openShell(page, 'broadcast', '?seed=2026');
  const f = await viewFrame(page, 'broadcast');
  await expect.poll(() => f.evaluate(() => !!document.getElementById('mcf')), { timeout: 240_000 }).toBe(true);
  // GET /booth said no: every watch slot is taken, so the rules booth talks on its own
  await page.evaluate(() => post('broadcast', { src: 'matchcast-shell', type: 'booth-state', ready: false, reason: 'watch_mode_cap' }));
  await expect(f.locator('#mcf-booth')).toBeVisible({ timeout: 10_000 });
  await expect(f.locator('#mcf-booth')).toContainText('every watch mode for this match is taken');
  await expect(f.locator('#mcf-booth')).toContainText('rules booth');
  await page.evaluate(() => post('broadcast', { src: 'matchcast-shell', type: 'booth-state', ready: true, reason: '' }));
  await expect(f.locator('#mcf-booth')).toBeHidden();
});

test('the booth voices a new match, even though its line ids start again', async ({ page }) => {
  // the Agents view runs no Watch match, so nothing resets the feed between the two calls below
  await openShell(page, 'agents');
  await page.evaluate(() => { VC.set(true); });
  const spoken = await page.evaluate(async () => {
    const calls: string[] = [];
    const say = VC.say;
    VC.say = (text: string, o: any) => { calls.push(text); return say(text, o); };
    CM.reset('first', { home: 'Ridgeview', away: 'Thames Rovers', hk: 'H', ak: 'A' });
    CM.api('First match colour.', 2, 'summary', 'first-1');
    await new Promise((r) => setTimeout(r, 400));
    CM.reset('second', { home: 'Ridgeview', away: 'Thames Rovers', hk: 'H', ak: 'A' });
    CM.api('Second match colour.', 2, 'summary', 'second-1');
    await new Promise((r) => setTimeout(r, 400));
    VC.say = say;
    return calls;
  });
  expect(spoken).toEqual(expect.arrayContaining(['First match colour.', 'Second match colour.']));
});

test('each feed line carries the numbers it was counted from', async ({ page }) => {
  await openShell(page, 'agents');
  const lines = await page.evaluate(() => {
    const pass = (minute: number, team: string, player: string) => ({ minute, type: 'pass', team, player });
    CM.reset('numbers', { home: 'Ridgeview', away: 'Thames Rovers', hk: 'H', ak: 'A' });
    CM.fromWatch([{ minute: 0.9, type: 'shot', team: 'A', player: 'Dev', xg: 0.12, fate: 'miss' }, pass(1, 'H', 'Ana'), pass(1.05, 'H', 'Ben'), pass(1.1, 'H', 'Cal')], []);
    return CM.view().filter((l: any) => l.kind === 'play' || l.kind === 'shot').map((l: any) => ({ kind: l.kind, numbers: l.numbers }));
  });
  expect(lines).toEqual([
    { kind: 'shot', numbers: [{ name: 'xG', value: 0.12 }] },
    { kind: 'play', numbers: [{ name: 'passes', value: 3 }] },
  ]);
});
