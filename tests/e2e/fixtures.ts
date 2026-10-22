import { test as base, expect } from '@playwright/test';

// QUA-9 task 311: a network guard for every spec. Tests run against fakes, so a request to Azure is a bug: it is blocked and fails the test.
// Specs import `test` from here (re-exporting everything else from Playwright). A live run (E2E_BASE_URL) talks to the real deployment and is not guarded.
export * from '@playwright/test';

const BLOCKED = ['azure.com', 'cognitiveservices.azure.com', 'openai.azure.com', 'search.windows.net'];
export const isAzureHost = (host: string) => BLOCKED.some((s) => host === s || host.endsWith('.' + s));

export const test = base.extend<{ azureGuard: void }>({
  azureGuard: [async ({ context }, use) => {
    const hits: string[] = [];
    if (!process.env.E2E_BASE_URL) await context.route((url) => isAzureHost(url.hostname), (route) => { hits.push(route.request().url()); return route.abort('blockedbyclient'); });
    await use();
    expect(hits, 'this test sent a request to an Azure host; fake it instead').toEqual([]);
  }, { auto: true }],
});
