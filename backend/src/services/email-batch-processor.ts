// Batch Email Processing Service
// Handles batch email sending with rate limiting and queue management

import { PrismaClient } from '@prisma/client';
import EmailDeliveryService from './email-delivery.js';
import EmailTemplateEngine from './email-template-engine.js';
import EmailPreferenceService from './email-preference.js';
import EmailLocalizationService from './email-localization.js';
import EmailAnalyticsService from './email-analytics.js';

const prisma = new PrismaClient();

export interface BatchEmailRequest {
  tenantId: string;
  templateId: string;
  category: string;
  recipients: Array<{
    email: string;
    name?: string;
    variables?: Record<string, any>;
  }>;
  locale?: string;
  priority?: 'low' | 'normal' | 'high';
  sendAt?: Date;
  metadata?: Record<string, any>;
}

export interface BatchEmailResult {
  batchId: string;
  totalRecipients: number;
  sent: number;
  failed: number;
  skipped: number;
  queued: number;
  results: Array<{
    email: string;
    status: 'sent' | 'failed' | 'skipped';
    deliveryId?: string;
    error?: string;
  }>;
}

export interface RateLimitConfig {
  maxPerSecond: number;
  maxPerMinute: number;
  maxPerHour: number;
}

export class EmailBatchProcessor {
  private deliveryService: EmailDeliveryService;
  private templateEngine: EmailTemplateEngine;
  private preferenceService: EmailPreferenceService;
  private localizationService: EmailLocalizationService;
  private analyticsService: EmailAnalyticsService;
  private rateLimitConfig: RateLimitConfig;
  private sendQueue: Map<string, number> = new Map(); // Timestamps of sent emails

  constructor(rateLimitConfig?: Partial<RateLimitConfig>) {
    this.deliveryService = new EmailDeliveryService();
    this.templateEngine = new EmailTemplateEngine();
    this.preferenceService = new EmailPreferenceService();
    this.localizationService = new EmailLocalizationService();
    this.analyticsService = new EmailAnalyticsService();
    
    this.rateLimitConfig = {
      maxPerSecond: rateLimitConfig?.maxPerSecond || 10,
      maxPerMinute: rateLimitConfig?.maxPerMinute || 300,
      maxPerHour: rateLimitConfig?.maxPerHour || 5000,
    };
  }

  /**
   * Check rate limit
   */
  private async checkRateLimit(): Promise<boolean> {
    const now = Date.now();
    const oneSecondAgo = now - 1000;
    const oneMinuteAgo = now - 60000;
    const oneHourAgo = now - 3600000;

    // Clean old timestamps
    for (const [key, timestamp] of this.sendQueue) {
      if (timestamp < oneHourAgo) {
        this.sendQueue.delete(key);
      }
    }

    const timestamps = Array.from(this.sendQueue.values());

    const perSecond = timestamps.filter((t) => t > oneSecondAgo).length;
    const perMinute = timestamps.filter((t) => t > oneMinuteAgo).length;
    const perHour = timestamps.filter((t) => t > oneHourAgo).length;

    return (
      perSecond < this.rateLimitConfig.maxPerSecond &&
      perMinute < this.rateLimitConfig.maxPerMinute &&
      perHour < this.rateLimitConfig.maxPerHour
    );
  }

