import { test, expect } from './fixtures';

test.describe('Auth page', () => {
  test('renders the auth surface with both login methods', async ({ page }) => {
    await page.goto('/auth');

    await expect(
      page.getByRole('heading', { name: /Welcome to AgenticPay/i }),
    ).toBeVisible();

    await expect(
      page.getByRole('tab', { name: /Social Login/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('tab', { name: /Web3 Wallet/i }),
    ).toBeVisible();
  });

  test('defaults to the social login tab with social providers', async ({ page }) => {
    await page.goto('/auth');

    const socialTab = page.getByRole('tab', { name: /Social Login/i });
    await expect(socialTab).toHaveAttribute('data-state', 'active');

    await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue with Twitter/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue with Email/i })).toBeVisible();
  });

  test('switches to the wallet tab and shows wallet options', async ({ page }) => {
    await page.goto('/auth');

    await page.getByRole('tab', { name: /Web3 Wallet/i }).click();

    await expect(
      page.getByRole('tab', { name: /Web3 Wallet/i }),
    ).toHaveAttribute('data-state', 'active');
  });

  test('shows the terms disclosure', async ({ page }) => {
    await page.goto('/auth');

    await expect(
      page.getByText(/By continuing, you agree to our Terms of Service/i),
    ).toBeVisible();
  });
});
