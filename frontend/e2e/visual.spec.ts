import { test, expect } from './fixtures';

// Visual regression tests. Snapshots are committed under e2e/__snapshots__.
// Update with: npm run test:e2e:update-snapshots
//
// Animations are disabled at the config level (expect.toHaveScreenshot), and
// we wait for network idle to reduce flake from fonts/images loading late.
//
// We pin visuals to chromium so we only maintain a single set of baseline
// images — the cross-browser projects still run every other spec.
test.describe('Visual regression', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Visual snapshots are only maintained for chromium',
  );

  test('landing page', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page).toHaveScreenshot('landing.png', { fullPage: true });
  });

  test('auth page', async ({ page }) => {
    await page.goto('/auth', { waitUntil: 'networkidle' });
    await expect(page).toHaveScreenshot('auth.png', { fullPage: true });
  });
});
