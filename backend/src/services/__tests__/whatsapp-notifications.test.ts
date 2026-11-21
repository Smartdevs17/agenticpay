import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WhatsAppChannel } from '../notifications/channels/whatsapp.js';
import { NotificationService } from '../notificationService.ts';
import { NotificationPreferenceService, notificationPreferenceService } from '../notifications/preferenceService.js';
import { NotificationTemplateService } from '../notifications/templateService.js';
import { whatsAppPaymentNotificationService } from '../whatsapp-payment-notifications.js';

describe('WhatsAppChannel', () => {
  let channel: WhatsAppChannel;

  beforeEach(() => {
    channel = new WhatsAppChannel();
  });

  it('fails gracefully when recipient phone number is missing or empty', async () => {
    const result = await channel.send('', 'Test payment message');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Recipient phone number is required');
  });

  it('fails gracefully when body is missing or empty', async () => {
    const result = await channel.send('+1234567890', '');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Notification body is required');
  });

  it('successfully delivers simulated WhatsApp message when credentials are not configured', async () => {
    const result = await channel.send('+1234567890', 'Your payment of 50 USD succeeded');
    expect(result.success).toBe(true);
    expect(result.messageId).toMatch(/^simulated_wa_/);
  });

  it('properly normalizes recipient phone numbers', async () => {
    const result = await channel.send('  +1 (555) 000-1111  ', 'Test message');
    expect(result.success).toBe(true);
  });
});

describe('NotificationService with WhatsApp channel', () => {
  let notificationService: NotificationService;
  let preferenceService: NotificationPreferenceService;

  beforeEach(() => {
    preferenceService = new NotificationPreferenceService();
    notificationService = new NotificationService(preferenceService);
  });

  it('dispatches payment receipt via WhatsApp channel', async () => {
    const result = await notificationService.sendNotification({
      templateId: 'payment_receipt',
      variables: {
        customerName: 'Alice',
        amount: '100',
        currency: 'USD',
        transactionId: 'tx_999',
        date: '2026-10-21',
        status: 'Completed',
      },
      channels: ['whatsapp'],
      userId: 'user_123',
      recipient: '+15551234567',
    });

    expect(result.id).toBeDefined();
    expect(result.channelResults.whatsapp).toBeDefined();
    expect(result.channelResults.whatsapp.success).toBe(true);
    expect(result.channelResults.whatsapp.messageId).toBeDefined();
  });

  it('honors user preferences when whatsapp is disabled', async () => {
    await preferenceService.updatePreferences('user_disabled', {
      whatsappEnabled: false,
    });

    const result = await notificationService.sendNotification({
      templateId: 'payment_receipt',
      variables: {
        customerName: 'Bob',
        amount: '20',
        currency: 'EUR',
        transactionId: 'tx_123',
        date: '2026-10-21',
        status: 'Completed',
      },
      channels: ['whatsapp'],
      userId: 'user_disabled',
    });

    expect(result.channelResults.whatsapp.success).toBe(false);
    expect(result.channelResults.whatsapp.error).toContain('disabled');
  });
});

describe('WhatsAppPaymentNotificationService', () => {
  beforeEach(async () => {
    const preferenceService = new NotificationPreferenceService();
    await preferenceService.resetToDefaults('user_test_wa');
  });

  it('sends payment success notification end-to-end', async () => {
    const result = await whatsAppPaymentNotificationService.notifyPaymentSuccess({
      paymentId: 'pay_001',
      userId: 'user_test_wa',
      customerName: 'Charlie',
      amount: 150,
      currency: 'USD',
      status: 'succeeded',
      recipientPhone: '+15559876543',
      transactionHash: '0xabc123',
    });

    expect(result.success).toBe(true);
    expect(result.notificationId).toBeDefined();
    expect(result.channelResults?.whatsapp?.success).toBe(true);
  });

  it('sends payment failure notification end-to-end', async () => {
    const result = await whatsAppPaymentNotificationService.notifyPaymentFailure({
      paymentId: 'pay_002',
      userId: 'user_test_wa',
      customerName: 'David',
      amount: 45,
      currency: 'GBP',
      status: 'failed',
      recipientPhone: '+15559876543',
      errorMessage: 'Insufficient balance',
    });

    expect(result.success).toBe(true);
    expect(result.channelResults?.whatsapp?.success).toBe(true);
  });

  it('sends payment refund notification end-to-end', async () => {
    const result = await whatsAppPaymentNotificationService.notifyPaymentRefunded({
      paymentId: 'pay_003',
      userId: 'user_test_wa',
      customerName: 'Eve',
      amount: 45,
      currency: 'GBP',
      status: 'refunded',
      recipientPhone: '+15559876543',
      refundId: 'ref_003',
    });

    expect(result.success).toBe(true);
    expect(result.channelResults?.whatsapp?.success).toBe(true);
  });

  it('fails when user has disabled whatsapp in preferences', async () => {
    await notificationPreferenceService.updatePreferences('user_opted_out', {
      whatsappEnabled: false,
    });

    const result = await whatsAppPaymentNotificationService.notifyPaymentSuccess({
      paymentId: 'pay_004',
      userId: 'user_opted_out',
      customerName: 'Frank',
      amount: 10,
      currency: 'USD',
      status: 'succeeded',
      recipientPhone: '+15559876543',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('disabled');
  });

  it('fails when no recipient phone number can be resolved', async () => {
    const prefService = new NotificationPreferenceService();
    await prefService.resetToDefaults('user_no_phone');
    await prefService.updatePreferences('user_no_phone', {
      whatsappNumber: undefined,
    });

    const result = await whatsAppPaymentNotificationService.notifyPaymentSuccess({
      paymentId: 'pay_005',
      userId: 'user_no_phone',
      customerName: 'Grace',
      amount: 10,
      currency: 'USD',
      status: 'succeeded',
      recipientPhone: '',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No valid WhatsApp phone number found');
  });
});
