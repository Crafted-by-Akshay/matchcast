import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// EXP-5: a typed question is answered by the agents from the event log, or abstains. Shell-driven, as in connection.spec.ts.
declare const AG: any; declare function answerAsk(id: number, q: string): Promise<void>;

const seed = (page) => page.evaluate(() => {
  AG.reset('k1', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' });
  const sh = (m: number, team: string, player: string) => ({ minute: m, type: 'shot', team, player, x: 90, y: 30, xg: 0.1, kind: 'open play', data: { xg: 0.1, kind: 'open play' } });
  AG.onWatch('k1', [sh(5, 'thr', 'A One'), sh(9, 'thr', 'A One'), sh(12, 'cco', 'C One'), sh(20, 'thr', 'A One'), sh(31, 'cco', 'C One')], []);
});

test('ask: the player with the most shots, a verified tick, from the event log; an unknown question abstains', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'agents');
  await seed(page);
  const a = await page.evaluate(() => AG.ask('who has the most shots?'));
  expect(a.verdict).toBe('verified');
  expect(a.text).toContain('A One');
  expect(a.text).toContain('3');
  expect(a.citations.length).toBe(3);
  const b = await page.evaluate(() => AG.ask('what colour are the corner flags?'));
  expect(b.verdict).toBe('abstained');
  expect(b.text).toBe("I can't confirm that from the match data yet.");
  expect(errs).toEqual([]);
});

test('ask: twenty questions a minute, then a polite refusal', async ({ page }) => {
  await openShell(page, 'agents');
  await seed(page);
  const answers = await page.evaluate(async () => {
    const got: any[] = [];
    (window as any).post = (_v: string, m: any) => got.push(m.answer);
    for (let i = 1; i <= 21; i++) await answerAsk(i, 'who has the most shots?');
    return got;
  });
  expect(answers.slice(0, 20).every((x: any) => x.verdict === 'verified')).toBe(true);
  expect(answers[20].note).toBe('rate limit');
});

test('ask: Watch sends the typed question to the shell and shows the checked answer', async ({ page }) => {
  await openShell(page, 'watch');
  await ready('watch')(page);
  const w = await viewFrame(page, 'watch');
  await page.evaluate(() => {
    AG.reset((AG.run && AG.run.key) || 'k1', (AG.run && AG.run.names) || { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' });
  });
  await seed(page);
  const key = await page.evaluate(() => AG.run.key);
  expect(key).toBe('k1');
  const a = await w.evaluate(() => (window as any).mcAsk('who has the most shots?'));
  expect(a.verdict).toBe('verified');
  expect(a.text).toContain('A One');
});
