import { test, expect, isAzureHost } from './fixtures';

// QUA-9 task 311: the guard recognises Azure hosts exactly, and a request to one fails the test that made it.
test('guard: Azure hosts are matched by suffix, look-alikes are not', () => {
  for (const h of ['azure.com', 'x.cognitiveservices.azure.com', 'r.openai.azure.com', 'idx.search.windows.net', 'a.b.azure.com']) expect(isAzureHost(h), h).toBe(true);
  for (const h of ['azure.com.evil.org', 'notazure.com', 'localhost', 'api.test', 'search.windows.net.example.com', 'myazure.com']) expect(isAzureHost(h), h).toBe(false);
});

test.describe('a request to Azure', () => {
  test.skip(!!process.env.E2E_BASE_URL, 'the guard is off in live runs');
  test.fail();   // expected to fail: the guard turns the blocked request into a failed test
  test('is blocked and fails the test', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => fetch('https://demo.openai.azure.com/openai/deployments').catch(() => null));
  });
});
