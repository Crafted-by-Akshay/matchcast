import { test, expect, isAzureHost } from './fixtures';

// QUA-9 task 311: the guard recognises Azure hosts exactly, and a request to one fails the test that made it.
test('guard: Azure hosts are matched by suffix, look-alikes are not', () => {
  for (const h of ['azure.com', 'x.cognitiveservices.azure.com', 'r.openai.azure.com', 'idx.search.windows.net', 'a.b.azure.com', 'eastus2.stt.speech.microsoft.com', 'api.cognitive.microsofttranslator.com', 'eastus2.api.cognitive.microsoft.com']) expect(isAzureHost(h), h).toBe(true);
  for (const h of ['azure.com.evil.org', 'notazure.com', 'localhost', 'api.test', 'search.windows.net.example.com', 'myazure.com', 'microsoft.com.evil.org']) expect(isAzureHost(h), h).toBe(false);
});

test.describe('a request to Azure', () => {
  test.skip(!!process.env.E2E_BASE_URL, 'the guard is off in live runs');
  for (const own of [false, true]) {
    test(`is blocked and recorded${own ? ' (page from browser.newPage)' : ''}`, async ({ page, browser, azureHits }) => {
      const p = own ? await browser.newPage() : page;
      await p.goto('/index.html', { waitUntil: 'domcontentloaded' });
      const failed = await p.evaluate(() => fetch('https://demo.openai.azure.com/openai/deployments').then(() => false, () => true));
      expect(failed).toBe(true);
      expect(azureHits).toEqual(['https://demo.openai.azure.com/openai/deployments']);
      azureHits.length = 0;   // recorded and checked here, so the fixture's own end-of-test check passes
      if (own) await p.close();
    });
  }
});
