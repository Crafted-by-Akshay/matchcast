import { test, expect } from './fixtures';
import { openShell, viewFrame } from './helpers';

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
