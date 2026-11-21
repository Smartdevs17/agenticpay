// Email Delivery Service
// Supports SMTP and SendGrid with automatic fallback

import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';
import sgMail from '@sendgrid/mail';

const prisma = new PrismaClient();

export interface EmailMessage {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  fromName?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
  metadata?: Record<string, any>;
}

export interface DeliveryResult {
  success: boolean;
  provider: 'smtp' | 'sendgrid';
  messageId?: string;
  error?: string;
  providerId?: string;
}

export class EmailDeliveryService {
  private smtpTransporter: nodemailer.Transporter | null = null;
  private sendGridEnabled: boolean = false;
  private smtpEnabled: boolean = false;
  private defaultFrom: string;
  private defaultFromName: string;

  constructor() {
    this.defaultFrom = process.env.EMAIL_FROM || 'noreply@agenticpay.com';
    this.defaultFromName = process.env.EMAIL_FROM_NAME || 'AgenticPay';
    
    this.initializeSMTP();
    this.initializeSendGrid();
  }

  /**
   * Initialize SMTP transporter
   */
  private initializeSMTP(): void {
    if (process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS) {
      this.smtpTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
      this.smtpEnabled = true;
      console.log('[EmailDelivery] SMTP initialized');
    } else {
      console.log('[EmailDelivery] SMTP not configured');
    }
  }

  /**
   * Initialize SendGrid
   */
  private initializeSendGrid(): void {
    if (process.env.SENDGRID_API_KEY) {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      this.sendGridEnabled = true;
      console.log('[EmailDelivery] SendGrid initialized');
    } else {
      console.log('[EmailDelivery] SendGrid not configured');
    }
  }

  /**
   * Send email via SMTP
   */
  private async sendViaSMTP(message: EmailMessage): Promise<DeliveryResult> {
    if (!this.smtpTransporter) {
      throw new Error('SMTP not configured');
    }

    try {
      const info = await this.smtpTransporter.sendMail({
        from: `"${message.fromName || this.defaultFromName}" <${message.from || this.defaultFrom}>`,
        to: message.toName ? `"${message.toName}" <${message.to}>` : message.to,
        replyTo: message.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        attachments: message.attachments,
        headers: message.metadata,
      });

      return {
        success: true,
        provider: 'smtp',
        messageId: info.messageId,
        providerId: info.messageId,
      };
    } catch (error) {
      throw new Error(`SMTP delivery failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Send email via SendGrid
   */
  private async sendViaSendGrid(message: EmailMessage): Promise<DeliveryResult> {
    if (!this.sendGridEnabled) {
      throw new Error('SendGrid not configured');
    }

    try {
      const msg = {
        to: message.to,
        from: {
          email: message.from || this.defaultFrom,
          name: message.fromName || this.defaultFromName,
        },
        replyTo: message.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        attachments: message.attachments,
        customArgs: message.metadata,
      };

      const response = await sgMail.send(msg);
      
      return {
        success: true,
        provider: 'sendgrid',
        messageId: response[0]?.headers['x-message-id'],
        providerId: response[0]?.headers['x-message-id'],
      };
    } catch (error) {
      throw new Error(`SendGrid delivery failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Send email with automatic fallback
   */
  async send(message: EmailMessage, preferredProvider?: 'smtp' | 'sendgrid'): Promise<DeliveryResult> {
    const provider = preferredProvider || (this.sendGridEnabled ? 'sendgrid' : 'smtp');

    try {
      if (provider === 'sendgrid' && this.sendGridEnabled) {
        return await this.sendViaSendGrid(message);
      } else if (provider === 'smtp' && this.smtpEnabled) {
        return await this.sendViaSMTP(message);
      } else {
        throw new Error(`Preferred provider ${provider} not available`);
      }
    } catch (error) {
      // Try fallback
      console.warn(`[EmailDelivery] ${provider} failed, trying fallback...`);
      
      if (provider === 'sendgrid' && this.smtpEnabled) {
        try {
          return await this.sendViaSMTP(message);
        } catch (fallbackError) {
          throw new Error(`Both providers failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      } else if (provider === 'smtp' && this.sendGridEnabled) {
        try {
          return await this.sendViaSendGrid(message);
        } catch (fallbackError) {
          throw new Error(`Both providers failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      } else {
        throw error;
      }
    }
  }

  /**
   * Send email and record in database
   */
  async sendAndRecord(
    tenantId: string,
    templateId: string | null,
    message: EmailMessage,
    category: string
  ): Promise<DeliveryResult & { deliveryId: string }> {
    // Send the email
    const result = await this.send(message);

    // Record delivery in database
    const delivery = await prisma.emailDelivery.create({
      data: {
        tenantId,
        templateId,
        recipientEmail: message.to,
        recipientName: message.toName,
        subject: message.subject,
        htmlBody: message.html,
        textBody: message.text,
        status: result.success ? 'sent' : 'failed',
        provider: result.provider,
        providerId: result.providerId,
        sentAt: result.success ? new Date() : null,
        error: result.error,
        metadata: message.metadata,
      },
    });

    return {
      ...result,
      deliveryId: delivery.id,
    };
  }

  /**
   * Verify SMTP connection
   */
  async verifySMTP(): Promise<boolean> {
    if (!this.smtpTransporter) return false;
    
    try {
      await this.smtpTransporter.verify();
      return true;
    } catch (error) {
      console.error('[EmailDelivery] SMTP verification failed:', error);
      return false;
    }
  }

  /**
   * Get provider status
   */
  getProviderStatus(): {
    smtp: { enabled: boolean; verified?: boolean };
    sendgrid: { enabled: boolean };
  } {
    return {
      smtp: {
        enabled: this.smtpEnabled,
        verified: this.smtpEnabled ? undefined : false,
      },
      sendgrid: {
        enabled: this.sendGridEnabled,
      },
    };
  }
}

export default EmailDeliveryService;
