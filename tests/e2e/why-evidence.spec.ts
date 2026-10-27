import { test, expect } from './fixtures';
import { collectErrors } from './helpers';

declare const AG: any; declare const LV: any; declare function cardOf(c: any): any;

// FIX-05 (AB#373): a Pulse line from the api names the events it cites (onair source_event_ids), and its claims carry a basis
// (metric, value, stream interval, derivation). The Why panel shows the events this page holds and says how many it does not,
// instead of "No cited events" for a line that did cite events.
test('Why evidence: an api line shows its claim basis and says which cited events this page does not hold', async ({ page }) => {
  const errs = collectErrors(page);
  await page.goto('/index.html#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof AG !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  await page.evaluate(() => {
    AG.reset('k1', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' });
    AG.ingest({ claim_id: 'c-9', metric: 'goals:home', value: 1, units: 'count', approval_status: 'approved', derivation_version: '1.0.0', max_evidence_sequence: 41, source: { type: 'interval', to_stream_sequence: 41 } }, 'live');
    AG.ingest({ publication_id: 'onair-goal', line_id: 'L-1', claim_ids: ['c-9'], text: 'Goal for Northgate FC.' }, 'live');
    AG.noteAired('onair-goal', { publication_id: 'onair-goal', source_event_ids: ['e-gone-1', 'e-gone-2'] });
  });
  const card = await page.evaluate(() => cardOf(AG.run.claims.find((c: any) => c.id === 'onair-goal')));
  expect(card.evidence).toHaveLength(0);                       // this page never sent these events, so none can be shown
  const basis = card.basis.join(' | ');
  expect(basis).toContain('goals:home = 1 (count)');
  expect(basis).toContain('stream events 1 to 41');
  expect(basis).toContain('derivation 1.0.0');
  expect(basis, 'the cited events are named as not held, not left out').toContain('2 of 2 cited events are not in this page');
  expect(await page.evaluate(() => typeof LV.apiEvent === 'function')).toBe(true);
  expect(errs).toEqual([]);
});
