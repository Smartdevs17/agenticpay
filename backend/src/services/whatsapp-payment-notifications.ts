import { NotificationService } from './notificationService.js';
import { WhatsAppChannel } from './notifications/channels/whatsapp.js';
import { NotificationPreferenceService, notificationPreferenceService } from './notifications/preferenceService.js';

export interface PaymentNotificationDetails {
  paymentId: string;
  userId: string;
  customerName: string;
  amount: number;
  currency: string;
  status: 'succeeded' | 'failed' | 'pending' | 'refunded';
  recipientPhone?: string;
  transactionHash?: string;
  errorMessage?: string;
  metadata?: Record<string, string>;
}

export interface PaymentNotificationResult {
  success: boolean;
  notificationId?: string;
  channelResults?: Record<string, { success: boolean; messageId?: string; error?: string }>;
  error?: string;
}

export class WhatsAppPaymentNotificationService {
  private notificationService: NotificationService;
  private preferenceService: NotificationPreferenceService;
  private whatsAppChannel: WhatsAppChannel;

  constructor(
    notificationService?: NotificationService,
    preferenceService?: NotificationPreferenceService,
    whatsAppChannel?: WhatsAppChannel
  ) {
    this.notificationService = notificationService || new NotificationService();
    this.preferenceService = preferenceService || notificationPreferenceService;
    this.whatsAppChannel = whatsAppChannel || new WhatsAppChannel();
  }

  /**
   * Notify customer of a successful payment
   */
  async notifyPaymentSuccess(details: PaymentNotificationDetails): Promise<PaymentNotificationResult> {
    try {
      const formattedAmount = `${details.amount} ${details.currency.toUpperCase()}`;
      const body = `Hello ${details.customerName}, your payment of ${formattedAmount} for payment #${details.paymentId} was successful.${
        details.transactionHash ? `\nTransaction Hash: ${details.transactionHash}` : ''
      }\nThank you for using AgenticPay!`;

      // Check user preferences
      const preferences = await this.preferenceService.getPreferences(details.userId);
      if (!preferences.whatsappEnabled || !preferences.payments) {
        return {
          success: false,
          error: 'WhatsApp notifications or payment alerts are disabled for this user',
        };
      }

      const recipient = details.recipientPhone || preferences.whatsappNumber;
      if (!recipient) {
        return {
          success: false,
          error: 'No valid WhatsApp phone number found for recipient',
        };
      }

      const result = await this.whatsAppChannel.send(recipient, body, 'payment_confirmation', {
        variables: {
          customerName: details.customerName,
          amount: String(details.amount),
          currency: details.currency,
          transactionHash: details.transactionHash || details.paymentId,
          timestamp: new Date().toISOString(),
        },
      });

      return {
        success: result.success,
        notificationId: result.messageId,
        channelResults: {
          whatsapp: result,
        },
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error sending payment success notification',
      };
    }
  }

  /**
   * Notify customer of a failed payment attempt
   */
  async notifyPaymentFailure(details: PaymentNotificationDetails): Promise<PaymentNotificationResult> {
    try {
      const formattedAmount = `${details.amount} ${details.currency.toUpperCase()}`;
      const body = `Alert: Payment of ${formattedAmount} (ID: ${details.paymentId}) failed.${
        details.errorMessage ? `\nReason: ${details.errorMessage}` : ''
      }\nPlease review your payment details or try again.`;

      const preferences = await this.preferenceService.getPreferences(details.userId);
      if (!preferences.whatsappEnabled || !preferences.payments) {
        return {
          success: false,
          error: 'WhatsApp notifications or payment alerts are disabled for this user',
        };
      }

      const recipient = details.recipientPhone || preferences.whatsappNumber;
      if (!recipient) {
        return {
          success: false,
          error: 'No valid WhatsApp phone number found for recipient',
        };
      }

      const result = await this.whatsAppChannel.send(recipient, body, 'payment_failed');

      return {
        success: result.success,
        notificationId: result.messageId,
        channelResults: {
          whatsapp: result,
        },
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error sending payment failure notification',
      };
    }
  }

  /**
   * Notify customer of a processed refund
   */
  async notifyPaymentRefunded(details: PaymentNotificationDetails & { refundId?: string }): Promise<PaymentNotificationResult> {
    try {
      const formattedAmount = `${details.amount} ${details.currency.toUpperCase()}`;
      const body = `Hello ${details.customerName}, a refund of ${formattedAmount} for payment #${details.paymentId} has been processed.${
        details.refundId ? `\nRefund ID: ${details.refundId}` : ''
      }\nFunds will return to your original payment method.`;

      const preferences = await this.preferenceService.getPreferences(details.userId);
      if (!preferences.whatsappEnabled || !preferences.payments) {
        return {
          success: false,
          error: 'WhatsApp notifications or payment alerts are disabled for this user',
        };
      }

      const recipient = details.recipientPhone || preferences.whatsappNumber;
      if (!recipient) {
        return {
          success: false,
          error: 'No valid WhatsApp phone number found for recipient',
        };
      }

      const result = await this.whatsAppChannel.send(recipient, body, 'refund_notification', {
        variables: {
          customerName: details.customerName,
          amount: String(details.amount),
          currency: details.currency,
          originalTransactionId: details.paymentId,
          refundId: details.refundId || `ref_${details.paymentId}`,
        },
      });

      return {
        success: result.success,
        notificationId: result.messageId,
        channelResults: {
          whatsapp: result,
        },
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error sending payment refund notification',
      };
    }
  }
}

export const whatsAppPaymentNotificationService = new WhatsAppPaymentNotificationService();
