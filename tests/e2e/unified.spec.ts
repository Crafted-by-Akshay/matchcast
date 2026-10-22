import { test, expect, type Frame, type Page } from '@playwright/test';
import { collectErrors, openShell, ready, stepSim, viewFrame } from './helpers';

// Top-level consts of the shell and the Analyst frame, so they are not on window.
declare const AG: any; declare const MCC: any; declare const D: any;

// Ported from apps/unified/tests/unified.cjs. One shared page: the checks follow one session through the three views.
test.describe.configure({ mode: 'serial' });

let page: Page; let watch: Frame; let analyst: Frame; let errs: string[]; let seed: string; let fxTeams: string[];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  errs = collectErrors(page);
});
test.afterAll(async () => { await page.close(); });

test('season fixtures load into the picker', async () => {
  await openShell(page, 'watch');
  expect(await page.locator('#fx option').count()).toBe(28);
  fxTeams = await page.evaluate(async () => { const L = await fetch('shared/fixtures.json').then((r) => r.json()); const x = L.find((q: any) => q.id === (document.getElementById('fx') as HTMLSelectElement).value); return [x.home.club, x.away.club]; });
});

test('Watch kicks off with the shared setup and plays the fixture clubs', async () => {
  watch = await viewFrame(page, 'watch');
  await ready('watch')(page);
  const s = await watch.evaluate(() => { const m = (window as any).__mc; return { started: m.S.started, seed: String(m.SET().seed), teams: [0, 1].map((t) => m.players.find((q: any) => q.ti === t).T.club) }; });
  expect(s.started).toBe(true);
  expect(s.teams).toEqual(fxTeams);
  seed = s.seed;
});

test('Analyst opens the season and routes to the shared fixture', async () => {
  await page.click('#tab-analyst');
  await ready('analyst', 60_000)(page);
  analyst = await viewFrame(page, 'analyst');
  await expect.poll(() => analyst.evaluate(() => D?.matches.length)).toBe(28);
  await expect.poll(() => analyst.evaluate(() => location.hash)).toMatch(/^#match\.M/);
});

test('Broadcast starts on the shared seed and clubs', async () => {
  await page.click('#tab-broadcast');
  await ready('broadcast')(page);
  const bc = await viewFrame(page, 'broadcast');
  const s = await bc.evaluate(() => { const m = (window as any).__mc; return { seed: String(m.SET().seed), teams: [0, 1].map((t) => m.players.find((q: any) => q.ti === t).T.club) }; });
  expect(s.seed).toBe(seed);
  expect(s.teams).toEqual(fxTeams);
});

test('switching back keeps Watch on the same match', async () => {
  await page.click('#tab-watch');
  const s = await watch.evaluate(() => ({ started: (window as any).__mc.S.started, seed: String((window as any).__mc.SET().seed) }));
  expect(s).toEqual({ started: true, seed });
});

test('Watch events reach the agents, the audit chain verifies and the Agents tab shows provenance', async () => {
  await expect.poll(async () => { await stepSim(watch); return page.evaluate(() => AG?.run?.stat.verified ?? 0); }, { timeout: 120_000, message: 'no verified claims' }).toBeGreaterThan(0);
  const run = await page.evaluate(() => ({ events: AG.run.stat.events, claims: AG.run.claims.length }));
  expect(run.events).toBeGreaterThan(0); expect(run.claims).toBeGreaterThan(0);
  const chain = await page.evaluate(() => MCC.verify());
  expect(chain.ok && chain.count > 0, 'audit chain should verify').toBe(true);
  await page.keyboard.press('4');
  await expect(page.locator('#v-agents')).toBeVisible();
  expect(await page.locator('#ag-claims tr[data-id]').count()).toBeGreaterThan(0);
  await expect(page.locator('#ag-prov dl')).toBeVisible();
  await page.click('#ag-verify');
  await expect(page.locator('#ag-verify-out')).toContainText(/^Chain intact/);
});

test('Broadcast scoreboard shows Watch\'s score', async () => {
  await page.click('#tab-watch');
  const bc = await viewFrame(page, 'broadcast');
  await expect.poll(async () => (await bc.evaluate(() => document.getElementById('bc-score')!.textContent)) === (await watch.evaluate(() => (window as any).__mc.S.score.join('–'))), { timeout: 10_000 }).toBe(true);
});

test('full time in Watch reaches the Analyst library', async () => {
  await watch.evaluate(() => { (window as any).__mc.S.over = true; });
  await expect.poll(() => analyst.evaluate(() => D.matches.filter((m: any) => m.imported).length), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
});

test('a fixture change reloads Watch with the new seed; New match in Broadcast makes it custom', async () => {
  test.setTimeout(480_000); // Broadcast restarts its engine after the change; software rendering on CI is slow
  await page.click('#tab-watch'); // the shell reloads only the visible view when the fixture changes
  await expect(page.locator('#v-watch')).toBeVisible();
  const first = await page.locator('#fx').inputValue();
  const other = await page.$$eval('#fx option', (os, cur) => os.map((o: any) => o.value).find((v) => v && v !== cur), first);
  await page.selectOption('#fx', other!);
  const newSeed = await page.evaluate(async (id) => (await fetch('shared/fixtures.json').then((r) => r.json())).find((x: any) => x.id === id).setup.seed, other);
  await expect.poll(async () => (await page.$$eval('#v-watch iframe', (x) => x.map((i: any) => i.getAttribute('src'))))[0] ?? '', { timeout: 60_000, message: 'Watch iframe never got the new fixture seed' }).toContain('seed=' + newSeed);
  await page.click('#tab-broadcast');
  // wait for the reloaded desk (new document, new seed), not the previous one that is still attached while it navigates
  await expect.poll(async () => { const f = page.frames().find((x) => /broadcast\/index\.html/.test(x.url())); return f ? f.evaluate((n) => { const m = (window as any).__mc; return !!(m && m.S.started && String(m.SET().seed) === String(n)); }, newSeed).catch(() => false) : false; }, { timeout: 240_000, intervals: [2000], message: 'Broadcast never restarted on the new fixture' }).toBe(true);
  const bc = page.frames().find((x) => /broadcast\/index\.html/.test(x.url()))!;
  await bc.evaluate(() => document.getElementById('bc-new')!.click());
  await expect(page.locator('#fx')).toHaveValue('custom', { timeout: 30_000 });
});

test('keys 3 and 1 switch views', async () => {
  // keys are handled by the shell; after a view loads, focus can sit inside its iframe, which swallows them
  const toShell = () => page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.focus(); });
  await toShell();
  await page.keyboard.press('3'); await expect(page.locator('#v-broadcast')).toBeVisible({ timeout: 15_000 });
  await toShell(); await page.keyboard.press('1'); await expect(page.locator('#v-watch')).toBeVisible({ timeout: 15_000 });
});

test('phone width has no horizontal page scroll', async ({ browser }) => {
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  collectErrors(m).forEach((e) => errs.push(e));
  await m.goto('/index.html#analyst', { waitUntil: 'domcontentloaded' });
  await m.waitForTimeout(2500);
  expect(await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await m.close();
});

test('no page errors during the session', () => { expect(errs).toEqual([]); });
