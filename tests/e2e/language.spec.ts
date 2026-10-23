import { test, expect } from './fixtures';
import { collectErrors, openShell } from './helpers';

// EXP-17: Spanish and Hindi lines keep the English line's numbers and names; a bad translation is rejected and audited.
declare const AG: any, MCC: any, cardOf: any;

const goal = (page, minute: number, score: string) => page.evaluate(([m, s]) => {
  AG.onWatch('k1', [{ minute: m, type: 'goal', team: 'thr', player: 'A One', score: s, data: {} }], []);
}, [minute, score]);

test.beforeEach(({ page }) => page.addInitScript(() => { (window as any).MC_TEST = true; }));

test('language: Spanish and Hindi keep numbers and names; a bad translation shows Translation unavailable', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'agents');
  await page.evaluate(() => AG.reset('k1', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' }));
  await goal(page, 10.1, '1-0');
  const c = await page.evaluate(() => { const x = AG.run.claims.find((q: any) => q.kind === 'score'); return { en: x.text, tr: x.tr }; });
  for (const lang of ['es', 'hi']) {
    expect(c.tr[lang].ok).toBe(true);
    for (const n of ['1', '0', '10']) expect(c.tr[lang].text).toContain(n);
    for (const name of ['A One', 'Thames Rovers', 'Coloso Ciudad']) expect(c.tr[lang].text).toContain(name);
  }
  expect(c.tr.es.text).toContain('Gol de');
  // a translator that changes a number is rejected, audited, and the card carries the note instead of a line
  await page.evaluate(() => AG.setTranslator((x: any) => x.kind === 'score' ? 'Gol de Thames Rovers (A One) en el min 10. Thames Rovers 2–0 Coloso Ciudad.' : null));
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
    AG.reset('k1', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' });
    AG.onWatch('k1', [], [{ id: 'm1', minute: 30, type: 'turning_point', title: 'Momentum shifts', why: 'Thames Rovers have had 70% of the ball.' }]);
  });
  const t = await page.evaluate(() => AG.run.claims[0].tr);
  expect(t.es.ok).toBe(false);
  expect(t.es.reason).toContain('no template');
});

