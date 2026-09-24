import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IntercomChannel } from '../intercom-channel.js';
import type { Notification } from '../../channel-interface.js';

describe('IntercomChannel', () => {
  let channel: IntercomChannel;
  const originalFetch = global.fetch;

  const mockNotification: Notification = {
    id: 'notif-101',
    userId: 'user-77',
    eventType: 'payment.failed',
    title: 'Payment Failed',
    body: 'Transaction tx_123 failed on network',
    priority: 'urgent',
    data: { paymentId: 'pay-123', amount: 250 },
    createdAt: new Date('2026-09-24T12:00:00Z'),
  };

  beforeEach(() => {
    channel = new IntercomChannel({
      accessToken: 'test-intercom-token-abc',
      appId: 'test-app',
      adminId: 'admin-1',
      maxPerHour: 50,
      maxPerDay: 500,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('is enabled when accessToken is provided', () => {
    expect(channel.enabled).toBe(true);
    expect(channel.id).toBe('intercom');
    expect(channel.priority).toBe(50);
  });

  it('is disabled when accessToken is empty', () => {
    const disabled = new IntercomChannel({ accessToken: '' });
    expect(disabled.enabled).toBe(false);
  });

  it('formats notification with title, body, and priority', async () => {
    const formatted = await channel.format(mockNotification);
    expect(formatted.title).toBe('Payment Failed');
    expect(formatted.body).toBe('Transaction tx_123 failed on network');
    expect(formatted.eventType).toBe('payment.failed');
    expect(formatted.priority).toBe('urgent');
    expect(formatted.data).toEqual({ paymentId: 'pay-123', amount: 250 });
  });

  it('successfully delivers notification by creating an Intercom conversation', async () => {
    global.fetch = vi
      .fn()
      // 1. search contacts
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'contact-77' }] }),
      } as unknown as Response)
      // 2. update contact
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'contact-77' }),
      } as unknown as Response)
      // 3. create conversation
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'conv-888', state: 'open' }),
      } as unknown as Response);

    const result = await channel.send(mockNotification);
    expect(result.success).toBe(true);
    expect(result.channelId).toBe('intercom');
    expect(result.messageId).toBe('intercom-conv-888');
    expect(result.deliveryTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('returns failure when Intercom API rejects delivery', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Internal error',
    } as unknown as Response);

    const result = await channel.send(mockNotification);
    expect(result.success).toBe(false);
    expect(result.channelId).toBe('intercom');
    expect(result.error).toContain('Intercom API error 500');
  });

  it('validates configuration correctly', async () => {
    expect(await channel.validate()).toBe(true);

    const invalid = new IntercomChannel({ accessToken: '' });
    expect(await invalid.validate()).toBe(false);
  });

  it('runs health check via testConnection', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ type: 'admin', id: 'admin-1' }),
    } as unknown as Response);

    expect(await channel.healthCheck()).toBe(true);
  });

  it('returns rate limit settings', () => {
    const limits = channel.getRateLimit();
    expect(limits.maxPerHour).toBe(50);
    expect(limits.maxPerDay).toBe(500);
  });
});
