import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// Highlights (apps/unified/highlights.js, Watch after full time): one card per goal, red card and big chance, each with its own
// commentary, why it mattered, strategy, technique and insight. The shell opens the panel from the full-time recap card.
// Shell-driven: the events are handed to HL in the page, as Watch's batches would be.
declare const HL: any;
declare function paintHighlights(): void;

test('highlights: after full time the panel lists one card per key moment, and skip moves on', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  await ready('watch')(page);
  await page.evaluate(() => {
    HL.side = (t: string) => (t === 'H' ? 0 : t === 'A' ? 1 : -1);
    HL.reset({ home: 'Thames Rovers', away: 'Coloso Ciudad' }, ['4-3-3', '4-4-2']);
    // Watch's frames, a quarter second apart on the match clock: the ring fills before the events arrive, then each moment's clip is filled
    // Watch's frame fields, which the desk's consumer reads
    const frames = (from: number, to: number) => { const out: any[] = []; for (let c = from; c <= to + 1e-9; c += 0.25) out.push({ mclock: +c.toFixed(2), score: [0, 0], half: 1, ht: false, over: false, paused: false, speed: 1, stats: {}, players: [], officials: [], ball: [52.5, 34, 0] });  return out; };
    for (const f of frames(0, 30)) HL.frame(f);
    HL.add([
      { type: 'shot', minute: 12, team: 'H', player: 'Ana', xg: 0.31, x: 92, y: 34, fate: 'miss' },
      { type: 'shot', minute: 27, team: 'H', player: 'Ana', xg: 0.31, x: 92, y: 34, fate: 'goal' },
      { type: 'goal', minute: 27, team: 'H', player: 'Ana' },
      { type: 'red_card', minute: 60, team: 'A', player: 'Luis' },
    ]);
    for (const f of frames(30.25, 40)) HL.frame(f);
    paintHighlights();
  });
  await expect(page.locator('#hl-open')).toBeVisible();
  await page.locator('#hl-open').click();
  const cards = page.locator('#hl-list .hl-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('Big chance · Ana');
  await expect(cards.nth(1)).toContainText("27' Ana scores for Thames Rovers. Thames Rovers 1-0 Coloso Ciudad after the goal.");
  await expect(cards.nth(1)).toContainText('Opens the scoring.');
  await expect(cards.nth(2)).toContainText('Coloso Ciudad are down to 10 men.');
  await expect(page.locator('#hl-n')).toHaveText('3 moments');
  await expect(page.locator('#hl-list .hl-3d')).toHaveCount(3);
  await expect(page.locator('#hl-3d')).toBeVisible();
  await expect(cards.nth(0)).toHaveAttribute('aria-current', 'true');
  await page.locator('#hl-skip').click();
  await expect(cards.nth(1)).toHaveAttribute('aria-current', 'true');
  await page.locator('#hl-close').click();
  await expect(page.locator('#hl')).toBeHidden();
  // the 3D replay: the moment's clip plays on the Broadcast desk with its caption (the desk's pitch loads first)
  await page.locator('#hl-open').click();
  await page.locator('#hl-list .hl-3d').nth(1).click();
  const desk = await viewFrame(page, 'broadcast');
  await expect.poll(() => desk.evaluate(() => !!(window as any).MCReplay && !!(window as any).__mc?.S.started), { timeout: 240_000 }).toBe(true);
  await expect(desk.locator('#mc-clip-k')).toHaveText('Highlight 1 of 1', { timeout: 90_000 });
  await expect(desk.locator('#mc-clip-t')).toContainText('Goal · Ana');
  await desk.locator('#mc-clip-stop').click();
  await expect(desk.locator('#mc-clip')).toBeHidden();
  expect(errs).toEqual([]);
});
