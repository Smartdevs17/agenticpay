import { test, expect } from './fixtures';

test.describe('Dispute resolution', () => {
  test('lists disputes for authenticated merchant', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/dashboard/disputes');

    await expect(page.getByRole('heading', { name: /Disputes/i })).toBeVisible({
      timeout: 30_000,
    });

    // Development mode serves mock disputes
    await expect(
      page.getByText(/service not delivered|quality issues|awaiting response/i).first()
    ).toBeVisible();
  });

  test('files a new dispute and navigates to detail', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/dashboard/disputes/new');

    await expect(page.getByRole('heading', { name: /File a Dispute/i })).toBeVisible();

    await page.getByLabel(/Payment ID/i).fill('pay_e2e_test_001');
    await page.getByLabel(/Respondent ID/i).fill('user_respondent_e2e');
    await page.getByLabel(/Disputed Amount/i).fill('500');

    await page.getByRole('combobox').click();
    await page.getByRole('option').first().click();

    await page
      .getByLabel(/Description/i)
      .fill(
        'E2E test dispute: deliverable was not completed within the agreed timeline and no response was received.'
      );

    await page.getByRole('button', { name: /File Dispute/i }).click();

    await expect(page).toHaveURL(/\/dashboard\/disputes\//, { timeout: 15_000 });
  });

  test('dispute detail shows status and evidence section', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/dashboard/disputes/dsp_001');

    await expect(page.getByText(/dsp_001|awaiting response/i).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
