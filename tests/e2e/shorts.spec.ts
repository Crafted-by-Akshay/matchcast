import { test, expect } from './fixtures';
import { collectErrors, openShell, ready } from './helpers';

// Auto Shorts (apps/unified/shorts.js, Highlights tab): each clip with frames is a 9:16 canvas with its commentary as the caption.
// Shell-driven: the frames and events are handed to HL in the page, as Watch's batches would be.
declare const HL: any;
declare function paintHighlights(): void;

test('shorts: each key moment with frames gets a 9:16 canvas with its commentary, and Play short runs it', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  await ready('watch')(page);
  await page.evaluate(() => {
    HL.side = (t: string) => (t === 'H' ? 0 : t === 'A' ? 1 : -1);
    HL.reset({ home: 'Thames Rovers', away: 'Coloso Ciudad' }, ['4-3-3', '4-4-2']);
    const frames = (from: number, to: number) => { const out: any[] = []; for (let c = from; c <= to + 1e-9; c += 0.25) out.push({ mclock: +c.toFixed(2), score: [0, 0], half: 1, ht: false, over: false, paused: false, speed: 1, stats: {}, players: Array.from({ length: 22 }, (_, i) => [20 + i * 2, 10 + i, 0, 0]), officials: [], ball: [52.5, 34, 0] }); return out; };
    for (const f of frames(0, 30)) HL.frame(f);
    HL.add([
      { type: 'shot', minute: 27, team: 'H', player: 'Ana', xg: 0.31, x: 92, y: 34, fate: 'goal' },
      { type: 'goal', minute: 27, team: 'H', player: 'Ana' },
    ]);
    for (const f of frames(30.25, 40)) HL.frame(f);
    HL.finish();
    paintHighlights();
  });
  await page.locator('#more-toggle').click();
  await page.locator('#tab-highlights').click();
  await expect(page).toHaveURL(/#highlights$/);
  const short = page.locator('#highlight-grid .highlight-card').first();
  await expect(short.locator('canvas.short-canvas')).toHaveCount(1);
  await expect(short).toContainText('SIMULATED MOMENT · 27\'');   // the card still says it is simulated
  await expect(short.locator('.short-caption')).toContainText("27' Ana scores for Thames Rovers");
  // the caption is handed to the voice line (voice.js), once per short
  await page.evaluate(() => {
    const w = window as any; w.said = [];
    const say = VC.say; VC.say = (text: string, o: any) => { w.said.push(text); return say(text, o); };
  });
  await short.getByRole('button', { name: 'Play short' }).click();
  await expect(short.getByRole('button', { name: 'Stop short' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).said)).toEqual(["27' Ana scores for Thames Rovers. Thames Rovers 1-0 Coloso Ciudad after the goal."]);
  expect(errs).toEqual([]);
});
