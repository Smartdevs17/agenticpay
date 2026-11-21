import type { Page } from '@playwright/test';
import { MOCK_ONBOARDING, buildMockPayment } from './test-data';

/** Intercept onboarding API routes with stable fixture data */
export async function mockOnboardingApi(page: Page): Promise<void> {
  await page.route('**/api/v1/onboarding/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (method === 'GET' && url.includes('/merchant/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: MOCK_ONBOARDING }),
      });
    }

    if (method === 'PATCH' && url.includes('/task')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            ...MOCK_ONBOARDING,
            progress: 66,
            tasks: MOCK_ONBOARDING.tasks.map((t, i) =>
              i === 0 ? { ...t, status: 'completed' } : t
            ),
          },
        }),
      });
    }

    if (method === 'POST' && url.includes('/documents')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { uploaded: true } }),
      });
    }

    return route.continue();
  });
}

/** Mock sandbox payment API (create → fund → confirm pipeline) */
export async function mockSandboxPaymentsApi(page: Page): Promise<void> {
  const payments = new Map<string, ReturnType<typeof buildMockPayment>['payment']>();

  await page.route('**/api/v1/sandbox/payments/**', async (route) => {
    const method = route.request().method();
    const url = route.request().url();

    if (method === 'POST' && url.endsWith('/process')) {
      const body = route.request().postDataJSON() as { projectId?: string; amount?: number };
      const txnId = `txn_${Date.now()}`;
      const payment = {
        ...buildMockPayment(txnId).payment,
        projectId: body?.projectId ?? 'proj_e2e',
        amount: body?.amount ?? 100,
        status: 'funded' as const,
      };
      payments.set(txnId, payment);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, payment }),
      });
    }

    if (method === 'GET') {
      const match = url.match(/payments\/([^/]+)$/);
      const id = match?.[1];
      const payment = id ? payments.get(id) : undefined;
      if (payment) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            payment: { ...payment, status: 'confirmed' },
          }),
        });
      }
    }

    return route.continue();
  });
}

/** Clear test-specific localStorage keys after each test */
export async function cleanupTestState(page: Page): Promise<void> {
  await page.evaluate(() => {
    const keys = ['agenticpay-auth', 'agenticpay-onboarding-draft'];
    keys.forEach((k) => localStorage.removeItem(k));
  });
}
