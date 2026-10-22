import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// Broadcast's on-air overlays (replay bar, on-air log, lower-third, teleprompter) must not cover each other, on a desktop or a phone.
for (const [name, size] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 800 }]] as const) {
  test(`Broadcast overlays do not overlap (${name})`, async ({ page }) => {
    test.setTimeout(420_000);
    const errs = collectErrors(page);
    await page.setViewportSize(size);
    await openShell(page, 'broadcast');
    await ready('broadcast')(page);
    const bc = await viewFrame(page, 'broadcast');
    await bc.evaluate(() => {   // show every overlay at once, with a realistic goal line
      const l3 = document.getElementById('mc-l3')!, tele = document.getElementById('mc-tele')!;
      l3.hidden = false; l3.textContent = "23' Goal for Arsenal (A One). Arsenal 1–0 Chelsea at 23 minutes.";
      tele.hidden = false; tele.innerHTML = '<li>Goal for Arsenal (A One). Arsenal 1–0 Chelsea.</li><li>Shot by Chelsea.</li>';
    });
    const boxes = await bc.evaluate(() => ['mc-replay', 'mc-onair', 'mc-l3', 'mc-tele'].map((id) => { const r = document.getElementById(id)!.getBoundingClientRect(); const v = document.getElementById('bc-view')!.getBoundingClientRect(); return { id, x: r.x, y: r.y, w: r.width, h: r.height, vx: v.x, vw: v.width }; }));
    for (const b of boxes) { expect(b.w, b.id + ' has a size').toBeGreaterThan(0); expect(b.x, b.id + ' inside the view (left)').toBeGreaterThanOrEqual(b.vx - 1); expect(b.x + b.w, b.id + ' inside the view (right)').toBeLessThanOrEqual(b.vx + b.vw + 1); }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
    }
    expect(errs).toEqual([]);
  });
}
