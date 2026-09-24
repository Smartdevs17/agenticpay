import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ZapierChannel } from '../zapier-channel.js';
import type { Notification } from '../../channel-interface.js';

describe('ZapierChannel', () => {
  let channel: ZapierChannel;
  const originalFetch = global.fetch;

  const mockNotification: Notification = {
    id: 'notif-1',
    userId: 'user-42',
    eventType: 'payment.succeeded',
    title: 'Payment Succeeded',
    body: 'Customer completed payment for $100',
    priority: 'high',
    data: { paymentId: 'pay-123', amount: 100 },
    createdAt: new Date('2026-09-24T12:00:00Z'),
  };

  beforeEach(() => {
    channel = new ZapierChannel({
      webhookUrl: 'https://hooks.zapier.com/hooks/catch/999/xyz',
      secret: 'super-secret-signature-key-12345678',
      maxPerHour: 100,
      maxPerDay: 1000,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('is enabled when webhookUrl is provided', () => {
    expect(channel.enabled).toBe(true);
    expect(channel.id).toBe('zapier');
    expect(channel.priority).toBe(45);
  });

  it('is disabled when webhookUrl is empty', () => {
    const disabled = new ZapierChannel({ webhookUrl: '' });
    expect(disabled.enabled).toBe(false);
  });

  it('formats notifications into Zapier schema', async () => {
    const formatted = (await channel.format(mockNotification)) as any;
    expect(formatted.event).toBe('agenticpay.notification');
    expect(formatted.notification.id).toBe('notif-1');
    expect(formatted.notification.eventType).toBe('payment.succeeded');
    expect(formatted.notification.priority).toBe('high');
    expect(formatted.source).toBe('agenticpay');
  });

  it('delivers notification with signature headers', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    } as unknown as Response);

    const result = await channel.send(mockNotification);

    expect(result.success).toBe(true);
    expect(result.channelId).toBe('zapier');
    expect(result.messageId).toBe('zapier-notif-1');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, opts] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://hooks.zapier.com/hooks/catch/999/xyz');
    expect(opts.headers['X-Zapier-Notification-Id']).toBe('notif-1');
    expect(opts.headers['X-Zapier-Signature']).toMatch(/^sha256=/);
  });

  it('returns failure when fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as unknown as Response);

    const result = await channel.send(mockNotification);

    expect(result.success).toBe(false);
    expect(result.channelId).toBe('zapier');
    expect(result.error).toContain('500');
  });

  it('performs health check', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
    } as unknown as Response);

    const healthy = await channel.healthCheck();
    expect(healthy).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://hooks.zapier.com/hooks/catch/999/xyz',
      expect.objectContaining({ method: 'HEAD' })
    );
  });
});
