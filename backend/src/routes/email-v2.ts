// Email API Routes v2
// Enhanced email system with database persistence, analytics, and localization

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import EmailTemplateEngine from '../services/email-template-engine.js';
import EmailDeliveryService from '../services/email-delivery.js';
import EmailPreferenceService from '../services/email-preference.js';
import EmailLocalizationService from '../services/email-localization.js';
import EmailAnalyticsService from '../services/email-analytics.js';
import EmailBatchProcessor from '../services/email-batch-processor.js';

const prisma = new PrismaClient();
const templateEngine = new EmailTemplateEngine();
const deliveryService = new EmailDeliveryService();
const preferenceService = new EmailPreferenceService();
const localizationService = new EmailLocalizationService();
const analyticsService = new EmailAnalyticsService();
const batchProcessor = new EmailBatchProcessor();

export const emailV2Router = Router();

// ── Template Management ──────────────────────────────────────────────────────

emailV2Router.post('/templates', async (req: Request, res: Response) => {
  try {
    const { tenantId, name, category, subject, htmlBody, textBody, variables, locale } = req.body;

    if (!tenantId || !name || !category || !subject || !htmlBody) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['tenantId', 'name', 'category', 'subject', 'htmlBody'],
      });
    }

    // Validate template syntax
    const validation = templateEngine.validateTemplate(htmlBody);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Invalid template syntax', details: validation.error });
    }

    // Extract variables if not provided
    const extractedVariables = variables || templateEngine.extractVariables(htmlBody);

    const template = await prisma.emailTemplate.create({
      data: {
        tenantId,
        name,
        category,
        subject,
        htmlBody,
        textBody,
        variables: extractedVariables,
        locale: locale || 'en',
      },
    });

    res.status(201).json({ template });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

