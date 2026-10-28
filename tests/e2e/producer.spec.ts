import { test, expect } from './fixtures';
import { openShell, openProductionTools, ready, viewFrame } from './helpers';

// The Broadcast desk's producer section, driven by a real line: the Verifier rejects a wrong number and repairs it, the line waits for a person, Approve airs it through the shell, and the event-to-air time comes from the shell's own air message.
declare const AG: any;

const names = { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' };
const seedWrongGoal = (page: import('@playwright/test').Page, key: string) => page.evaluate(({ k, n }) => {
  AG.reset(k, n);
  AG.seedBad(true);   // the next score claim is stated wrongly, so the Verifier rejects it and repairs it from the log
  AG.onWatch(k, [{ minute: 20.2, type: 'goal', team: 'thr', player: 'A One', score: '1-0', data: {} }], []);
}, { k: key, n: names });

test('Broadcast asks for approval: a repaired line waits, Approve airs it, and the event-to-air time is shown', async ({ page }) => {
  test.setTimeout(300_000);
  await openShell(page, 'broadcast', '?seed=2026');
  const f = await viewFrame(page, 'broadcast');
  await openProductionTools(f);
  await expect(f.locator('#mc-producer')).toBeVisible({ timeout: 240_000 });
  expect(await page.evaluate(() => AG.mode), 'Approve each line is the default').toBe('producer');
  await expect(f.locator('#mc-pmode [data-mode="producer"]')).toHaveAttribute('aria-pressed', 'true');

  await seedWrongGoal(page, 'k-approve');
  const id = await page.evaluate(() => AG.run.claims.find((c: any) => c.kind === 'score' && c.seeded).id);
  const was = await page.evaluate(() => AG.run.claims.find((c: any) => c.kind === 'score' && c.seeded).wasText);
  const item = f.locator('#mc-pq li[data-id="' + id + '"]');
  await expect(item, 'the repaired line waits for a person').toContainText('Verifier rejected a wrong number and repaired');
  await expect(item).toContainText('First wording: ' + was);
  await expect.poll(() => page.evaluate((x) => AG.run.claims.find((c: any) => c.id === x).approval, id)).toBe('pending');

  await item.locator('[data-act="approve"]').click();
  await expect.poll(() => page.evaluate((x) => AG.run.claims.find((c: any) => c.id === x).approval, id), 'Approve reaches the shell').toBe('approved');
  await expect(f.locator('#mc-pt'), 'event to air is a number of seconds').toContainText(/Event to air: \d+\.\d s/);
  await expect(f.locator('#mc-pq li[data-id="' + id + '"]')).toHaveCount(0);
});

test('the Producer toggle switches the mode, the Agents select follows, and Auto-air releases the waiting lines', async ({ page }) => {
  test.setTimeout(300_000);
  await openShell(page, 'broadcast', '?seed=2026');
  const f = await viewFrame(page, 'broadcast');
  await openProductionTools(f);
  await expect(f.locator('#mc-producer')).toBeVisible({ timeout: 240_000 });
  await seedWrongGoal(page, 'k-toggle');
  await expect(f.locator('#mc-pq li')).toHaveCount(1);

  await f.locator('#mc-pmode [data-mode="demo"]').click();
  await expect.poll(() => page.evaluate(() => AG.mode), 'the desk changes the shell mode').toBe('demo');
  await expect(page.locator('#aq-mode'), 'the Agents select follows the desk').toHaveValue('demo');
  await expect(f.locator('#mc-pmode [data-mode="demo"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(f.locator('#mc-pq li'), 'Auto-air releases the waiting line, so nothing is left in the queue').toHaveCount(1);
  await expect.poll(() => page.evaluate(() => AG.run.claims.filter((c: any) => c.approval === 'pending').length), 'no claim is still pending').toBe(0);

  await f.locator('#mc-pmode [data-mode="producer"]').click();
  await expect.poll(() => page.evaluate(() => AG.mode)).toBe('producer');
  await expect(page.locator('#aq-mode')).toHaveValue('producer');
});

test('an escalated line waits with its reason and a marker: nothing airs it, Auto-air skips it, and Kill removes it', async ({ page }) => {
  test.setTimeout(300_000);
  await openShell(page, 'broadcast', '?seed=2026');
  const f = await viewFrame(page, 'broadcast');
  await openProductionTools(f);
  await expect(f.locator('#mc-producer')).toBeVisible({ timeout: 240_000 });
  await ready('broadcast')(page);   // the view has taken its first queue message, so the line below is not sent to a view that is still loading
  // a line waiting for review that the Verifier did not escalate is not a card: only an escalated line reaches the queue
  await page.evaluate((n) => { AG.reset('k-escalated', n); AG.ingest({ line_id: 'L8', status: 'review', escalated: false, text: "Thames Rovers lead 2-0 at 10'." }, 'live'); }, names);
  expect(await page.evaluate(() => AG.run.claims.some((c: any) => c.id === 'pub-L8')), 'a review line that was not escalated makes no card').toBe(false);
  // the api's line event for a line the Verifier could not repair (status review, escalated), as live.js hands it to AG.ingest
  await page.evaluate((n) => { AG.ingest({ line_id: 'L9', status: 'review', escalated: true, reason_code: 'number_mismatch', text: "Thames Rovers lead 3-0 at 20'." }, 'live'); }, names);

  const item = f.locator('#mc-pq li[data-id="pub-L9"]');
  await expect(item, 'the escalated line is marked and says why').toContainText('Escalated');
  await expect(item).toContainText('The Verifier could not repair this line: a number does not match the event log');
  await expect(item.locator('[data-act="approve"]'), 'nothing airs a line the Verifier could not check').toHaveCount(0);
  await expect(page.locator('#aq-list li[data-id="pub-L9"]'), 'the Agents queue shows the same marker').toContainText('Escalated');
  await expect(page.locator('#aq-list li[data-id="pub-L9"] [data-act="approve"]')).toHaveCount(0);
  expect(await page.evaluate(() => AG.approve('pub-L9', 'Test').ok), 'approve refuses it').toBe(false);

  await f.locator('#mc-pmode [data-mode="demo"]').click();
  await expect.poll(() => page.evaluate(() => AG.mode)).toBe('demo');
  expect(await page.evaluate(() => AG.run.claims.find((c: any) => c.id === 'pub-L9').approval), 'Auto-air leaves it waiting').toBe('pending');
  await expect(item).toHaveCount(1);

  await f.locator('#mc-pmode [data-mode="producer"]').click();
  await expect.poll(() => page.evaluate(() => AG.mode)).toBe('producer');
  await item.locator('[data-act="kill"]').click();
  await expect.poll(() => page.evaluate(() => AG.run.claims.find((c: any) => c.id === 'pub-L9').approval), 'Kill takes it off the queue').toBe('killed');
  await expect(item).toHaveCount(0);
});
