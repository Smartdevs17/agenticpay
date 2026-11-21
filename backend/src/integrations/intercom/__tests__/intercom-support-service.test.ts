import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntercomSupportService } from '../intercom-support-service.js';
import { IntercomClient } from '../intercom-client.js';

describe('IntercomSupportService', () => {
  let service: IntercomSupportService;
  let mockClient: Partial<IntercomClient>;

  beforeEach(() => {
    mockClient = {
      adminId: 'admin_test_1',
      upsertContactByExternalId: vi.fn().mockResolvedValue({
        id: 'contact_123',
        type: 'user',
        email: 'user@example.com',
      }),
      createConversation: vi.fn().mockResolvedValue({
        id: 'conv_456',
        type: 'conversation',
        state: 'open',
        open: true,
        created_at: 1700000000,
      }),
      getConversation: vi.fn().mockResolvedValue({
        id: 'conv_456',
        type: 'conversation',
        state: 'open',
      }),
      replyToConversation: vi.fn().mockResolvedValue({
        id: 'conv_456',
        state: 'open',
      }),
      closeConversation: vi.fn().mockResolvedValue({
        id: 'conv_456',
        state: 'closed',
      }),
      snoozeConversation: vi.fn().mockResolvedValue({
        id: 'conv_456',
        state: 'snoozed',
      }),
      tagConversation: vi.fn().mockResolvedValue({
        id: 'tag_1',
        name: 'urgent',
      }),
      untagConversation: vi.fn().mockResolvedValue({
        id: 'tag_1',
      }),
      listConversations: vi.fn().mockResolvedValue({
        conversations: [{ id: 'conv_456', state: 'open' }],
        total_count: 1,
        pages: { total_pages: 1 },
      }),
      searchArticles: vi.fn().mockResolvedValue({
        data: [{ id: 'art_1', title: 'Payment Help', body: '...' }],
        total_count: 1,
      }),
      testConnection: vi.fn().mockResolvedValue(true),
    };

    service = new IntercomSupportService(mockClient as unknown as IntercomClient, 'admin_test_1');
  });

  describe('createTicket', () => {
    it('creates contact and conversation for a standard support ticket', async () => {
      const result = await service.createTicket({
        userId: 'usr_123',
        email: 'user@example.com',
        name: 'Jane Doe',
        subject: 'General Question',
        message: 'How do I generate an invoice?',
        category: 'general',
        priority: 'normal',
      });

      expect(result.ticketId).toBe('conv_456');
      expect(result.status).toBe('open');
      expect(result.category).toBe('general');
      expect(result.priority).toBe('normal');
      expect(mockClient.upsertContactByExternalId).toHaveBeenCalledWith('usr_123', expect.anything());
      expect(mockClient.createConversation).toHaveBeenCalled();
      // For normal priority, no internal escalation note should be posted
      expect(mockClient.replyToConversation).not.toHaveBeenCalled();
    });

    it('posts an internal admin note when ticket priority is urgent', async () => {
      await service.createTicket({
        userId: 'usr_urgent',
        email: 'urgent@example.com',
        message: 'System critical payment failed',
        category: 'payment_failure',
        priority: 'urgent',
      });

      expect(mockClient.replyToConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv_456',
          adminId: 'admin_test_1',
          messageType: 'note',
        })
      );
    });
  });

  describe('conversation lifecycle', () => {
    it('retrieves an existing ticket', async () => {
      const conv = await service.getTicket('conv_456');
      expect(conv.id).toBe('conv_456');
      expect(mockClient.getConversation).toHaveBeenCalledWith('conv_456');
    });

    it('replies to a ticket with an admin comment', async () => {
      await service.replyTicket('conv_456', {
        body: 'Working on this now.',
        messageType: 'comment',
      });

      expect(mockClient.replyToConversation).toHaveBeenCalledWith({
        conversationId: 'conv_456',
        adminId: 'admin_test_1',
        body: 'Working on this now.',
        messageType: 'comment',
      });
    });

    it('closes a ticket with a closing note', async () => {
      const res = await service.closeTicket('conv_456', { body: 'Resolved' });
      expect(res.state).toBe('closed');
      expect(mockClient.closeConversation).toHaveBeenCalledWith({
        conversationId: 'conv_456',
        adminId: 'admin_test_1',
        body: 'Resolved',
      });
    });

    it('snoozes a ticket until given epoch', async () => {
      const until = 1750000000;
      await service.snoozeTicket('conv_456', { snoozedUntil: until });
      expect(mockClient.snoozeConversation).toHaveBeenCalledWith({
        conversationId: 'conv_456',
        adminId: 'admin_test_1',
        snoozedUntil: until,
      });
    });

    it('tags and untags a ticket', async () => {
      await service.tagTicket('conv_456', 'tag_urgent');
      expect(mockClient.tagConversation).toHaveBeenCalledWith({
        conversationId: 'conv_456',
        tagId: 'tag_urgent',
        adminId: 'admin_test_1',
      });

      await service.untagTicket('conv_456', 'tag_urgent');
      expect(mockClient.untagConversation).toHaveBeenCalledWith(
        'conv_456',
        'tag_urgent',
        'admin_test_1'
      );
    });

    it('lists tickets with pagination', async () => {
      const res = await service.listTickets(1, 10);
      expect(res.conversations).toHaveLength(1);
      expect(mockClient.listConversations).toHaveBeenCalledWith(1, 10);
    });
  });

  describe('escalatePaymentIssue', () => {
    it('creates an urgent ticket with payment failure details', async () => {
      const res = await service.escalatePaymentIssue({
        paymentId: 'pay_999',
        userId: 'usr_fail',
        userEmail: 'fail@example.com',
        userName: 'Fail User',
        amount: 500,
        currency: 'USDC',
        failureReason: 'Insufficient funds on trustline',
        transactionHash: 'hash_abc_123',
        invoiceId: 'inv_888',
        provider: 'stellar',
      });

      expect(res.escalated).toBe(true);
      expect(res.ticketId).toBe('conv_456');
      expect(mockClient.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('pay_999'),
        })
      );
    });
  });

  describe('syncCustomerContact', () => {
    it('upserts contact with wallet address and customer tier', async () => {
      const res = await service.syncCustomerContact({
        userId: 'usr_wallet_user',
        email: 'wallet@example.com',
        name: 'Wallet User',
        tier: 'enterprise',
        walletAddress: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      });

      expect(res.success).toBe(true);
      expect(res.contactId).toBe('contact_123');
      expect(mockClient.upsertContactByExternalId).toHaveBeenCalledWith(
        'usr_wallet_user',
        expect.objectContaining({
          email: 'wallet@example.com',
          custom_attributes: expect.objectContaining({
            tier: 'enterprise',
            wallet_address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          }),
        })
      );
    });
  });

  describe('searchHelpArticles', () => {
    it('searches knowledge base articles', async () => {
      const articles = await service.searchHelpArticles('refund');
      expect(articles).toHaveLength(1);
      expect(articles[0].title).toBe('Payment Help');
      expect(mockClient.searchArticles).toHaveBeenCalledWith({ query: 'refund', perPage: 5 });
    });
  });

  describe('handleWebhookEvent', () => {
    it('handles conversation.user.replied event', async () => {
      const result = await service.handleWebhookEvent({
        type: 'notification_event',
        app_id: 'app_1',
        topic: 'conversation.user.replied',
        id: 'evt_1',
        created_at: 1700000000,
        delivery_status: 'delivered',
        data: {
          type: 'conversation',
          item: { id: 'conv_456' },
        },
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('user_reply_logged');
    });

    it('handles conversation.admin.closed event', async () => {
      const result = await service.handleWebhookEvent({
        type: 'notification_event',
        app_id: 'app_1',
        topic: 'conversation.admin.closed',
        id: 'evt_2',
        created_at: 1700000000,
        delivery_status: 'delivered',
        data: {
          type: 'conversation',
          item: { id: 'conv_456' },
        },
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('conversation_closed');
    });
  });
});
