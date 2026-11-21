/**
 * api.test.ts — Issue #729
 *
 * Verifies the typed `api` wrappers delegate to the retrying `apiCall`
 * client with the right method/path/body, and return its (now precisely
 * typed) response untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiCallMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}));

const { api } = await import('./api');

describe('api.verifyWork / api.generateInvoice', () => {
  beforeEach(() => {
    apiCallMock.mockReset();
  });

  it('verifyWork posts to /verification/verify with the request body', async () => {
    apiCallMock.mockResolvedValue({ status: 'passed' });

    const result = await api.verifyWork({
      repositoryUrl: 'https://github.com/x/y',
      milestoneDescription: 'Ship the thing',
      projectId: 'proj-1',
    });

    expect(apiCallMock).toHaveBeenCalledWith(
      '/verification/verify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          repositoryUrl: 'https://github.com/x/y',
          milestoneDescription: 'Ship the thing',
          projectId: 'proj-1',
        }),
      }),
    );
    expect(result).toEqual({ status: 'passed' });
  });

  it('generateInvoice posts to /invoice/generate and returns the generated invoice', async () => {
    const invoice = { id: 'inv-1', invoiceNumber: 'INV-001', total: 100 };
    apiCallMock.mockResolvedValue(invoice);

    const result = await api.generateInvoice({
      projectId: 'proj-1',
      workDescription: 'Verified work',
      hoursWorked: 5,
      hourlyRate: 20,
    });

    expect(apiCallMock).toHaveBeenCalledWith('/invoice/generate', expect.objectContaining({ method: 'POST' }));
    expect(result).toEqual(invoice);
  });
});

describe('api.apiKeys', () => {
  beforeEach(() => {
    apiCallMock.mockReset();
  });

  it('rotate posts to /api-keys/:id/rotate', async () => {
    apiCallMock.mockResolvedValue({ data: { keyId: 'k1' }, rotatedFrom: 'k0', rawKey: 'raw' });

    const result = await api.apiKeys.rotate('k0');

    expect(apiCallMock).toHaveBeenCalledWith('/api-keys/k0/rotate', { method: 'POST' });
    expect(result.rawKey).toBe('raw');
  });
});

describe('api.checkout', () => {
  beforeEach(() => {
    apiCallMock.mockReset();
  });

  it('createSession posts the payload and returns the wrapped session', async () => {
    apiCallMock.mockResolvedValue({ data: { id: 'sess-1', status: 'created' } });

    const result = await api.checkout.createSession({
      merchantId: 'm1',
      amount: 100,
      currency: 'USD',
    });

    expect(apiCallMock).toHaveBeenCalledWith(
      '/checkout/sessions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ merchantId: 'm1', amount: 100, currency: 'USD' }),
      }),
    );
    expect(result.data.id).toBe('sess-1');
  });
});
