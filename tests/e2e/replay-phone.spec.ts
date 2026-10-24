import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// UX review pass 5: at 390 px the replay controls wrapped badly ("Instant replay" on two lines, "Slow- / mo"). The heading now has its own row,
// the buttons share one row with no label breaking, and every control is a 44 px target.
test('Broadcast at 390 px: the replay controls keep their labels on one line and are 44 px tall', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openShell(page, 'broadcast');
  await ready('broadcast')(page);
  const b = await viewFrame(page, 'broadcast');
  await b.waitForSelector('#mc-replay', { state: 'attached', timeout: 120_000 });
  const m = await b.evaluate(() => {
    const bar = document.getElementById('mc-replay')!;
    const parts = [...bar.querySelectorAll('span,button:not([hidden]),label')].filter((el) => (el as HTMLElement).offsetParent);
    return {
      barW: bar.getBoundingClientRect().width, barScroll: bar.scrollWidth, viewW: innerWidth,
      parts: parts.map((el) => ({ t: (el.textContent || '').trim(), h: el.getBoundingClientRect().height })),
    };
  });
  expect(m.barScroll, 'the row does not scroll sideways').toBeLessThanOrEqual(m.barW + 1);
  for (const p of m.parts) {
    if (p.t === 'Instant replay') continue;
    expect(p.h, p.t + ' is a 44 px target').toBeGreaterThanOrEqual(43);
  }
  for (const p of m.parts) {
    // a label that breaks onto a second line makes its box about twice as tall as a one-line control
    expect(p.h, p.t + ' stays on one line').toBeLessThanOrEqual(p.t === 'Instant replay' ? 24 : 50);
  }
  expect(errs).toEqual([]);
});
