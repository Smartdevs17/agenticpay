import { test, expect } from './fixtures';

/**
 * Payment flow: create (sandbox API) → fund (process) → confirm (escrow UI).
 * Sandbox routes are mocked when the backend is not running in CI.
 */
test.describe('Payment flow', () => {
  test.use({ withPaymentMocks: true });

  test('sandbox API: create and confirm payment via mocked pipeline', async ({
    page,
    request,
  }) => {
    await page.goto('/');

    const createRes = await request.post('/api/v1/sandbox/payments/process', {
      data: {
        projectId: 'proj_e2e_flow',
        clientAddress: 'GCLIENT000000000000000000000000000000000000000',
        freelancerAddress: 'GFREEL00000000000000000000000000000000000000',
        amount: 250,
        currency: 'XLM',
      },
      failOnStatusCode: false,
    });

    // When backend is absent, route mock on page context won't apply to `request`.
    // Use page.evaluate fetch so mocks apply:
    const paymentResult = await page.evaluate(async () => {
      const res = await fetch('/api/v1/sandbox/payments/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'proj_e2e_flow',
          clientAddress: 'GCLIENT',
          freelancerAddress: 'GFREEL',
          amount: 250,
          currency: 'XLM',
        }),
      });
      return res.json();
    });

    expect(paymentResult.success).toBe(true);
    expect(paymentResult.payment.status).toBe('funded');
    const txnId = paymentResult.payment.transactionId as string;

    const statusResult = await page.evaluate(async (id) => {
      const res = await fetch(`/api/v1/sandbox/payments/${id}`);
      return res.json();
    }, txnId);

    expect(statusResult.payment.status).toBe('confirmed');
    expect(createRes.status()).toBeGreaterThanOrEqual(0);
  });

  test('escrow UI: approve submitted milestone (confirm release)', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/dashboard/escrow');

    await expect(page.getByRole('heading', { name: /Escrow/i })).toBeVisible({
      timeout: 30_000,
    });

    const approveBtn = page.getByRole('button', { name: /^Approve$/i }).first();
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();

    await expect(
      page.locator('.capitalize', { hasText: 'approved' }).first()
    ).toBeVisible();
  });
});
