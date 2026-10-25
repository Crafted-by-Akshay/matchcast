import { test, expect } from './fixtures';
import { openShell, viewFrame } from './helpers';

// The Broadcast desk's producer section: a line waits for a person (Approve each line is the default), the Verifier's repair is shown, Approve and Kill go to the shell, and the event-to-air time is a number.
declare const post: (view: string, msg: unknown) => void;
declare const AG: any;

test('Broadcast asks for approval first: a repaired line shows the Verifier, and Approve reaches the shell', async ({ page }) => {
  test.setTimeout(300_000);
  await openShell(page, 'broadcast', '?seed=2026');
  const f = await viewFrame(page, 'broadcast');
  await expect(f.locator('#mc-producer')).toBeVisible({ timeout: 240_000 });
  await expect(f.locator('#mc-pmode [data-mode="producer"]'), 'Approve each line is the default').toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { (window as any).__acts = []; const orig = AG.approve; AG.approve = (id: string, who: string) => { (window as any).__acts.push(id); return orig(id, who); }; });
  await page.evaluate(() => post('broadcast', { src: 'matchcast-shell', type: 'queue', mode: 'producer', items: [{ id: 'c9', minute: 12, text: 'Goal for Thames Rovers. Thames Rovers 1–0.', verdict: 'verified', repaired: true, was: 'Goal for Thames Rovers. Thames Rovers 2–0.', reason: '', waiting_ms: 4000, approval: 'pending' }] }));
  await expect(f.locator('#mc-pq .mcp-item')).toContainText('Verifier rejected a wrong number and repaired');
  await expect(f.locator('#mc-pq .mcp-item')).toContainText('First wording: Goal for Thames Rovers. Thames Rovers 2–0.');
  await f.locator('#mc-pq [data-act="approve"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__acts), 'Approve reaches the shell with the line id').toEqual(['c9']);
  await page.evaluate(() => post('broadcast', { src: 'matchcast-shell', type: 'air', line: { id: 'c9', minute: 12, text: 'Goal for Thames Rovers. Thames Rovers 1–0.', verdict: 'verified', repaired: true, aired_ms: 3400 } }));
  await expect(f.locator('#mc-pt'), 'event to air is shown as a number').toContainText('Event to air: 3.4 s');
});

test('the Producer toggle switches between approving each line and auto-air', async ({ page }) => {
  test.setTimeout(300_000);
  await openShell(page, 'broadcast', '?seed=2026');
  const f = await viewFrame(page, 'broadcast');
  await expect(f.locator('#mc-producer')).toBeVisible({ timeout: 240_000 });
  await f.locator('#mc-pmode [data-mode="demo"]').click();
  await expect.poll(() => page.evaluate(() => AG.mode)).toBe('demo');
  await expect(f.locator('#mc-pmode [data-mode="demo"]')).toHaveAttribute('aria-pressed', 'true');
  await f.locator('#mc-pmode [data-mode="producer"]').click();
  await expect.poll(() => page.evaluate(() => AG.mode)).toBe('producer');
  await expect(f.locator('#mc-pmode [data-mode="producer"]')).toHaveAttribute('aria-pressed', 'true');
});
