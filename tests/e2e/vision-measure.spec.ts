import { test, expect } from './fixtures';
import fs from 'node:fs';

// DAT-11 task 279 (harness):  the Vision tracker's accuracy on 3 seeds per camera, measured against engine truth. A capture costs about 6.5 s in software WebGL (the sandbox), so 5 minutes of match is hours; run it on a machine with a GPU (the Mac mini). It only runs
// when MEASURE=1: `MEASURE=1 make e2e E2E_ARGS="tests/e2e/vision-measure.spec.ts"`. It writes the numbers to $MEASURE_OUT (default /tmp/vision-measure.json).
const SEEDS = (process.env.MEASURE_SEEDS || '11,22,33').split(',').map(Number);
const CAMS: [string, string][] = [['broadcast', 'Broadcast'], ['high', 'Tactical']];
const CAPTURES = Number(process.env.MEASURE_CAPTURES || 150);
const LOOP_MS = Number(process.env.MEASURE_TIMEOUT_S || 1800) * 1000;   // wall-clock cap per run; a capture is ~6.5 s in software WebGL, ~20 ms on a GPU

test.describe('vision measurement', () => {
  test.skip(!process.env.MEASURE, 'set MEASURE=1 to run the slow vision measurement');
  const out: any[] = [];
  test.afterAll(() => fs.writeFileSync(process.env.MEASURE_OUT || '/tmp/vision-measure.json', JSON.stringify(out, null, 1)));
  for (const [cam, label] of CAMS) for (const seed of SEEDS) {
    test(`${cam} camera, seed ${seed}`, async ({ page }) => {
      test.setTimeout(LOOP_MS + 300_000);
      await page.goto(`/watch/index.html?seed=${seed}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as any).__mc && (window as any).__mc.players.length > 0 && document.getElementById('load')!.hidden, null, { timeout: 240_000 });
      await page.evaluate((l) => { for (const b of document.querySelectorAll('#cams button')) if ((b.textContent || '').trim() === l) (b as HTMLElement).click(); }, label);
      await page.evaluate(() => { const b = document.getElementById('visb') as HTMLElement; if (b.getAttribute('aria-pressed') !== 'true') b.click(); });
      const t0 = Date.now(); let r: any = null;
      try {
        while (Date.now() - t0 < LOOP_MS) {
          await page.waitForTimeout(3000);   // the engine's own loop drives the tracker; stepping the sim by hand makes players jump between captures and ruins tracking
          r = await page.evaluate(() => (window as any).mcVisReport());
          if (r && r.captures >= CAPTURES) break;
        }
      } finally {
        out.push({ camera: cam, seed, wall_s: Math.round((Date.now() - t0) / 1000), reached: !!r && r.captures >= CAPTURES, report: r });   // a short or failed run keeps its partial numbers
      }
      expect(r && r.captures, `only ${r && r.captures} of ${CAPTURES} captures in ${LOOP_MS / 1000} s`).toBeGreaterThanOrEqual(CAPTURES);
    });
  }
});
