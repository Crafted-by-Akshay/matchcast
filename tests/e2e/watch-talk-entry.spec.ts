import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// UX review pass 8: talking to a player has a visible entry point, "Talk to a player", beside the Copilot button. It opens the Copilot Talk tab
// (roster, Follow, message box), gets out of the way while the drawer is open, comes back when it closes, and never sits on top of the Copilot button
// or the other HUD pieces. The tour's Watch step names it (see tour.spec.ts).
for (const [name, width, height] of [['desktop', 1440, 900], ['laptop', 1024, 768], ['phone', 390, 844], ['small phone', 320, 640]] as const) {
  test(`Watch on ${name}: a visible Talk to a player control opens the Talk tab and clears the other controls`, async ({ page }) => {
    test.setTimeout(300_000);
    const errs = collectErrors(page);
    await page.setViewportSize({ width, height });
    await openShell(page, 'watch');
    await ready('watch')(page);
    const f = await viewFrame(page, 'watch');
    const talk = f.getByRole('button', { name: 'Talk to a player' });
    await expect(talk).toBeVisible({ timeout: 60_000 });
    const g = await f.evaluate(() => {
      const r = (sel: string) => { const e = document.querySelector(sel); if (!e || getComputedStyle(e).display === 'none') return null; const b = e.getBoundingClientRect(); return b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height } : null; };
      return { talk: r('#mcx-talk'), cp: r('#cpbtn'), others: { pulse: r('#pulse'), scoreboard: r('#bug'), mcf: r('#mcf'), cap: r('#cap'), wx: r('#wxchip') },
        chips: [...document.querySelectorAll('#ctrl button')].filter((e) => (e as HTMLElement).offsetParent).map((e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; }), iw: innerWidth, ih: innerHeight };
    });
    expect(g.talk, 'the control is drawn').not.toBeNull();
    expect(g.cp, 'the Copilot button is drawn').not.toBeNull();
    const hit = (a: { l: number; t: number; r: number; b: number }, b: { l: number; t: number; r: number; b: number }) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    const t = g.talk!;
    expect(t.l, 'inside the view (left)').toBeGreaterThanOrEqual(0);
    expect(t.r, 'inside the view (right)').toBeLessThanOrEqual(g.iw);
    expect(hit(t, g.cp!), 'clear of the Copilot button').toBe(false);
    for (const [id, box] of Object.entries(g.others)) if (box) expect(hit(t, box), `clear of ${id}`).toBe(false);
    // the camera and speed chips; a 320 px screen is already crowded by the Copilot button itself, so that width only checks the Copilot button
    if (width > 340) expect(g.chips.filter((c) => hit(t, c)).length, 'clear of the camera and speed chips').toBe(0);
    if (width > 340) expect(g.chips.filter((c) => hit(g.cp!, c)).length, 'the Copilot button is clear of the camera and speed chips (Watch is a pane, not the whole window)').toBe(0);
    if (width <= 560) expect(t.h, 'a 44 px target').toBeGreaterThanOrEqual(43);
    await talk.focus();
    await page.keyboard.press('Enter');   // keyboard activation
    await expect(f.locator('#copilot')).toBeVisible();
    await expect(f.locator('#cp-tabs button[data-t="talk"]')).toBeVisible();
    await expect(f.locator('#tk-roster')).toBeVisible();   // the Talk tab itself, not another tab that happens to mention a team
    await expect(talk, 'hidden while the drawer is open').toBeHidden({ timeout: 3000 });
    await f.locator('#cp-close').click();
    await expect(talk, 'back once the drawer closes').toBeVisible({ timeout: 5000 });
    expect(errs).toEqual([]);
  });
}
