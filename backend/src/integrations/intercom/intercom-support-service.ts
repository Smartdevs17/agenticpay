import { IntercomClient } from './intercom-client.js';
import type {
  CreateSupportTicketInput,
  ReplyConversationInput,
  CloseConversationBodyInput,
  SnoozeConversationBodyInput,
  EscalatePaymentIssueInput,
  SyncCustomerContactInput,
  IntercomConversation,
  IntercomArticle,
  IntercomWebhookEvent,
} from './types.js';
import { createModuleLogger } from '../../middleware/logger.js';

const logger = createModuleLogger('intercom-support');

export interface SupportTicketResult {
  ticketId: string;
  contactId?: string;
  status: 'open' | 'closed' | 'snoozed';
  createdAt: number;
  category: string;
  priority: string;
}

export class IntercomSupportService {
  private client: IntercomClient | null = null;
  private defaultAdminId?: string;

  constructor(client?: IntercomClient, defaultAdminId?: string) {
    if (client) {
      this.client = client;
    }
    this.defaultAdminId = defaultAdminId || process.env.INTERCOM_ADMIN_ID;
  }

  /**
   * Lazily initialises or retrieves the IntercomClient instance.
   */
  getClient(): IntercomClient {
    if (!this.client) {
      const accessToken = process.env.INTERCOM_ACCESS_TOKEN;
      if (!accessToken) {
        throw new Error('INTERCOM_ACCESS_TOKEN environment variable is not configured');
      }
      this.client = new IntercomClient({
        accessToken,
        apiUrl: process.env.INTERCOM_API_URL,
        appId: process.env.INTERCOM_APP_ID,
        adminId: process.env.INTERCOM_ADMIN_ID,
      });
      this.defaultAdminId = this.defaultAdminId || process.env.INTERCOM_ADMIN_ID;
    }
    return this.client;
  }

  isConfigured(): boolean {
    return !!(this.client || process.env.INTERCOM_ACCESS_TOKEN);
  }

  /**
   * Creates a new customer support ticket in Intercom.
   * Ensures the customer contact exists/is upserted, opens a conversation,
   * and optionally leaves an internal note for urgent priority tickets.
   */
  async createTicket(input: CreateSupportTicketInput): Promise<SupportTicketResult> {
    const client = this.getClient();

    // 1. Ensure contact exists in Intercom
    let contactId: string | undefined;
    try {
      const contact = await client.upsertContactByExternalId(input.userId, {
        role: 'user',
        email: input.email,
        name: input.name,
        custom_attributes: {
          category: input.category,
          priority: input.priority,
          source: 'agenticpay_support',
          ...input.metadata,
        },
      });
      contactId = contact.id;
    } catch (err) {
      logger.warn({ err, userId: input.userId }, 'Failed to upsert contact in Intercom, continuing with email/id');
    }

    // 2. Build conversation body
    const header = input.subject ? `**Subject: ${input.subject}**\n\n` : '';
    const categoryTag = `[Category: ${input.category.toUpperCase()}] [Priority: ${input.priority.toUpperCase()}]\n\n`;
    const fullBody = `${header}${categoryTag}${input.message}`;

    // 3. Create conversation in Intercom
    const conversation = await client.createConversation({
      from: {
        type: 'user',
        id: contactId,
        email: !contactId ? input.email : undefined,
      },
      body: fullBody,
    });

    // 4. If priority is high or urgent, add a private internal note
    if (input.priority === 'urgent' || input.priority === 'high') {
      const adminId = this.defaultAdminId || client.adminId;
      if (adminId) {
        try {
          await client.replyToConversation({
            conversationId: conversation.id,
            adminId,
            body: `⚠️ **HIGH PRIORITY ESCALATION**\n- User ID: \`${input.userId}\`\n- Category: \`${input.category}\`\n- Metadata: ${JSON.stringify(input.metadata || {})}`,
            messageType: 'note',
          });
        } catch (err) {
          logger.warn({ err, conversationId: conversation.id }, 'Could not post internal escalation note');
        }
      }
    }

    logger.info({ ticketId: conversation.id, userId: input.userId }, 'Intercom support ticket created');

    return {
      ticketId: conversation.id,
      contactId,
      status: conversation.state || 'open',
      createdAt: conversation.created_at || Math.floor(Date.now() / 1000),
      category: input.category,
      priority: input.priority,
    };
  }

  /**
   * Retrieves an Intercom conversation by ID.
   */
  async getTicket(id: string): Promise<IntercomConversation> {
    const client = this.getClient();
    return client.getConversation(id);
  }

  /**
   * Replies to an existing support ticket with an admin comment or internal note.
   */
  async replyTicket(
    conversationId: string,
    input: ReplyConversationInput,
  ): Promise<IntercomConversation> {
    const client = this.getClient();
    const adminId = input.adminId || this.defaultAdminId || client.adminId;
    if (!adminId) {
      throw new Error('Admin ID is required to reply to an Intercom conversation');
    }

    return client.replyToConversation({
      conversationId,
      adminId,
      body: input.body,
      messageType: input.messageType,
    });
  }

  /**
   * Closes an Intercom conversation with an optional closing note.
   */
  async closeTicket(
    conversationId: string,
    input?: CloseConversationBodyInput,
  ): Promise<IntercomConversation> {
    const client = this.getClient();
    const adminId = input?.adminId || this.defaultAdminId || client.adminId;
    if (!adminId) {
      throw new Error('Admin ID is required to close an Intercom conversation');
    }

    return client.closeConversation({
      conversationId,
      adminId,
      body: input?.body,
    });
  }

