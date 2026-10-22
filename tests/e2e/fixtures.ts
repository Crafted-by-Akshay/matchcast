import { test as base, expect, type BrowserContext } from '@playwright/test';

// QUA-9 task 311: a network guard for every spec. Tests run against fakes, so a request to Azure is a bug: it is blocked and fails the test.
// Specs import `test` from here (re-exporting everything else from Playwright). A live run (E2E_BASE_URL) talks to the real deployment and is not guarded.
export * from '@playwright/test';

const BLOCKED = ['azure.com', 'cognitiveservices.azure.com', 'openai.azure.com', 'search.windows.net'];
export const isAzureHost = (host: string) => BLOCKED.some((s) => host === s || host.endsWith('.' + s));

export const test = base.extend<{ azureHits: string[]; azureGuard: void }>({
  azureHits: async ({}, use) => { await use([]); },
  azureGuard: [async ({ browser, context, azureHits }, use) => {
    const guard = (c: BrowserContext) => c.route((url) => isAzureHost(url.hostname), (route) => { azureHits.push(route.request().url()); return route.abort('blockedbyclient'); });
    const newContext = browser.newContext.bind(browser);
    if (!process.env.E2E_BASE_URL) {
      await guard(context);
      // Specs that open their own context or page (browser.newPage calls newContext) are guarded too.
      browser.newContext = (async (...a: Parameters<typeof newContext>) => { const c = await newContext(...a); await guard(c); return c; }) as typeof browser.newContext;
    }
    await use();
    browser.newContext = newContext;
    expect(azureHits, 'this test sent a request to an Azure host; fake it instead').toEqual([]);
  }, { auto: true }],
});
