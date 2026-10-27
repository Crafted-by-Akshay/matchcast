import { test, expect } from './fixtures';
import { openShell, ready, viewFrame } from './helpers';

// Review of the FIX-10 chip (AB#373): the Verifier chip and the commentary toggle must sit inside the commentary panel at every width,
// and on a desktop screen the chip says both the figure and its mode (rules, offline), not only in a tooltip.
for (const width of [1440, 600, 390]) {
  test(`Verifier chip and commentary toggle sit inside the commentary panel at ${width} px`, async ({ page }) => {
    test.setTimeout(420_000);
    await page.setViewportSize({ width, height: 900 });
    await openShell(page, 'watch');
    await ready('watch')(page);
    const f = await viewFrame(page, 'watch');
    const chip = f.locator('#mc-trust'), tog = f.locator('#mcf-tog'), panel = f.locator('#mcf');
    await expect(chip).toBeVisible();
    await expect(tog).toBeVisible();
    const [c, t, p] = [await chip.boundingBox(), await tog.boundingBox(), await panel.boundingBox()];
    expect(c && p, 'chip and panel have boxes').toBeTruthy();
    expect(c!.x, 'the chip starts inside the panel').toBeGreaterThanOrEqual(p!.x - 0.5);
    expect(c!.x + c!.width, 'the chip is not clipped by the panel').toBeLessThanOrEqual(p!.x + p!.width + 0.5);
    expect(t!.x, 'the commentary toggle starts inside the panel').toBeGreaterThanOrEqual(p!.x - 0.5);
    expect(t!.x + t!.width, 'the commentary toggle is not clipped by the panel').toBeLessThanOrEqual(p!.x + p!.width + 0.5);
    if (width === 1440) await expect(chip.locator('.mc-mode'), 'the mode label is visible on a desktop screen').toBeVisible();
  });
}
