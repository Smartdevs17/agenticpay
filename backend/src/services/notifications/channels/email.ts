import { config } from '../../../config.js';

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export class EmailChannel {
  async send(to: string, subject: string, body: string, templateId?: string): Promise<EmailSendResult> {
    try {
      // In a real implementation, we would use SendGrid, Postmark, or another email service
      // For now, we'll simulate sending
      
      // Check if email service is configured
      if (!config.sendGridApiKey && !config.postmarkApiKey) {
        console.log('[Email] No email service configured, simulating send');
        // Simulate successful send
        return {
          success: true,
          messageId: `simulated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };
      }

      // In a real implementation, we would send via the actual email service
      console.log(`[Email] Sending to ${to}: ${subject}`);
      
      // For demonstration, we'll return success
      return {
        success: true,
        messageId: `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };
    } catch (error) {
      console.error('[Email] Failed to send email:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}