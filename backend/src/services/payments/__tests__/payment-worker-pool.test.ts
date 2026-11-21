import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaymentWorkerPool, resetPaymentWorkerPoolForTesting } from '../payment-worker-pool.js';
import { PaymentProviderRegistry } from '../provider-registry.js';
import { MockPaymentProvider } from '../providers/mock.js';
import type { PaymentInput } from '../providers/types.js';

const baseInput: PaymentInput = {
  amount: 10,
  currency: 'XLM',
  toAddress: 'GABC',
  network: 'stellar',
  tenantId: 'tenant-1',
};

describe('PaymentWorkerPool', () => {
  beforeEach(() => {
    resetPaymentWorkerPoolForTesting();
  });

  it('constructs with defaults', () => {
    const pool = new PaymentWorkerPool();
    expect(pool).toBeInstanceOf(PaymentWorkerPool);
  });

  it('selects provider by network', () => {
    const pool = new PaymentWorkerPool();
    // @ts-ignore - accessing private method for unit verification
    expect(pool['selectProviderId']({ ...baseInput, network: 'stellar' })).toBe('soroban');
    expect(pool['selectProviderId']({ ...baseInput, network: 'polygon' })).toBe('evm');
    expect(pool['selectProviderId']({ ...baseInput, network: 'other', currency: 'USD' })).toBe('fiat');
    expect(pool['selectProviderId']({ ...baseInput, network: 'other', currency: 'POINTS' })).toBe('credit');
  });

  it('rejects invalid amounts before enqueue', async () => {
    const pool = new PaymentWorkerPool();
    await expect(pool.processPayment({ ...baseInput, amount: 0 })).resolves.toMatchObject({ ok: false });
    await expect(pool.processPayment({ ...baseInput, amount: -5 })).resolves.toMatchObject({ ok: false });
    await expect(pool.processPayment({ ...baseInput, amount: Number.NaN })).resolves.toMatchObject({ ok: false });
  });

  it('processes a successful payment through the registry', async () => {
    const registry = new PaymentProviderRegistry();
    const provider = new MockPaymentProvider('test-provider');
    registry.register(provider);
    const pool = new PaymentWorkerPool({}, registry);

    const result = await pool.processPayment(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.providerId).toBe('test-provider');
    expect(registry.getMetrics('test-provider').successCount).toBe(1);
  });

  it('falls back to another provider when primary fails', async () => {
    const registry = new PaymentProviderRegistry();
    const failing = new MockPaymentProvider('failing', { shouldFail: true });
    const healthy = new MockPaymentProvider('healthy');
    registry.register(failing);
    registry.register(healthy);
    const pool = new PaymentWorkerPool({}, registry);

    const result = await pool.processPayment({ ...baseInput, network: 'stellar' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.providerId).toBe('healthy');
    expect(registry.getMetrics('failing').errorCount).toBe(1);
  });

  it('returns PROVIDER_UNAVAILABLE when all providers fail', async () => {
    const registry = new PaymentProviderRegistry();
    registry.register(new MockPaymentProvider('failing', { shouldFail: true }));
    const pool = new PaymentWorkerPool({}, registry);

    const result = await pool.processPayment(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('respects preferred provider override', async () => {
    const registry = new PaymentProviderRegistry();
    registry.register(new MockPaymentProvider('soroban'));
    registry.register(new MockPaymentProvider('evm'));
    const pool = new PaymentWorkerPool({}, registry);

    const result = await pool.processPayment({ ...baseInput, network: 'stellar' }, 'evm');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.providerId).toBe('evm');
  });

  it('getMetrics returns serialisable shape without Redis', async () => {
    const pool = new PaymentWorkerPool();
    await pool.start();
    const metrics = await pool.getMetrics();
    expect(typeof metrics.queued).toBe('number');
    expect(typeof metrics.active).toBe('number');
    expect(typeof metrics.completed).toBe('number');
    expect(typeof metrics.failed).toBe('number');
    expect(typeof metrics.concurrency).toBe('number');
    await pool.shutdown();
  });

  it('enqueue + drainLocal processes a job in-process', async () => {
    const registry = new PaymentProviderRegistry();
    const provider = new MockPaymentProvider('local');
    registry.register(provider);
    const pool = new PaymentWorkerPool({}, registry);
    await pool.start();

    const paymentId = await pool.enqueue(baseInput);
    expect(typeof paymentId).toBe('string');

    // Allow the local drain interval to pick up the job
    await new Promise((r) => setTimeout(r, 150));

    expect(registry.getMetrics('local').successCount).toBe(1);
    await pool.shutdown();
  });

  it('shutdown stops workers and clears state', async () => {
    const pool = new PaymentWorkerPool();
    await pool.start();
    await pool.shutdown();
    // Should not throw on double shutdown
    await pool.shutdown();
  });

  it('pause/resume without Redis does not throw', async () => {
    const pool = new PaymentWorkerPool();
    await pool.start();
    await pool.pause();
    await pool.resume();
    await pool.shutdown();
  });

  it('getPaymentWorkerPool returns a singleton', () => {
    resetPaymentWorkerPoolForTesting();
    const a = getPaymentWorkerPool();
    const b = getPaymentWorkerPool();
    expect(a).toBe(b);
    resetPaymentWorkerPoolForTesting();
  });

  it('registry integration: records success and error metrics', async () => {
    const registry = new PaymentProviderRegistry();
    const failing = new MockPaymentProvider('fail', { shouldFail: true });
    const ok = new MockPaymentProvider('ok');
    registry.register(failing);
    registry.register(ok);
    const pool = new PaymentWorkerPool({}, registry);

    await pool.processPayment({ ...baseInput, network: 'stellar' });
    expect(registry.getMetrics('fail').errorCount).toBe(1);
    expect(registry.getMetrics('ok').successCount).toBe(1);
  });

  it('processPayment returns structured error for invalid amount', async () => {
    const pool = new PaymentWorkerPool();
    const result = await pool.processPayment({ ...baseInput, amount: -100 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.statusCode).toBe(400);
      expect(result.error.code).toBe('INVALID_PAYMENT_AMOUNT');
    }
  });
});
