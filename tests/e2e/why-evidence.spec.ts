import { test, expect } from './fixtures';
import { collectErrors } from './helpers';

declare const AG: any; declare const LV: any; declare const sentCards: Map<string, string>; declare function cardOf(c: any): any;

// FIX-05 (AB#373): a Pulse line from the api names the events it cites (onair source_event_ids), and its claims carry a basis
// (metric, value, stream interval, derivation). The Why panel shows the events this page holds and says how many it does not,
// instead of "No cited events" for a line that did cite events.
async function openAgents(page: import('@playwright/test').Page) {
  await page.goto('/index.html#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof AG !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  await page.evaluate(() => {
    AG.reset('k1', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' });
    AG.ingest({ claim_id: 'c-9', metric: 'goals:home', value: 1, units: 'count', approval_status: 'approved', derivation_version: '1.0.0', max_evidence_sequence: 41, source: { type: 'interval', to_stream_sequence: 41 } }, 'live');
    AG.ingest({ publication_id: 'onair-goal', line_id: 'L-1', claim_ids: ['c-9'], text: 'Goal for Northgate FC.' }, 'live');   // the publication reaches the page before its onair record
  });
}

test('Why evidence: an api line shows its claim basis and says which cited events this page does not hold', async ({ page }) => {
  const errs = collectErrors(page);
  await openAgents(page);
  await page.evaluate(() => AG.noteAired('onair-goal', { publication_id: 'onair-goal', source_event_ids: ['e-gone-1', 'e-gone-2'] }));
  const card = await page.evaluate(() => cardOf(AG.run.claims.find((c: any) => c.id === 'onair-goal')));
  expect(card.evidence).toHaveLength(0);                       // this page never sent these events, so none can be shown
  const basis = card.basis.join(' | ');
  expect(basis).toContain('goals:home = 1 (count)');
  expect(basis).toContain('stream events 1 to 41');
  expect(basis).toContain('derivation 1.0.0');
  expect(card.missing, 'the cited events are named as not held, not left out').toContain('2 of 2 cited events are not shown here');
  expect(basis, 'the not-held line is not a claim basis row').not.toContain('not shown here');
  expect(await page.evaluate(() => typeof LV.apiEvent === 'function')).toBe(true);
  expect(errs).toEqual([]);
});

test('Why evidence: a line citing more than 200 events says how many of all of them are not shown here', async ({ page }) => {
  const errs = collectErrors(page);
  await openAgents(page);
  await page.evaluate(() => {
    const ids = Array.from({ length: 250 }, (_, n) => 'e-gone-' + n);
    AG.noteAired('onair-goal', { publication_id: 'onair-goal', source_event_ids: ids });   // the page keeps 200 ids of the 250; the total stays 250
  });
  const card = await page.evaluate(() => cardOf(AG.run.claims.find((c: any) => c.id === 'onair-goal')));
  expect(card.missing).toContain('250 of 250 cited events are not shown here');
  expect(errs).toEqual([]);
});

test('Why evidence: a cited event this page holds is shown, and its Pulse card is posted again when the onair record arrives', async ({ page }) => {
  const errs = collectErrors(page);
  await openAgents(page);
  await page.evaluate(() => { LV.apiEvent = (id: string) => (id === 'e1' ? { minute: 12.3, type: 'shot', team: 'thr', player: 'A One', xg: 0.3 } : null); });   // the api id this page sent for its shot
  expect(await page.evaluate(() => sentCards.get('onair-goal') || ''), 'the card posted at publication has no cited events yet').not.toContain('e1');
  await page.evaluate(() => AG.noteAired('onair-goal', { publication_id: 'onair-goal', source_event_ids: ['e1', 'e-gone'] }));   // the onair record alone re-posts the card (AG.onChange runs pushCards)
  const card = await page.evaluate(() => cardOf(AG.run.claims.find((c: any) => c.id === 'onair-goal')));
  expect(card.evidence).toHaveLength(1);
  expect(card.evidence[0]).toMatchObject({ minute: 12.3, type: 'shot', player: 'A One', xg: 0.3 });
  expect(card.missing).toContain('1 of 2 cited events are not shown here');
  expect(await page.evaluate(() => sentCards.get('onair-goal') || ''), 'the card posted at publication is replaced, not kept').toContain('e1,e-gone');
  expect(errs).toEqual([]);
});
