import { expect, type Frame, type Page } from '@playwright/test';

export const ready = (view: 'watch' | 'broadcast' | 'analyst', timeout = 240_000) =>
  (page: Page) => page.waitForFunction((v) => document.getElementById('v-' + v)!.classList.contains('ready'), view, { timeout });

export async function openShell(page: Page, hash = 'watch', query = '') {
  await page.goto('/index.html' + query + '#' + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
}

export async function viewFrame(page: Page, view: 'watch' | 'broadcast' | 'analyst'): Promise<Frame> {
  const re = new RegExp(view + '/index\\.html');
  await expect.poll(() => page.frames().some((f) => re.test(f.url())), { timeout: 100_000, message: `${view} frame never attached` }).toBe(true);
  return page.frames().find((f) => re.test(f.url()))!;
}

/** Collect uncaught page errors and console errors, ignoring blocked fonts and network noise. */
export function collectErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push('page: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  return errs;
}

/** Step Watch's simulation directly: the sandbox renders slowly and the frame loop caps each frame at 0.05 s of match time. */
export const stepSim = (f: Frame, steps = 3000) => f.evaluate((n) => { for (let i = 0; i < n; i++) (window as any).__mc.stepSim(0.05); }, steps);