test('language: a swapped score, swapped clubs or an extra name is rejected', async ({ page }) => {
  await openShell(page, 'agents');
  await page.evaluate(() => AG.reset('k1', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' }));
  await goal(page, 10.1, '1-0');
  const bad = await page.evaluate(() => {
    const c = AG.run.claims.find((q: any) => q.kind === 'score');
    return ['Gol de Thames Rovers (A One) en el min 10. Thames Rovers 0–1 Coloso Ciudad.', 'Gol de Thames Rovers (A One) en el min 10. Coloso Ciudad 1–0 Thames Rovers.', 'Gol de Thames Rovers (Bob Smith) en el min 10. Thames Rovers 1–0 Coloso Ciudad.', 'Gol de Thames Rovers (A One) en el min 10. Thames Rovers 1–0 Coloso Ciudad.'].map((t) => AG.checkTranslation(c, t).ok);
  });
  expect(bad).toEqual([false, false, false, true]);
});

test('language: shot and xG lines translate and pass the re-check in both languages', async ({ page }) => {
  await openShell(page, 'agents');
  await page.evaluate(() => {
    AG.reset('k1', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' });
    AG.onWatch('k1', [{ minute: 33.3, type: 'shot', team: 'cco', player: 'C One', x: 90, y: 30, xg: 0.4, kind: 'open play', data: { xg: 0.4, kind: 'open play' } },
      { minute: 36.1, type: 'shot', team: 'thr', player: 'A One', x: 90, y: 30, xg: 0.3, kind: 'penalty', data: { xg: 0.3, kind: 'penalty' } }], []);
  });
  const kinds = await page.evaluate(() => AG.run.claims.filter((c: any) => c.tr).map((c: any) => [c.kind, c.tr.es.ok, c.tr.hi.ok]));
  expect(kinds.length).toBeGreaterThanOrEqual(3);
  for (const k of kinds) expect(k.slice(1)).toEqual([true, true]);
});

// PR 118: the api sends variants only for translations it re-checked; they replace the rules text for that language and the other language keeps the fallback.
test('language: api variants are shown for the language they cover; the other keeps the rules line', async ({ page }) => {
  await openShell(page, 'agents');
  await page.evaluate(() => AG.reset('k1', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' }));
  await goal(page, 10.1, '1-0');
  const r = await page.evaluate(() => {
    const x = AG.run.claims.find((q: any) => q.kind === 'score');
    const rulesHi = x.tr.hi.text;
    AG.ingest({ claim_id: x.id, variants: { es: '<b>Gol</b> de A One, 1-0.' } }, 'live');
    const es = JSON.parse(JSON.stringify(x.tr.es));
    AG.ingest({ claim_id: x.id, variants: { hi: '   ' } }, 'live');   // blank variants are ignored
    const blankIgnored = x.tr.hi.text === rulesHi;
    AG.ingest({ claim_id: x.id, text: 'A different English line, 1-0.', variants: { es: 'Otra linea, 1-0.' } }, 'live');
    return { es, hi: blankIgnored, afterText: { es: x.tr.es && x.tr.es.text, hi: x.tr.hi || null } };
  });
  expect(r.es.ok).toBe(true);
  expect(r.es.api).toBe(true);
  expect(r.es.text).toBe('<b>Gol</b> de A One, 1-0.');   // stored as plain text; Watch passes lines through esc() before innerHTML
  expect(r.hi).toBe(true);
  expect(r.afterText.es).toBe('Otra linea, 1-0.');
  expect(r.afterText.hi, 'a changed English line drops translations of the old one').toBeNull();
});

// The api stream: a publication is the viewer-facing card (kept out of the claims ledger), a line event only updates it, a claim event is evidence.
test('ingest: publication card, line updates, evidence claims approved on publish', async ({ page }) => {
  await openShell(page, 'agents');
  await page.evaluate(() => AG.reset('k2', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' }));
  const r = await page.evaluate(() => {
    const run = AG.run, n0 = run.stat.claims;
    AG.ingest({ line_id: 'ln-9', status: 'drafted' }, 'live');
    const noCardFromLine = !run.claims.some((c: any) => c.id === 'pub-ln-9');
    AG.ingest({ claim_id: 'cl-9', metric: 'shots', value: 3, approval_status: 'pending' }, 'live');
    const pending = run.claims.find((c: any) => c.id === 'cl-9').verdict;
    AG.ingest({ line_id: 'ln-9', claim_ids: ['cl-9'], status: 'verified' }, 'live');
    const claimUntouched = run.claims.find((c: any) => c.id === 'cl-9').verdict;
    AG.ingest({ publication_id: 'pub-ln-9', line_id: 'ln-9', claim_ids: ['cl-9'], text: 'Rovers have 3 shots.', variants: { es: 'Rovers tienen 3 tiros.' } }, 'live');
    const card = run.claims.find((c: any) => c.id === 'pub-ln-9'), ev = run.claims.find((c: any) => c.id === 'cl-9');
    AG.ingest({ line_id: 'ln-9', status: 'killed', checks: [{ name: 'numbers', ok: true }] }, 'live');
    return { noCardFromLine, pending, claimUntouched, cardPub: card.pub, evVerdict: ev.verdict, claimsStat: run.stat.claims - n0, cardVerdict: card.verdict, checks: card.apiChecks.length, es: card.tr.es.text };
  });
  expect(r.noCardFromLine).toBe(true);
  expect(r.pending).toBe('pending');
  expect(r.claimUntouched).toBe('pending');
  expect(r.cardPub).toBe(true);
  expect(r.evVerdict).toBe('verified');
  expect(r.claimsStat, 'only the evidence claim counts').toBe(1);
  expect(r.cardVerdict).toBe('abstained');
  expect(r.checks).toBe(1);
  expect(r.es).toBe('Rovers tienen 3 tiros.');
});
