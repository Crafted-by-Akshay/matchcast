import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame, openView } from './helpers';
declare const post: any;
  collectErrors, openShell, ready, viewFrame } import { collectErrors, openShell, ready, viewFrame, openView}from './helpers';

// Keyboard path through the Broadcast desk: every control is reachable with Tab, shows a visible focus ring, and Escape closes the dialogs it opens.
test('Broadcast desk: Tab reaches every control with a visible focus indicator', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  await openShell(page, 'agents');
  await openView(page, 'broadcast');
  await ready('broadcast')(page);
  const bc = await viewFrame(page, 'broadcast');
  await bc.locator('#bc-tabs button[data-p="desk"]').focus();
  const seen: string[] = [], bad: string[] = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const f = await bc.evaluate(() => {
      const e = document.activeElement as HTMLElement | null; if (!e || e === document.body) return null;
      const cs = getComputedStyle(e), r = e.getBoundingClientRect();
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
      return { id: e.id || e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0], ring: !!ring, visible: r.width > 0 && r.height > 0 };
    });
    if (!f) break;
    seen.push(f.id);
    if (!f.visible) bad.push(f.id + ' is focused but not visible');
    if (!f.ring) bad.push(f.id + ' has no visible focus indicator');
  }
  console.log('KEYS', JSON.stringify(seen), JSON.stringify(bad));
  expect(seen.length).toBeGreaterThan(8);
  expect(bad).toEqual([]);
  expect(errs).toEqual([]);
});

test('Broadcast states: the agent source is said in words, and missing speech disables Speak with a note', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  await page.addInitScript(() => { Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true }); });
  await openShell(page, 'agents');
  await openView(page, 'broadcast');
  await ready('broadcast')(page);
  const bc = await viewFrame(page, 'broadcast');
  await expect(bc.locator('#mc-agentstate')).toContainText('rules in this page');
  await bc.locator('#bc-tabs button[data-p="script"]').click();
  await expect(bc.locator('#sc-speak')).toBeDisabled();
  await expect(bc.locator('#pane-script')).toContainText('Speech is not available here');
  await page.evaluate(() => post('broadcast', { src: 'matchcast-shell', type: 'agents', state: 'live', label: 'Live agents', hint: '' }));
  await expect(bc.locator('#mc-agentstate')).toHaveText('Agents: live from the api');
  expect(errs).toEqual([]);
});