  /**
   * Wait for rate limit
   */
  private async waitForRateLimit(): Promise<void> {
    let attempts = 0;
    const maxAttempts = 60; // 1 minute max wait

    while (!(await this.checkRateLimit()) && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    if (attempts >= maxAttempts) {
      throw new Error('Rate limit wait timeout');
    }
  }

  /**
   * Process batch email request
   */
  async processBatch(request: BatchEmailRequest): Promise<BatchEmailResult> {
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const results: BatchEmailResult['results'] = [];
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let queued = 0;

    // Get template
    const template = await prisma.emailTemplate.findUnique({
      where: { id: request.templateId },
    });

    if (!template) {
      throw new Error('Template not found');
    }

    // Map category to preference field
    const categoryToPreference: Record<string, keyof import('./email-preference.js').EmailPreferences> = {
      payment_receipt: 'paymentReceipts',
      payment_confirmation: 'paymentConfirmations',
      refund_notification: 'refundNotifications',
      dispute_update: 'disputeUpdates',
      weekly_summary: 'weeklySummaries',
      marketing: 'marketing',
      security_alert: 'securityAlerts',
      onboarding: 'onboarding',
    };

    const preferenceField = categoryToPreference[request.category] || 'paymentReceipts';

    // Process each recipient
    for (const recipient of request.recipients) {
      try {
        // Check user preferences
        const isOptedIn = await this.preferenceService.isOptedIn(
          request.tenantId,
          recipient.email,
          preferenceField
        );

        if (!isOptedIn) {
          results.push({
            email: recipient.email,
            status: 'skipped',
          });
          skipped++;
          continue;
        }

        // Get localized template if locale specified
        let subject = template.subject;
        let htmlBody = template.htmlBody;
        let textBody = template.textBody;

        if (request.locale && request.locale !== template.locale) {
          const localized = await this.localizationService.getTemplateForLocale(
            request.templateId,
            request.locale
          );
          if (localized) {
            subject = localized.subject;
            htmlBody = localized.htmlBody;
            textBody = localized.textBody;
          }
        }

        // Render template
        const rendered = this.templateEngine.renderEmail(
          subject,
          htmlBody,
          textBody,
          recipient.variables || {}
        );

        // Wait for rate limit
        await this.waitForRateLimit();

        // Send email
        const deliveryResult = await this.deliveryService.sendAndRecord(
          request.tenantId,
          request.templateId,
          {
            to: recipient.email,
            toName: recipient.name,
            subject: rendered.subject,
            html: rendered.htmlBody,
            text: rendered.textBody,
            metadata: {
              ...request.metadata,
              batchId,
              recipientVariables: recipient.variables,
            },
          },
          request.category
        );

        // Record in queue
        this.sendQueue.set(deliveryResult.deliveryId, Date.now());

        results.push({
          email: recipient.email,
          status: 'sent',
          deliveryId: deliveryResult.deliveryId,
        });
        sent++;
      } catch (error) {
        results.push({
          email: recipient.email,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        failed++;
      }
    }

    return {
      batchId,
      totalRecipients: request.recipients.length,
      sent,
      failed,
      skipped,
      queued,
      results,
    };
  }

  /**
   * Process batch with delay between sends
   */
  async processBatchWithDelay(
    request: BatchEmailRequest,
    delayMs: number = 100
  ): Promise<BatchEmailResult> {
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const results: BatchEmailResult['results'] = [];
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let queued = 0;

    // Get template
    const template = await prisma.emailTemplate.findUnique({
      where: { id: request.templateId },
    });

    if (!template) {
      throw new Error('Template not found');
    }

    // Map category to preference field
    const categoryToPreference: Record<string, keyof import('./email-preference.js').EmailPreferences> = {
      payment_receipt: 'paymentReceipts',
      payment_confirmation: 'paymentConfirmations',
      refund_notification: 'refundNotifications',
      dispute_update: 'disputeUpdates',
      weekly_summary: 'weeklySummaries',
      marketing: 'marketing',
      security_alert: 'securityAlerts',
      onboarding: 'onboarding',
    };

    const preferenceField = categoryToPreference[request.category] || 'paymentReceipts';

    // Process each recipient with delay
    for (const recipient of request.recipients) {
      try {
        // Check user preferences
        const isOptedIn = await this.preferenceService.isOptedIn(
          request.tenantId,
          recipient.email,
          preferenceField
        );

        if (!isOptedIn) {
          results.push({
            email: recipient.email,
            status: 'skipped',
          });
          skipped++;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        // Get localized template if locale specified
        let subject = template.subject;
        let htmlBody = template.htmlBody;
        let textBody = template.textBody;

        if (request.locale && request.locale !== template.locale) {
          const localized = await this.localizationService.getTemplateForLocale(
            request.templateId,
            request.locale
          );
          if (localized) {
            subject = localized.subject;
            htmlBody = localized.htmlBody;
            textBody = localized.textBody;
          }
        }

        // Render template
        const rendered = this.templateEngine.renderEmail(
          subject,
          htmlBody,
          textBody,
          recipient.variables || {}
        );

        // Send email
        const deliveryResult = await this.deliveryService.sendAndRecord(
          request.tenantId,
          request.templateId,
          {
            to: recipient.email,
            toName: recipient.name,
            subject: rendered.subject,
            html: rendered.htmlBody,
            text: rendered.textBody,
            metadata: {
              ...request.metadata,
              batchId,
              recipientVariables: recipient.variables,
            },
          },
          request.category
        );

        results.push({
          email: recipient.email,
          status: 'sent',
          deliveryId: deliveryResult.deliveryId,
        });
        sent++;

        // Delay before next send
        if (sent < request.recipients.length) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      } catch (error) {
        results.push({
          email: recipient.email,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        failed++;
      }
    }

    return {
      batchId,
      totalRecipients: request.recipients.length,
      sent,
      failed,
      skipped,
      queued,
      results,
    };
  }

  /**
   * Get batch status
   */
  async getBatchStatus(batchId: string): Promise<{
    batchId: string;
    total: number;
    sent: number;
    failed: number;
    skipped: number;
  }> {
    const deliveries = await prisma.emailDelivery.findMany({
      where: {
        metadata: {
          path: ['batchId'],
          equals: batchId,
        },
      },
    });

    const sent = deliveries.filter((d) => d.status === 'sent' || d.status === 'delivered').length;
    const failed = deliveries.filter((d) => d.status === 'failed' || d.status === 'bounced').length;
    const skipped = deliveries.filter((d) => d.status === 'pending').length;

    return {
      batchId,
      total: deliveries.length,
      sent,
      failed,
      skipped,
    };
  }

  /**
   * Update rate limit configuration
   */
  updateRateLimitConfig(config: Partial<RateLimitConfig>): void {
    this.rateLimitConfig = {
      ...this.rateLimitConfig,
      ...config,
    };
  }

  /**
   * Get current rate limit configuration
   */
  getRateLimitConfig(): RateLimitConfig {
    return { ...this.rateLimitConfig };
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.sendQueue.size;
  }
}

export default EmailBatchProcessor;
