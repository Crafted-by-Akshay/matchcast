import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// UX review pass 8: talking to a player has a visible entry point, "Talk to a player", beside the Copilot button. It opens the Copilot Talk tab
// (roster, Follow, message box) and gets out of the way while the drawer is open. The tour's Watch step names it.
for (const [name, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]] as const) {
  test(`Watch on ${name}: a visible Talk to a player control opens the Talk tab`, async ({ page }) => {
    test.setTimeout(300_000);
    const errs = collectErrors(page);
    await page.setViewportSize({ width, height });
    await openShell(page, 'watch');
    await ready('watch')(page);
    const f = await viewFrame(page, 'watch');
    const talk = f.locator('#mcx-talk');
    await expect(talk).toBeVisible({ timeout: 60_000 });
    await expect(talk).toHaveText('Talk to a player');
    const g = await f.evaluate(() => {
      const r = (id: string) => { const e = document.getElementById(id); if (!e || getComputedStyle(e).display === 'none') return null; const b = e.getBoundingClientRect(); return b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height } : null; };
      return { talk: r('mcx-talk')!, cp: r('cpbtn')!, pulse: r('pulse'), iw: innerWidth, ih: innerHeight };
    });
    const hit = (a: { l: number; t: number; r: number; b: number }, b: { l: number; t: number; r: number; b: number } | null) => !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    expect(g.talk.l, 'inside the view (left)').toBeGreaterThanOrEqual(0);
    expect(g.talk.r, 'inside the view (right)').toBeLessThanOrEqual(g.iw);
    expect(hit(g.talk, g.cp), 'clear of the Copilot button').toBe(false);
    expect(hit(g.talk, g.pulse), 'clear of Match Pulse').toBe(false);
    if (name === 'phone') expect(g.talk.h, 'a 44 px target').toBeGreaterThanOrEqual(43);
    await talk.click();
    await expect(f.locator('#copilot')).toBeVisible();
    await expect(f.locator('#copilot')).toContainText('Home');   // the roster of the Talk tab
    await expect(f.locator('#copilot')).toContainText('Away');
    await expect(talk, 'hidden while the drawer is open').toBeHidden({ timeout: 3000 });
    expect(errs).toEqual([]);
  });
}
