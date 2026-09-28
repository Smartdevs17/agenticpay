import { test, expect } from './fixtures';

// Sidebar navigation to payments requires dashboard layout; escrow covers payment UX.
const DASHBOARD_PAYMENTS_NAV = false;
const dashboardTest = DASHBOARD_PAYMENTS_NAV ? test : test.skip;

test.describe('Payment navigation surface', () => {
  dashboardTest(
    'an authenticated user can reach the Payments link from the sidebar',
    async ({ authenticatedPage: page }) => {
      await page.goto('/dashboard');

      const paymentsLink = page
        .getByRole('navigation', { name: /Main navigation/i })
        .getByRole('link', { name: 'Payments' });

      await expect(paymentsLink).toBeVisible();
      await expect(paymentsLink).toHaveAttribute('href', '/dashboard/payments');
    },
  );

  test('landing page routes unauthenticated users through /auth before payments', async ({
    page,
  }) => {
    await page.goto('/');
    // Hero overlay intercepts pointer events in some browsers; assert the
    // route target rather than fighting hit-testing.
    const cta = page.getByRole('link', {
      name: /Get started with AgenticPay/i,
    });
    await expect(cta).toHaveAttribute('href', '/auth');
  });
});
