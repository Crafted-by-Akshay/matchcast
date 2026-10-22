import { test, expect } from '@playwright/test';
import { collectErrors, openShell } from './helpers';

// EXP-17: Spanish and Hindi lines keep the English line's numbers and names; a bad translation is rejected and audited.
declare const AG: any, MCC: any, cardOf: any;

const goal = (page, minute: number, score: string) => page.evaluate(([m, s]) => {
  AG.onWatch('k1', [{ minute: m, type: 'goal', team: 'ars', player: 'A One', score: s, data: {} }], []);
}, [minute, score]);

test.beforeEach(({ page }) => page.addInitScript(() => { (window as any).MC_TEST = true; }));

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

test('language: a swapped score, swapped clubs or an extra name is rejected', async ({ page }) => {
  await openShell(page, 'agents');
  await page.evaluate(() => AG.reset('k1', { hk: 'ars', ak: 'che', home: 'Arsenal', away: 'Chelsea' }));
  await goal(page, 10.1, '1-0');
  const bad = await page.evaluate(() => {
    const c = AG.run.claims.find((q: any) => q.kind === 'score');
    return ['Gol de Arsenal (A One) en el min 10. Arsenal 0–1 Chelsea.', 'Gol de Arsenal (A One) en el min 10. Chelsea 1–0 Arsenal.', 'Gol de Arsenal (Bob Smith) en el min 10. Arsenal 1–0 Chelsea.', 'Gol de Arsenal (A One) en el min 10. Arsenal 1–0 Chelsea.'].map((t) => AG.checkTranslation(c, t).ok);
  });
  expect(bad).toEqual([false, false, false, true]);
});

test('language: shot and xG lines translate and pass the re-check in both languages', async ({ page }) => {
  await openShell(page, 'agents');
  await page.evaluate(() => {
    AG.reset('k1', { hk: 'ars', ak: 'che', home: 'Arsenal', away: 'Chelsea' });
    AG.onWatch('k1', [{ minute: 33.3, type: 'shot', team: 'che', player: 'C One', x: 90, y: 30, xg: 0.4, kind: 'open play', data: { xg: 0.4, kind: 'open play' } },
      { minute: 36.1, type: 'shot', team: 'ars', player: 'A One', x: 90, y: 30, xg: 0.3, kind: 'penalty', data: { xg: 0.3, kind: 'penalty' } }], []);
  });
  const kinds = await page.evaluate(() => AG.run.claims.filter((c: any) => c.tr).map((c: any) => [c.kind, c.tr.es.ok, c.tr.hi.ok]));
  expect(kinds.length).toBeGreaterThanOrEqual(3);
  for (const k of kinds) expect(k.slice(1)).toEqual([true, true]);
});

// PR 118: the api sends variants only for translations it re-checked; they replace the rules text for that language and the other language keeps the fallback.
test('language: api variants are shown for the language they cover; the other keeps the rules line', async ({ page }) => {
  await openShell(page, 'agents');
  await page.evaluate(() => AG.reset('k1', { hk: 'ars', ak: 'che', home: 'Arsenal', away: 'Chelsea' }));
  await goal(page, 10.1, '1-0');
  const r = await page.evaluate(() => {
    const x = AG.run.claims.find((q: any) => q.kind === 'score');
    const rulesHi = x.tr.hi.text;
    AG.ingest({ claim_id: x.id, variants: { es: '<b>Gol</b> de A One, 1-0.' } }, 'live');
    return { es: x.tr.es, hi: x.tr.hi.text === rulesHi, card: cardOf(x).tr.es };
  });
  expect(r.es.ok).toBe(true);
  expect(r.es.api).toBe(true);
  expect(r.es.text).toBe('<b>Gol</b> de A One, 1-0.');   // plain text: Watch renders it with textContent / esc
  expect(r.hi).toBe(true);
});
