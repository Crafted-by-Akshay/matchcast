import { test, expect } from '@playwright/test';
import { collectErrors, openShell } from './helpers';

// EXP-17: Spanish and Hindi lines keep the English line's numbers and names; a bad translation is rejected and audited.
declare const AG: any, MCC: any, cardOf: any;

const goal = (page, minute: number, score: string) => page.evaluate(([m, s]) => {
  AG.onWatch('k1', [{ minute: m, type: 'goal', team: 'ars', player: 'A One', score: s, data: {} }], []);
}, [minute, score]);

test('language: Spanish and Hindi keep numbers and names; a bad translation shows Translation unavailable', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'agents');
  await page.evaluate(() => AG.reset('k1', { hk: 'ars', ak: 'che', home: 'Arsenal', away: 'Chelsea' }));
  await goal(page, 10.1, '1-0');
  const c = await page.evaluate(() => { const x = AG.run.claims.find((q: any) => q.kind === 'score'); return { en: x.text, tr: x.tr }; });
  for (const lang of ['es', 'hi']) {
    expect(c.tr[lang].ok).toBe(true);
    for (const n of ['1', '0', '10']) expect(c.tr[lang].text).toContain(n);
    for (const name of ['A One', 'Arsenal', 'Chelsea']) expect(c.tr[lang].text).toContain(name);
  }
  expect(c.tr.es.text).toContain('Gol de');
  // a translator that changes a number is rejected, audited, and the card carries the note instead of a line
  await page.evaluate(() => AG.setTranslator((x: any) => x.kind === 'score' ? 'Gol de Arsenal (A One) en el min 10. Arsenal 2–0 Chelsea.' : null));
  await goal(page, 20.2, '2-0');
  const bad = await page.evaluate(() => { const x = AG.run.claims.filter((q: any) => q.kind === 'score')[1]; return { es: x.tr.es, card: cardOf(x).tr.es }; });
  expect(bad.es.ok).toBe(false);
  expect(bad.es.text).toBeNull();
  expect(bad.card.reason).toContain('numbers');
  await expect.poll(() => page.evaluate(() => MCC.records().some((r: any) => r.action === 'translation_rejected'))).toBe(true);
  expect(errs).toEqual([]);
});

test('language: a moment with prose from Watch stays English with a note', async ({ page }) => {
  await openShell(page, 'agents');
  await page.evaluate(() => {
    AG.reset('k1', { hk: 'ars', ak: 'che', home: 'Arsenal', away: 'Chelsea' });
    AG.onWatch('k1', [], [{ id: 'm1', minute: 30, type: 'turning_point', title: 'Momentum shifts', why: 'Arsenal have had 70% of the ball.' }]);
  });
  const t = await page.evaluate(() => AG.run.claims[0].tr);
  expect(t.es.ok).toBe(false);
  expect(t.es.reason).toContain('no template');
});
