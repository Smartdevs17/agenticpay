import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WhatsAppNotificationChannel } from '../whatsapp-channel.js';
import type { Notification } from '../../channel-interface.js';

describe('WhatsAppNotificationChannel', () => {
  let channel: WhatsAppNotificationChannel;
  const originalFetch = global.fetch;

  const mockPaymentNotification: Notification = {
    id: 'notif-wa-1',
    userId: 'user-88',
    eventType: 'payment.succeeded',
    title: 'Payment Succeeded',
    body: 'Your payment of $250.00 has been processed successfully.',
    priority: 'high',
    data: {
      paymentId: 'pay-777',
      amount: 250,
      currency: 'USD',
      phone: '+15551234567',
    },
    createdAt: new Date('2026-10-21T07:00:00Z'),
  };

  beforeEach(() => {
    channel = new WhatsAppNotificationChannel({
      maxPerHour: 50,
      maxPerDay: 500,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('is enabled with correct id and priority', () => {
    expect(channel.enabled).toBe(true);
    expect(channel.id).toBe('whatsapp');
    expect(channel.priority).toBe(35);
  });

  it('formats notification into WhatsApp schema', async () => {
    const formatted = (await channel.format(mockPaymentNotification)) as any;
    expect(formatted.to).toBe('whatsapp:+15551234567');
    expect(formatted.body).toContain('AgenticPay Notification');
    expect(formatted.body).toContain('Payment Succeeded');
    expect(formatted.body).toContain('$250.00');
    expect(formatted.data.paymentId).toBe('pay-777');
  });

  it('delivers notification successfully in simulation mode', async () => {
    const result = await channel.send(mockPaymentNotification);
    expect(result.success).toBe(true);
    expect(result.channelId).toBe('whatsapp');
    expect(result.messageId).toBe('whatsapp-notif-wa-1');
  });

  it('delivers notification via API URL when provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    } as unknown as Response);

    const apiChannel = new WhatsAppNotificationChannel({
      apiUrl: 'https://api.whatsapp.example.com/v1/messages',
      authToken: 'test-token',
    });

    const result = await apiChannel.send(mockPaymentNotification);

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://api.whatsapp.example.com/v1/messages');
    expect(opts.headers.Authorization).toBe('Bearer test-token');
  });

  it('returns failure when remote WhatsApp API responds with error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
    } as unknown as Response);

    const apiChannel = new WhatsAppNotificationChannel({
      apiUrl: 'https://api.whatsapp.example.com/v1/messages',
    });

    const result = await apiChannel.send(mockPaymentNotification);

    expect(result.success).toBe(false);
    expect(result.channelId).toBe('whatsapp');
    expect(result.error).toContain('WhatsApp API responded with status 400');
  });

  it('performs health check', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
    } as unknown as Response);

    const apiChannel = new WhatsAppNotificationChannel({
      apiUrl: 'https://api.whatsapp.example.com/v1/messages',
    });

    const healthy = await apiChannel.healthCheck();
    expect(healthy).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.whatsapp.example.com/v1/messages',
      expect.objectContaining({ method: 'HEAD' })
    );
  });
});
