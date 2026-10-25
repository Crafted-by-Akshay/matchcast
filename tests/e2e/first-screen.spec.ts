import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, stepSim, viewFrame } from './helpers';

declare const AG: any;
// Audit follow-up: the Watch first screen shows the same moment as an analyst and as a casual fan side by side (personalisation visible without a click), the Verifier's measured record is a small chip that opens the Verify tab, and the header has fewer status pills.
test('Watch shows one moment in two voices, and the Verifier chip opens the Verify tab', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  const two = f.locator('#mc-two');
  for (let i = 0; i < 12 && !(await two.isVisible()); i++) await stepSim(f, 1200);
  await expect(two).toBeVisible();
  const an = (await two.locator('.an p').textContent())!.trim(), ca = (await two.locator('.ca p').textContent())!.trim();
  expect(an.length).toBeGreaterThan(5); expect(ca.length).toBeGreaterThan(5);
  expect(an).not.toBe(ca);                                   // the same event, worded differently
  await expect(two.locator('.an h4')).toContainText('Analyst');
  await expect(two.locator('.ca h4')).toContainText('Casual');
  await expect(two).toContainText('Simulated');              // in-page rules, said plainly

  const chip = f.locator('#mc-trust');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('99.3%');
  expect(await chip.getAttribute('title')).toMatch(/151 planted errors.*34 honest lines/s);
  await chip.click();
  await expect(f.locator('#cp-verify')).toBeVisible();
  await expect(f.locator('#cp-tabs button[data-t="verify"]')).toHaveAttribute('aria-selected', 'true');

  await expect(page.locator('.top .pill', { hasText: 'Browser prototype' })).toHaveCount(0);
  await expect(page.locator('.top .pill', { hasText: 'Azure parts simulated' })).toHaveCount(0);
  await expect(page.locator('#status-btn')).toBeVisible();   // the honest breakdown stays one click away
  expect(errs).toEqual([]);
});

test('Hindi casual lines keep every name and number, and a line with no rule stays English', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  const r = await f.evaluate(() => {
    const t = (window as any).__mcTwoFans.toHindi;
    return [
      t('E. Belruda has a go!'), t('Big chance! E. Belruda has a go!'), t('E. Belruda reads it and steals the ball!'),
      t('E. Belruda wins the ball back for Harbor City.'), t('Offside! E. Belruda went a moment too early.'), t('Foul by Dorlano. Penalty!'), t('Foul by Dorlano. Free kick.'),
      t('Wow! Marimero keeps it out!'), t('⚽ GOAL! E. Belruda scores! Harbor City 1, Thames Rovers 0.'),
      t('A line with no rule.'),
    ];
  });
  const [shot, big, steal, win, off, pen, fk, save, goal, none] = r as (string | null)[];
  expect(shot).toContain('E. Belruda'); expect(big).toContain('बड़ा मौका'); expect(steal).toContain('E. Belruda'); expect(win).toContain('Harbor City');
  expect(off).toContain('ऑफसाइड'); expect(pen).toContain('पेनल्टी'); expect(fk).toContain('फ़्री किक'); expect(save).toContain('Marimero');
  expect(goal).toContain('Harbor City 1, Thames Rovers 0');   // the score line keeps its names and numbers
  expect(none).toBeNull();
  expect(errs).toEqual([]);
});

test('Camera presets, speed and names sit behind Demo controls, one click away', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  const btn = f.locator('#mc-demo');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(f.locator('#cams')).toBeHidden();
  await expect(f.locator('#play')).toBeHidden();
  await expect(f.locator('#mc-pause')).toBeVisible();          // Pause stays one tap away while the speed group is folded (it presses the real button)
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expect(f.locator('#cams')).toBeVisible();
  await expect(f.locator('#play')).toBeVisible();
  await expect(f.locator('#cpbtn')).toBeVisible();   // Copilot stays on the first screen
  expect(errs).toEqual([]);
});

test('the first Verifier-checked line comes early: within the first match minute, about 20 s at normal speed', async ({ page }) => {
  test.setTimeout(300_000);
  await openShell(page, 'watch');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  let steps = 0, found: { text: string; minute: number } | null = null;
  for (let i = 0; i < 100 && !found; i++) {   // 20 steps of 0.05 s = 1 s at normal speed
    await stepSim(f, 20); steps += 20;
    found = await page.evaluate(() => { const c = AG.run && AG.run.claims.find((x: any) => x.verdict === 'verified'); return c ? { text: c.text, minute: c.minute } : null; });
  }
  expect(found, 'a verified claim within 100 s at normal speed').not.toBeNull();
  expect(found!.minute).toBeLessThanOrEqual(2);
  expect(steps * 0.05, 'seconds at 1x until the first verified claim').toBeLessThanOrEqual(45);
});