emailV2Router.get('/templates', async (req: Request, res: Response) => {
  try {
    const { tenantId, category, locale, active } = req.query;

    const where: any = {};
    if (tenantId) where.tenantId = tenantId;
    if (category) where.category = category;
    if (locale) where.locale = locale;
    if (active !== undefined) where.isActive = active === 'true';

    const templates = await prisma.emailTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ templates });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

emailV2Router.get('/templates/:id', async (req: Request, res: Response) => {
  try {
    const template = await prisma.emailTemplate.findUnique({
      where: { id: req.params.id },
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ template });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

emailV2Router.put('/templates/:id', async (req: Request, res: Response) => {
  try {
    const { name, category, subject, htmlBody, textBody, variables, isActive } = req.body;

    const template = await prisma.emailTemplate.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(category !== undefined && { category }),
        ...(subject !== undefined && { subject }),
        ...(htmlBody !== undefined && { htmlBody }),
        ...(textBody !== undefined && { textBody }),
        ...(variables !== undefined && { variables }),
        ...(isActive !== undefined && { isActive }),
        version: { increment: 1 },
      },
    });

    res.json({ template });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

emailV2Router.delete('/templates/:id', async (req: Request, res: Response) => {
  try {
    await prisma.emailTemplate.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date() },
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ── Template Localization ────────────────────────────────────────────────────

emailV2Router.post('/templates/:id/localizations', async (req: Request, res: Response) => {
  try {
    const { locale, subject, htmlBody, textBody } = req.body;

    if (!locale || !subject || !htmlBody) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['locale', 'subject', 'htmlBody'],
      });
    }

    const localization = await localizationService.addLocalization(
      req.params.id,
      locale,
      subject,
      htmlBody,
      textBody
    );

    res.status(201).json({ localization });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

emailV2Router.get('/templates/:id/localizations', async (req: Request, res: Response) => {
  try {
    const template = await localizationService.getTemplateWithLocalizations(req.params.id);

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ template });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

emailV2Router.put('/templates/:id/localizations/:locale', async (req: Request, res: Response) => {
  try {
    const { subject, htmlBody, textBody } = req.body;

    const localization = await localizationService.updateLocalization(
      req.params.id,
      req.params.locale,
      { subject, htmlBody, textBody }
    );

    res.json({ localization });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

emailV2Router.delete('/templates/:id/localizations/:locale', async (req: Request, res: Response) => {
  try {
    await localizationService.deleteLocalization(req.params.id, req.params.locale);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ── Send Single Email ─────────────────────────────────────────────────────────

emailV2Router.post('/send', async (req: Request, res: Response) => {
  try {
    const { tenantId, templateId, to, toName, variables, locale, metadata } = req.body;

    if (!tenantId || !templateId || !to) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['tenantId', 'templateId', 'to'],
      });
    }

    // Get template
    const template = await prisma.emailTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Check user preferences
    const categoryToPreference: Record<string, keyof import('../services/email-preference.js').EmailPreferences> = {
      payment_receipt: 'paymentReceipts',
      payment_confirmation: 'paymentConfirmations',
      refund_notification: 'refundNotifications',
      dispute_update: 'disputeUpdates',
      weekly_summary: 'weeklySummaries',
      marketing: 'marketing',
      security_alert: 'securityAlerts',
      onboarding: 'onboarding',
    };

    const preferenceField = categoryToPreference[template.category] || 'paymentReceipts';
    const isOptedIn = await preferenceService.isOptedIn(tenantId, to, preferenceField);

    if (!isOptedIn) {
      return res.json({
        success: true,
        status: 'skipped',
        reason: 'User opted out of this email category',
      });
    }

    // Get localized template if locale specified
    let subject = template.subject;
    let htmlBody = template.htmlBody;
    let textBody = template.textBody;

    if (locale && locale !== template.locale) {
      const localized = await localizationService.getTemplateForLocale(templateId, locale);
      if (localized) {
        subject = localized.subject;
        htmlBody = localized.htmlBody;
        textBody = localized.textBody;
      }
    }

    // Render template
    const rendered = templateEngine.renderEmail(subject, htmlBody, textBody, variables || {});

    // Send email
    const result = await deliveryService.sendAndRecord(
      tenantId,
      templateId,
      {
        to,
        toName,
        subject: rendered.subject,
        html: rendered.htmlBody,
        text: rendered.textBody,
        metadata,
      },
      template.category
    );

    res.json({ success: true, deliveryId: result.deliveryId, provider: result.provider, messageId: result.messageId });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ── Batch Email Processing ────────────────────────────────────────────────────

emailV2Router.post('/batch', async (req: Request, res: Response) => {
  try {
    const { tenantId, templateId, category, recipients, locale, priority, sendAt, metadata } = req.body;

    if (!tenantId || !templateId || !category || !recipients) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['tenantId', 'templateId', 'category', 'recipients'],
      });
    }

    const result = await batchProcessor.processBatch({
      tenantId,
      templateId,
      category,
      recipients,
      locale,
      priority,
      sendAt: sendAt ? new Date(sendAt) : undefined,
      metadata,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

emailV2Router.post('/batch/delayed', async (req: Request, res: Response) => {
  try {
    const { tenantId, templateId, category, recipients, locale, delayMs, metadata } = req.body;

    if (!tenantId || !templateId || !category || !recipients) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['tenantId', 'templateId', 'category', 'recipients'],
      });
    }

    const result = await batchProcessor.processBatchWithDelay(
      {
        tenantId,
        templateId,
        category,
        recipients,
        locale,
        metadata,
      },
      delayMs || 100
    );

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

emailV2Router.get('/batch/:batchId', async (req: Request, res: Response) => {
  try {
    const status = await batchProcessor.getBatchStatus(req.params.batchId);
    res.json({ status });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ── Email Preferences ────────────────────────────────────────────────────────

emailV2Router.get('/preferences/:email', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.query;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const preferences = await preferenceService.getPreferences(tenantId as string, req.params.email);
    res.json({ preferences });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

emailV2Router.put('/preferences/:email', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.query;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const updates = req.body;
    const preferences = await preferenceService.updatePreferences(
      tenantId as string,
      req.params.email,
      updates
    );
    res.json({ preferences });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

emailV2Router.post('/preferences/:email/opt-out-all', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.query;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const preferences = await preferenceService.optOutAll(tenantId as string, req.params.email);
    res.json({ preferences });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

emailV2Router.post('/preferences/:email/opt-in-all', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.query;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const preferences = await preferenceService.optInAll(tenantId as string, req.params.email);
    res.json({ preferences });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ── Email Analytics ───────────────────────────────────────────────────────────

emailV2Router.get('/analytics', async (req: Request, res: Response) => {
  try {
    const { tenantId, startDate, endDate, days } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    if (days) {
      const summary = await analyticsService.getSummaryStatistics(tenantId as string, parseInt(days as string, 10));
      res.json({ summary });
    } else {
      const analytics = await analyticsService.getTenantAnalytics(
        tenantId as string,
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined
      );
      res.json({ analytics });
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

emailV2Router.get('/analytics/template/:templateId', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const analytics = await analyticsService.getTemplateAnalytics(
      req.params.templateId,
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined
    );
    res.json({ analytics });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

emailV2Router.get('/analytics/category/:category', async (req: Request, res: Response) => {
  try {
    const { tenantId, startDate, endDate } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const analytics = await analyticsService.getCategoryAnalytics(
      tenantId as string,
      req.params.category,
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined
    );
    res.json({ analytics });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ── Delivery Tracking ──────────────────────────────────────────────────────────

emailV2Router.get('/delivery/:id', async (req: Request, res: Response) => {
  try {
    const status = await analyticsService.getDeliveryStatus(req.params.id);
    res.json({ status });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

emailV2Router.post('/delivery/:id/open', async (req: Request, res: Response) => {
  try {
    await analyticsService.trackOpen(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

emailV2Router.post('/delivery/:id/click', async (req: Request, res: Response) => {
  try {
    await analyticsService.trackClick(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

emailV2Router.post('/delivery/:id/bounce', async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;
    await analyticsService.trackBounce(req.params.id, reason || 'Unknown');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ── Provider Status ───────────────────────────────────────────────────────────

emailV2Router.get('/provider/status', async (req: Request, res: Response) => {
  try {
    const status = deliveryService.getProviderStatus();
    res.json({ status });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

emailV2Router.get('/rate-limit/config', async (req: Request, res: Response) => {
  try {
    const config = batchProcessor.getRateLimitConfig();
    res.json({ config });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

emailV2Router.put('/rate-limit/config', async (req: Request, res: Response) => {
  try {
    batchProcessor.updateRateLimitConfig(req.body);
    const config = batchProcessor.getRateLimitConfig();
    res.json({ config });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ── Localization ─────────────────────────────────────────────────────────────

emailV2Router.get('/locales', async (req: Request, res: Response) => {
  try {
    const locales = localizationService.getSupportedLocales();
    res.json({ locales });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default emailV2Router;
