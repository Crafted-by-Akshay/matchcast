import { defineConfig } from '@playwright/test';

const live = process.env.E2E_BASE_URL;
const chromiumPath = process.env.CHROMIUM_PATH || (process.env.CI ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  retries: process.env.CI ? 1 : 0,
  // Software-rendered WebGL is CPU bound; CI shards the suite across jobs instead of adding workers.
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: live || 'http://localhost:4173',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          executablePath: chromiumPath,
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  // Live runs use the deployed URL; otherwise build and serve the unified app locally (no Azure calls).
  webServer: live ? undefined : { command: 'node tests/e2e/serve.mjs', url: 'http://localhost:4173/index.html', reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
