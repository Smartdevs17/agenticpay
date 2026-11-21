import { Router, Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { validate, validateRequest } from '../middleware/validate.js';
import {
  createSupportTicketSchema,
  replyConversationSchema,
  closeConversationSchema,
  snoozeConversationSchema,
  tagConversationSchema,
  escalatePaymentIssueSchema,
  syncCustomerContactSchema,
  searchArticlesSchema,
  type IntercomWebhookEvent,
} from '../integrations/intercom/types.js';
import { intercomSupportService } from '../integrations/intercom/intercom-support-service.js';
import { verifyIntercomProviderWebhook } from '../services/webhooks/providers.js';

export const intercomRouter = Router();

// ============================================================================
// Support Conversations / Tickets
// ============================================================================

/**
 * Create a new support ticket / conversation in Intercom.
 */
intercomRouter.post(
  '/conversations',
  validate(createSupportTicketSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await intercomSupportService.createTicket(req.body);
    res.status(201).json({
      success: true,
      ticket: result,
    });
  })
);

/**
 * List support conversations.
 */
intercomRouter.get(
  '/conversations',
  asyncHandler(async (req: Request, res: Response) => {
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const perPage = req.query.perPage ? parseInt(req.query.perPage as string, 10) : 20;

    const result = await intercomSupportService.listTickets(page, perPage);
    res.json(result);
  })
);

/**
 * Get details of a single conversation.
 */
intercomRouter.get(
  '/conversations/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const conversation = await intercomSupportService.getTicket(req.params.id);
    if (!conversation) {
      throw new AppError(404, 'Intercom conversation not found', 'NOT_FOUND');
    }
    res.json(conversation);
  })
);

/**
 * Reply to a conversation with an admin comment or internal note.
 */
intercomRouter.post(
  '/conversations/:id/reply',
  validate(replyConversationSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const conversation = await intercomSupportService.replyTicket(
      req.params.id,
      req.body
    );
    res.json({
      success: true,
      conversation,
    });
  })
);

/**
 * Close a conversation.
 */
intercomRouter.post(
  '/conversations/:id/close',
  validate(closeConversationSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const conversation = await intercomSupportService.closeTicket(
      req.params.id,
      req.body
    );
    res.json({
      success: true,
      message: 'Conversation closed',
      conversation,
    });
  })
);

/**
 * Snooze a conversation until a specified epoch timestamp.
 */
intercomRouter.post(
  '/conversations/:id/snooze',
  validate(snoozeConversationSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const conversation = await intercomSupportService.snoozeTicket(
      req.params.id,
      req.body
    );
    res.json({
      success: true,
      message: 'Conversation snoozed',
      conversation,
    });
  })
);

/**
 * Add a tag to a conversation.
 */
intercomRouter.post(
  '/conversations/:id/tags',
  validate(tagConversationSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await intercomSupportService.tagTicket(
      req.params.id,
      req.body.tagId,
      req.body.adminId
    );
    res.json({
      success: true,
      message: 'Tag added to conversation',
      result,
    });
  })
);

/**
 * Remove a tag from a conversation.
 */
intercomRouter.delete(
  '/conversations/:id/tags/:tagId',
  asyncHandler(async (req: Request, res: Response) => {
    const adminId = (req.query.adminId as string) || undefined;
    const result = await intercomSupportService.untagTicket(
      req.params.id,
      req.params.tagId,
      adminId
    );
    res.json({
      success: true,
      message: 'Tag removed from conversation',
      result,
    });
  })
);

// ============================================================================
// Customer Contact Sync & Search
// ============================================================================

/**
 * Sync or upsert customer contact profile to Intercom.
 */
intercomRouter.post(
  '/contacts/sync',
  validate(syncCustomerContactSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await intercomSupportService.syncCustomerContact(req.body);
    res.json(result);
  })
);

/**
 * Search contacts in Intercom by email, externalId, or name.
 */
intercomRouter.get(
  '/contacts/search',
  asyncHandler(async (req: Request, res: Response) => {
    const email = req.query.email as string | undefined;
    const external_id = req.query.external_id as string | undefined;
    const name = req.query.name as string | undefined;

    if (!email && !external_id && !name) {
      throw new AppError(400, 'At least one of email, external_id, or name is required', 'INVALID_QUERY');
    }

    const client = intercomSupportService.getClient();
    const result = await client.searchContacts({ email, external_id, name });
    res.json(result);
  })
);

// ============================================================================
// Knowledge Base / Help Center Search
// ============================================================================

/**
 * Search Intercom Help Center articles for AI-assisted support resolution.
 */
intercomRouter.get(
  '/articles/search',
  validateRequest({ query: searchArticlesSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query.query as string;
    const perPage = req.query.perPage ? parseInt(req.query.perPage as string, 10) : 5;

    const articles = await intercomSupportService.searchHelpArticles(query, perPage);
    res.json({
      query,
      count: articles.length,
      articles,
    });
  })
);

// ============================================================================
// Automatic Support Escalation
// ============================================================================

/**
 * Escalate payment failures, transaction disputes, or settlement errors
 * into an urgent Intercom support ticket.
 */
intercomRouter.post(
  '/escalate',
  validate(escalatePaymentIssueSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await intercomSupportService.escalatePaymentIssue(req.body);
    res.status(201).json({
      success: true,
      message: 'Payment issue escalated to Intercom support',
      result,
    });
  })
);

// ============================================================================
// Inbound Intercom Webhooks
// ============================================================================

/**
 * Inbound webhook handler for Intercom topic notifications.
 * Validates HMAC-SHA1 signature via x-hub-signature header.
 */
intercomRouter.post(
  '/webhooks',
  asyncHandler(async (req: Request, res: Response) => {
    const rawBody =
      req.rawBody ??
      (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));

    // Verify signature if secret is configured
    if (process.env.INTERCOM_CLIENT_SECRET) {
      const verification = verifyIntercomProviderWebhook(req, rawBody);
      if (!verification.isValid) {
        throw new AppError(
          401,
          `Intercom webhook verification failed: ${verification.error || 'invalid signature'}`,
          'WEBHOOK_VERIFICATION_FAILED'
        );
      }
    }

    const event = (
      typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(rawBody)
    ) as IntercomWebhookEvent;

    const result = await intercomSupportService.handleWebhookEvent(event);
    res.status(200).json(result);
  })
);

// ============================================================================
// Health Check
// ============================================================================

/**
 * Health check endpoint for Intercom integration.
 */
intercomRouter.get(
  '/health',
  asyncHandler(async (_req: Request, res: Response) => {
    const isConfigured = intercomSupportService.isConfigured();
    if (!isConfigured) {
      res.json({
        configured: false,
        healthy: false,
        message: 'INTERCOM_ACCESS_TOKEN is not configured',
      });
      return;
    }

    const healthy = await intercomSupportService.getClient().testConnection();
    res.json({
      configured: true,
      healthy,
      message: healthy ? 'Intercom connection healthy' : 'Intercom connection failed',
    });
  })
);
