import { config } from '../../../config.js';

export interface SMSSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export class SMSChannel {
  async send(to: string, body: string, templateId?: string): Promise<SMSSendResult> {
    try {
      // In a real implementation, we would use Twilio or another SMS service
      // For now, we'll simulate sending
      
      // Check if SMS service is configured
      if (!config.twilioAccountSid && !config.twilioAuthToken) {
        console.log('[SMS] No SMS service configured, simulating send');
        // Simulate successful send
        return {
          success: true,
          messageId: `simulated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };
      }

      // In a real implementation, we would send via the actual SMS service
      console.log(`[SMS] Sending to ${to}: ${body}`);
      
      // For demonstration, we'll return success
      return {
        success: true,
        messageId: `sms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };
    } catch (error) {
      console.error('[SMS] Failed to send SMS:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}