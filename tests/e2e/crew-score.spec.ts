import { test, expect } from './fixtures';
import { openShell } from './helpers';

// AB#442: the live accuracy scoreboard in the Agents tab (flag ?crew=1). It draws only CREW.state.score.
declare const CREW: any;
test.skip(!!process.env.E2E_BASE_URL, 'PR checks only: the fixture feeds the data');

const score = {
  method: 'Each line graded against simulator truth',
  arms: {
    full_crew: { accuracy: 0.99, catch_rate: 1, latency_ms: 2100, cost: 0.011, n: 30 },
    single_agent: { accuracy: 0.9, catch_rate: 0, latency_ms: 1300, cost: 0.004, n: 30 },
    crew_no_verifier: { accuracy: 0.93, catch_rate: 0.5, latency_ms: 1800, cost: 0.009, n: 28, precomputed: true, run_id: 'run-7' },
  },
};

async function open(page: any, query = '?crew=1') {
  await page.route(/\/(watch|broadcast)\/index\.html/, (r: any) => r.abort());
  await openShell(page, 'agents', query);
}

test('the scoreboard stays out of the Agents tab without the flag', async ({ page }) => {
  await open(page, '');
  await expect(page.locator('#crew-score')).toBeAttached();
  await expect(page.locator('#crew-score')).toBeEmpty();
});

test('three arms side by side with accuracy headline, small figures, method and a Simulated label', async ({ page }) => {
  await open(page);
  const root = page.locator('#crew-score');
  await expect(root).toContainText('Waiting for graded lines');
  await page.evaluate((s) => CREW.ingest({ kind: 'score', score: s }), score);
  const arms = root.locator('.cs-arm');
  await expect(arms).toHaveCount(3);
  await expect(arms.nth(0)).toHaveAttribute('data-arm', 'full_crew');
  await expect(arms.nth(1)).toHaveAttribute('data-arm', 'single_agent');
  await expect(arms.nth(2)).toHaveAttribute('data-arm', 'crew_no_verifier');
  await expect(arms.nth(0)).toContainText('Full crew');
  await expect(arms.nth(0).locator('.cs-acc')).toHaveText('99%');
  await expect(arms.nth(1).locator('.cs-acc')).toHaveText('90%');
  await expect(arms.nth(0)).toContainText('30 lines graded');
  await expect(arms.nth(0)).toContainText('Catch rate');
  await expect(arms.nth(0)).toContainText('2.1 s');
  await expect(arms.nth(0)).toContainText('$0.011');
  await expect(root).toContainText('Each line graded against simulator truth');
  await expect(root.locator('.cs-badge.sim')).toHaveText('Simulated');
  // bar widths follow accuracy, and each arm has its own pattern as well as colour
  const w = await root.locator('.cs-fill').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.width));
  expect(w).toEqual(['99%', '90%', '93%']);
  const pats = await root.locator('.cs-fill').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.pattern));
  expect(new Set(pats).size).toBe(3);
  // table fallback carries the same numbers
  await expect(root.locator('table tbody tr')).toHaveCount(3);
  await expect(root.locator('table tbody tr').nth(2)).toContainText('93%');
});

test('Precomputed is marked per arm, and Simulated goes away when the data is not simulated', async ({ page }) => {
  await open(page);
  const root = page.locator('#crew-score');
  await page.evaluate((s) => CREW.ingest({ kind: 'score', score: s }), score);
  await expect(root.locator('.cs-arm[data-arm="crew_no_verifier"] .cs-badge.pre')).toContainText('Precomputed');
  await expect(root.locator('.cs-arm[data-arm="crew_no_verifier"]')).toContainText('run-7');
  await expect(root.locator('.cs-arm[data-arm="full_crew"] .cs-badge.pre')).toHaveCount(0);
  await page.evaluate((s) => { CREW.state.simulated = false; CREW.ingest({ kind: 'score', score: s }); }, score);
  await expect(root.locator('.cs-badge.sim')).toHaveCount(0);
});

test('phone width does not scroll sideways, and reduced motion drops the bar transition', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await page.evaluate((s) => CREW.ingest({ kind: 'score', score: s }), score);
  await expect(page.locator('#crew-score .cs-arm')).toHaveCount(3);
  const over = await page.evaluate(() => {
    const r = document.getElementById('crew-score')!;
    const v = document.getElementById('v-agents')!;
    return { root: r.scrollWidth - r.clientWidth, view: v.scrollWidth - v.clientWidth, doc: document.documentElement.scrollWidth - innerWidth };
  });
  expect(over.root).toBeLessThanOrEqual(0);
  expect(over.view).toBeLessThanOrEqual(0);
  expect(over.doc).toBeLessThanOrEqual(0);
  const tr = await page.locator('#crew-score .cs-fill').first().evaluate((e) => getComputedStyle(e).transitionDuration);
  expect(tr).toBe('0s');
});
