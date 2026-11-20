import { expect, test } from '@playwright/test';
import { VISUAL_ROUTES } from './routes';
import { stabilize, waitForSettled } from './stabilize';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.describe('dashboard visual regression', () => {
  for (const route of VISUAL_ROUTES) {
    test(`${route.name} matches its baseline`, async ({ page, baseURL }) => {
      const { unmockedRequests } = await stabilize(page, {
        baseURL: baseURL!,
        authenticated: route.authenticated,
      });

      await page.goto(route.path);
      await expect(route.ready(page)).toBeVisible();
      // A hard load must keep a signed-in user on the page, not bounce to /auth.
      await expect(page).toHaveURL(new RegExp(`${escapeRegExp(route.path)}$`));
      await page.evaluate(() => document.fonts.ready);
      await waitForSettled(page);

      await expect(page).toHaveScreenshot(`${route.name}.png`, {
        fullPage: true,
        mask: route.mask?.(page),
      });
      expect(unmockedRequests(), 'backend calls with no fixture in stabilize.ts').toEqual([]);
    });
  }
});

test.describe('dashboard failure states', () => {
  test('signed-out visitors are sent to sign in', async ({ page, baseURL }) => {
    await stabilize(page, { baseURL: baseURL!, authenticated: false });

    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.getByRole('heading', { name: /Welcome to AgenticPay/i })).toBeVisible();
  });

  test('webhooks page degrades to an empty state when the backend is down', async ({ page, baseURL }) => {
    await stabilize(page, { baseURL: baseURL!, authenticated: true, backend: 'down' });

    await page.goto('/dashboard/webhooks');

    // The client retries 5xx with backoff before surfacing the error. The page
    // loads twice on mount, so the toast can appear twice.
    await expect(page.getByText('Failed to load webhook data').first()).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await waitForSettled(page);
    await expect(page).toHaveScreenshot('dashboard-webhooks-backend-down.png', { fullPage: true });
  });
});
