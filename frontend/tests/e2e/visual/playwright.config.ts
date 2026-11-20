import { defineConfig, devices } from '@playwright/test';

// Visual regression suite for the dashboard. See ./README.md.
//
// Baselines are rendered on Linux in the official Playwright image (same as
// CI) so fonts and anti-aliasing match pixel for pixel. Use
// `npm run test:visual:docker` from macOS/Windows.

const PORT = Number(process.env.VISUAL_PORT ?? 3300);
const BASE_URL = process.env.VISUAL_BASE_URL ?? `http://localhost:${PORT}`;
const IS_CI = !!process.env.CI;

if (process.platform !== 'linux' && !process.env.VISUAL_ALLOW_HOST) {
  throw new Error(
    'Visual baselines are rendered on Linux; host rendering differs and every snapshot would fail.\n' +
      'Run `npm run test:visual:docker` (or `npm run test:visual:docker -- --update-snapshots`).\n' +
      'Set VISUAL_ALLOW_HOST=1 to run here anyway, e.g. to debug a single test.',
  );
}

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.visual.spec.ts',
  // One platform-independent baseline per project; the Linux guard above keeps
  // them comparable.
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  outputDir: '../../../test-results/visual',

  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 1 : 0,
  workers: IS_CI ? 2 : undefined,
  timeout: 90_000,

  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      // Baselines and CI render in the same image, so no pixel budget: even a
      // changed table cell must fail. `threshold` only absorbs per-pixel
      // anti-aliasing noise.
      threshold: 0.2,
      maxDiffPixels: 0,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      stylePath: './screenshot.css',
    },
  },

  reporter: IS_CI
    ? [
        ['list'],
        ['github'],
        ['html', { open: 'never', outputFolder: '../../../playwright-report/visual' }],
        ['json', { outputFile: '../../../test-results/visual/results.json' }],
      ]
    : [['list'], ['html', { open: 'never', outputFolder: '../../../playwright-report/visual' }]],

  use: {
    baseURL: BASE_URL,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],

  webServer: {
    // Production build: no dev overlay or on-demand compilation to race with.
    // No `--hostname`: binding next to 127.0.0.1 makes the next-intl
    // middleware rewrite to `localhost`, which Next proxies back through the
    // middleware and redirects in a loop.
    command: process.env.VISUAL_SKIP_BUILD
      ? `npm run start -- --port ${PORT}`
      : `npm run build && npm run start -- --port ${PORT}`,
    cwd: '../../..',
    url: BASE_URL,
    reuseExistingServer: !IS_CI,
    timeout: 600_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { NEXT_TELEMETRY_DISABLED: '1', SENTRY_AUTH_TOKEN: '' },
  },
});
