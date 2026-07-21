import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173'
const managesLocalServer = process.env.PLAYWRIGHT_BASE_URL === undefined

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Keep performance observations isolated from other GPU- and CPU-heavy routes.
  workers: 1,
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never', outputFolder: 'artifacts/playwright-report' }]]
    : 'line',
  outputDir: 'artifacts/playwright-results',
  snapshotPathTemplate: '{testDir}/snapshots/{arg}{ext}',
  expect: {
    timeout: 8_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      threshold: 0.22,
      maxDiffPixelRatio: 0.015,
    },
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  webServer: managesLocalServer
    ? {
        command: 'npm run preview -- --host 127.0.0.1 --port 4173',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: {
          ...process.env,
          VITE_API_URL: 'http://api.velostra.test',
          VITE_ESCROW_ADDRESS: '0x1111111111111111111111111111111111111111',
          VITE_SETTLEMENT_TOKEN: '0x2222222222222222222222222222222222222222',
        },
      }
    : undefined,
  projects: [
    {
      name: 'chromium-performance',
      testMatch: /performance\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      testIgnore: /performance\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