  /**
   * Snoozes a conversation until a specified epoch timestamp.
   */
  async snoozeTicket(
    conversationId: string,
    input: SnoozeConversationBodyInput,
  ): Promise<IntercomConversation> {
    const client = this.getClient();
    const adminId = input.adminId || this.defaultAdminId || client.adminId;
    if (!adminId) {
      throw new Error('Admin ID is required to snooze an Intercom conversation');
    }

    return client.snoozeConversation({
      conversationId,
      adminId,
      snoozedUntil: input.snoozedUntil,
    });
  }

  /**
   * Adds a tag to a conversation.
   */
  async tagTicket(conversationId: string, tagId: string, adminId?: string): Promise<unknown> {
    const client = this.getClient();
    const resolvedAdminId = adminId || this.defaultAdminId || client.adminId;
    if (!resolvedAdminId) {
      throw new Error('Admin ID is required to tag an Intercom conversation');
    }

    return client.tagConversation({
      conversationId,
      tagId,
      adminId: resolvedAdminId,
    });
  }

  /**
   * Removes a tag from a conversation.
   */
  async untagTicket(conversationId: string, tagId: string, adminId?: string): Promise<unknown> {
    const client = this.getClient();
    const resolvedAdminId = adminId || this.defaultAdminId || client.adminId;
    if (!resolvedAdminId) {
      throw new Error('Admin ID is required to untag an Intercom conversation');
    }

    return client.untagConversation(conversationId, tagId, resolvedAdminId);
  }

  /**
   * Lists conversations from Intercom.
   */
  async listTickets(page = 1, perPage = 20): Promise<{
    conversations: IntercomConversation[];
    total_count: number;
    pages: { total_pages: number };
  }> {
    const client = this.getClient();
    return client.listConversations(page, perPage);
  }

  /**
   * Auto-escalates payment failures, transaction errors, or dispute issues
   * directly to an urgent Intercom support ticket.
   */
  async escalatePaymentIssue(input: EscalatePaymentIssueInput): Promise<{
    escalated: boolean;
    ticketId: string;
    contactId?: string;
  }> {
    const client = this.getClient();

    const body = [
      `🚨 **Payment Issue Escalation**`,
      `**Payment ID:** \`${input.paymentId}\``,
      `**Amount:** ${input.amount} ${input.currency.toUpperCase()}`,
      `**Failure Reason:** ${input.failureReason}`,
      input.provider ? `**Provider:** ${input.provider}` : '',
      input.invoiceId ? `**Invoice ID:** \`${input.invoiceId}\`` : '',
      input.transactionHash ? `**Transaction Hash:** \`${input.transactionHash}\`` : '',
      `\nPlease inspect this transaction and contact the customer if immediate settlement or refund is needed.`,
    ]
      .filter(Boolean)
      .join('\n');

    const result = await this.createTicket({
      userId: input.userId,
      email: input.userEmail,
      name: input.userName,
      subject: `Payment Failed: ${input.paymentId} (${input.amount} ${input.currency.toUpperCase()})`,
      message: body,
      category: 'payment_failure',
      priority: 'urgent',
      metadata: {
        paymentId: input.paymentId,
        amount: input.amount,
        currency: input.currency,
        failureReason: input.failureReason,
        transactionHash: input.transactionHash,
        invoiceId: input.invoiceId,
        provider: input.provider,
        escalatedAt: new Date().toISOString(),
        ...input.metadata,
      },
    });

    return {
      escalated: true,
      ticketId: result.ticketId,
      contactId: result.contactId,
    };
  }

  /**
   * Synchronises customer contact profile to Intercom.
   */
  async syncCustomerContact(input: SyncCustomerContactInput): Promise<{
    success: boolean;
    contactId: string;
  }> {
    const client = this.getClient();
    const contact = await client.upsertContactByExternalId(input.userId, {
      role: 'user',
      email: input.email,
      name: input.name,
      phone: input.phone,
      custom_attributes: {
        tier: input.tier || 'standard',
        wallet_address: input.walletAddress,
        agenticpay_synced_at: Math.floor(Date.now() / 1000),
        ...input.customAttributes,
      },
    });

    return {
      success: true,
      contactId: contact.id,
    };
  }

  /**
   * Searches the Intercom Help Center articles for matching knowledge base docs.
   */
  async searchHelpArticles(query: string, perPage = 5): Promise<IntercomArticle[]> {
    const client = this.getClient();
    const result = await client.searchArticles({ query, perPage });
    return result.data || [];
  }

  /**
   * Handles inbound Intercom webhook events.
   */
  async handleWebhookEvent(event: IntercomWebhookEvent): Promise<{
    handled: boolean;
    topic: string;
    action?: string;
  }> {
    logger.info({ topic: event.topic, eventId: event.id }, 'Received Intercom webhook event');

    switch (event.topic) {
      case 'conversation.user.replied': {
        const item = event.data.item as { id?: string; source?: { body?: string } };
        logger.info({ conversationId: item?.id }, 'User replied to conversation in Intercom');
        return { handled: true, topic: event.topic, action: 'user_reply_logged' };
      }

      case 'conversation.admin.closed': {
        const item = event.data.item as { id?: string };
        logger.info({ conversationId: item?.id }, 'Conversation closed by admin in Intercom');
        return { handled: true, topic: event.topic, action: 'conversation_closed' };
      }

      case 'conversation.admin.replied': {
        const item = event.data.item as { id?: string };
        logger.info({ conversationId: item?.id }, 'Admin replied to conversation in Intercom');
        return { handled: true, topic: event.topic, action: 'admin_reply_logged' };
      }

      default:
        logger.debug({ topic: event.topic }, 'Unhandled Intercom webhook topic');
        return { handled: true, topic: event.topic, action: 'unhandled_topic' };
    }
  }
}

export const intercomSupportService = new IntercomSupportService();
