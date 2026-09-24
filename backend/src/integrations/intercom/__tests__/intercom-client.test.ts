import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { IntercomClient } from '../intercom-client.js';

describe('IntercomClient', () => {
  let client: IntercomClient;
  const originalFetch = global.fetch;

  beforeEach(() => {
    client = new IntercomClient({
      accessToken: 'test-token-12345',
      apiUrl: 'https://api.intercom.io',
      appId: 'test-app-id',
      adminId: 'admin-999',
      timeoutMs: 1000,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('Webhook Signature Verification', () => {
    it('verifies a valid HMAC-SHA1 signature', () => {
      const payload = JSON.stringify({ event: 'conversation.created', id: '123' });
      const secret = 'my-intercom-secret';
      const hash = createHmac('sha1', secret).update(payload).digest('hex');
      const signature = `sha1=${hash}`;

      expect(IntercomClient.verifyWebhookSignature(payload, signature, secret)).toBe(true);
    });

    it('rejects an invalid signature', () => {
      const payload = JSON.stringify({ event: 'conversation.created', id: '123' });
      const secret = 'my-intercom-secret';
      const signature = 'sha1=badbadbadbadbadbadbadbadbadbadbadbadbadb';

      expect(IntercomClient.verifyWebhookSignature(payload, signature, secret)).toBe(false);
    });

    it('rejects when signature or secret is missing', () => {
      expect(IntercomClient.verifyWebhookSignature('payload', '', 'secret')).toBe(false);
      expect(IntercomClient.verifyWebhookSignature('payload', 'sha1=123', '')).toBe(false);
    });
  });

  describe('Contacts API', () => {
    it('creates a contact successfully', async () => {
      const mockContact = {
        id: 'contact_1',
        type: 'user',
        email: 'user@example.com',
        role: 'user',
        created_at: 1700000000,
        updated_at: 1700000000,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockContact,
      } as unknown as Response);

      const contact = await client.createContact({
        role: 'user',
        email: 'user@example.com',
        name: 'Test User',
      });

      expect(contact).toEqual(mockContact);
      const [url, options] = (global.fetch as any).mock.calls[0];
      expect(url).toBe('https://api.intercom.io/contacts');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('Bearer test-token-12345');
    });

    it('searches contacts by external_id and email', async () => {
      const mockResponse = {
        data: [{ id: 'contact_2', type: 'user', email: 'search@example.com', role: 'user' }],
        total_count: 1,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as unknown as Response);

      const result = await client.searchContacts({ email: 'search@example.com' });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('contact_2');
    });

    it('upserts a contact by external_id (creates when not existing)', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: [], total_count: 0 }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 'contact_created', type: 'user', external_id: 'usr_new' }),
        } as unknown as Response);

      const contact = await client.upsertContactByExternalId('usr_new', {
        role: 'user',
        email: 'new@example.com',
      });

      expect(contact.id).toBe('contact_created');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Conversations API', () => {
    it('creates a conversation successfully', async () => {
      const mockConv = {
        id: 'conv_123',
        type: 'conversation',
        state: 'open',
        open: true,
        created_at: 1700000000,
        updated_at: 1700000000,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockConv,
      } as unknown as Response);

      const conv = await client.createConversation({
        from: { type: 'user', id: 'contact_1' },
        body: 'Need help with payment',
      });

      expect(conv.id).toBe('conv_123');
      const [url, options] = (global.fetch as any).mock.calls[0];
      expect(url).toBe('https://api.intercom.io/conversations');
      expect(options.method).toBe('POST');
    });

    it('replies to a conversation', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'conv_123', state: 'open' }),
      } as unknown as Response);

      const res = await client.replyToConversation({
        conversationId: 'conv_123',
        adminId: 'admin-999',
        body: 'Here is your update',
      });

      expect(res.id).toBe('conv_123');
      const [url, options] = (global.fetch as any).mock.calls[0];
      expect(url).toBe('https://api.intercom.io/conversations/conv_123/reply');
      expect(JSON.parse(options.body).body).toBe('Here is your update');
    });

    it('closes a conversation', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'conv_123', state: 'closed' }),
      } as unknown as Response);

      const res = await client.closeConversation({
        conversationId: 'conv_123',
        adminId: 'admin-999',
        body: 'Closing conversation.',
      });

      expect(res.state).toBe('closed');
      const [url] = (global.fetch as any).mock.calls[0];
      expect(url).toBe('https://api.intercom.io/conversations/conv_123/parts');
    });
  });

  describe('Articles & Health', () => {
    it('searches articles by query', async () => {
      const mockArticles = {
        data: [{ id: 'art_1', type: 'article', title: 'Refund Policy', body: '...' }],
        total_count: 1,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockArticles,
      } as unknown as Response);

      const result = await client.searchArticles({ query: 'refund' });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].title).toBe('Refund Policy');
    });

    it('tests connection health', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ type: 'admin', id: 'admin-1' }),
      } as unknown as Response);

      const isHealthy = await client.testConnection();
      expect(isHealthy).toBe(true);
    });

    it('handles API errors gracefully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid token',
      } as unknown as Response);

      await expect(client.getContact('bad_id')).rejects.toThrow('Intercom API error 401');
    });
  });
});
