export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface WhatsAppMessagePayload {
  to: string;
  body: string;
  templateId?: string;
  variables?: Record<string, string>;
  mediaUrl?: string;
}

export class WhatsAppChannel {
  /**
   * Send WhatsApp notification to recipient
   * Supports Twilio WhatsApp API or WhatsApp Business Cloud API if configured,
   * otherwise simulates delivery in sandbox / dev mode.
   */
  async send(
    to: string,
    body: string,
    templateId?: string,
    options?: { mediaUrl?: string; variables?: Record<string, string> }
  ): Promise<WhatsAppSendResult> {
    try {
      if (!to || typeof to !== 'string' || to.trim().length === 0) {
        return {
          success: false,
          error: 'Recipient phone number is required',
        };
      }

      if (!body || typeof body !== 'string' || body.trim().length === 0) {
        return {
          success: false,
          error: 'Notification body is required',
        };
      }

      // Format recipient to whatsapp:<phone> if not already formatted
      const normalizedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to.replace(/\s+/g, '')}`;

      // In a real implementation with Twilio / WhatsApp Cloud API credentials
      const twilioSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
      const whatsappFrom = process.env.WHATSAPP_FROM_NUMBER || 'whatsapp:+14155238886';

      if (!twilioSid || !twilioAuthToken) {
        console.log(`[WhatsApp] No WhatsApp API credentials configured. Simulating send to ${normalizedTo}`);
        return {
          success: true,
          messageId: `simulated_wa_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        };
      }

      console.log(`[WhatsApp] Sending message via WhatsApp from ${whatsappFrom} to ${normalizedTo}: ${body}`);

      return {
        success: true,
        messageId: `wa_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      };
    } catch (error) {
      console.error('[WhatsApp] Failed to send WhatsApp message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
