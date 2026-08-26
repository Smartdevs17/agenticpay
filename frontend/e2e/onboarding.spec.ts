import { test, expect } from './fixtures';
import path from 'path';
import fs from 'fs';
import os from 'os';

test.describe('Merchant onboarding', () => {
  test.use({ withOnboardingMocks: true });

  test('loads onboarding checklist with progress', async ({ page }) => {
    await page.route('**/api/v1/onboarding/**', async (route) => {
      if (route.request().method() === 'GET') {
        const { MOCK_ONBOARDING } = await import('./helpers/test-data');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: MOCK_ONBOARDING }),
        });
      }
      return route.continue();
    });

    await page.goto('/onboarding');

    await expect(
      page.getByText(/E2E Test Merchant|Business License/i).first()
    ).toBeVisible({ timeout: 30_000 });
  });

  test('document upload completes onboarding task', async ({
    authenticatedPage: page,
  }) => {
    await page.route('**/api/v1/onboarding/**', async (route) => {
      const { MOCK_ONBOARDING } = await import('./helpers/test-data');
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: MOCK_ONBOARDING }),
        });
      }
      return route.continue();
    });

    await page.goto('/onboarding');

    await expect(page.getByText(/Upload/i).first()).toBeVisible({ timeout: 30_000 });

    const tmpFile = path.join(os.tmpdir(), `e2e-license-${Date.now()}.pdf`);
    fs.writeFileSync(tmpFile, '%PDF-1.4 e2e test document');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(tmpFile);

    await expect(page.getByText(/Upload Document|Uploading/i).first()).toBeVisible();

    const uploadBtn = page.getByRole('button', { name: /Upload Document/i });
    if (await uploadBtn.isVisible()) {
      await uploadBtn.click();
    }

    await expect(page.getByText(/100%|Complete|Uploaded/i).first()).toBeVisible({
      timeout: 20_000,
    });

    fs.unlinkSync(tmpFile);
  });
});
