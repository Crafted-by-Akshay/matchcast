import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// UX review pass 6, finding 18: nothing readable in the three views is below 12 px. The pitch name labels (`.lbl`, 3D tags) and SVG axis text stay small on purpose.
const small = (f: import('@playwright/test').Frame) => f.evaluate(() => {
  const out: string[] = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.lbl') || el instanceof SVGElement) continue;
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent!.trim()).join('');
    if (!text) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    const fs = parseFloat(cs.fontSize);
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 1 || r.height < 1 || fs === 0) continue;   // font-size 0 is the collapsed phone Copilot label, replaced by a pseudo-element
    if (fs < 12) out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} ${fs}px "${text.slice(0, 24)}"`);
  }
  return out;
});

for (const [view, width] of [['watch', 1440], ['analyst', 1440], ['broadcast', 1440], ['watch', 390]] as const) {
  test(`${view} at ${width} px: no readable text below 12 px`, async ({ page }) => {
    test.setTimeout(300_000);
    const errs = collectErrors(page);
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await openShell(page, view);
    await ready(view)(page);
    const f = await viewFrame(page, view);
    await page.waitForTimeout(4000);   // the HUD panels fill in after the first frames
    expect(await small(f)).toEqual([]);
    expect(errs).toEqual([]);
  });
}
