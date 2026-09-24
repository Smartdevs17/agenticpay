import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  IntercomClientConfig,
  IntercomContact,
  CreateContactInput,
  SearchContactsInput,
  IntercomConversation,
  CreateConversationInput,
  ReplyToConversationInput,
  CloseConversationInput,
  SnoozeConversationInput,
  IntercomMessage,
  SendMessageInput,
  IntercomTag,
  TagConversationInput,
  IntercomArticle,
  SearchArticlesInput,
} from './types.js';

/**
 * Intercom REST API v2.10 client for customer support operations.
 *
 * Provides methods for managing contacts, conversations, messages,
 * tags, and articles through the Intercom API.
 */
export class IntercomClient {
  private readonly accessToken: string;
  private readonly apiUrl: string;
  public readonly appId?: string;
  public readonly adminId?: string;
  private readonly timeoutMs: number;

  constructor(config: IntercomClientConfig) {
    this.accessToken = config.accessToken;
    this.apiUrl = config.apiUrl || 'https://api.intercom.io';
    this.appId = config.appId;
    this.adminId = config.adminId;
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Intercom-Version': '2.10',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Intercom API error ${response.status}: ${response.statusText} – ${errorText}`,
      );
    }

    // Some endpoints return 204 with no body
    if (response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  }

  // ── Connection Verification ───────────────────────────────────────────────

  async getMe(): Promise<{ type: string; id: string; name?: string; email?: string }> {
    return this.request('GET', '/me');
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.getMe();
      return true;
    } catch {
      return false;
    }
  }

  // ── Contacts ──────────────────────────────────────────────────────────────

  async createContact(input: CreateContactInput): Promise<IntercomContact> {
    return this.request<IntercomContact>('POST', '/contacts', input);
  }

  async getContact(id: string): Promise<IntercomContact> {
    return this.request<IntercomContact>('GET', `/contacts/${id}`);
  }

  async updateContact(
    id: string,
    attrs: Partial<CreateContactInput>,
  ): Promise<IntercomContact> {
    return this.request<IntercomContact>('PUT', `/contacts/${id}`, attrs);
  }

  async searchContacts(
    input: SearchContactsInput,
  ): Promise<{ data: IntercomContact[]; total_count: number }> {
    const filters: Array<{ field: string; operator: string; value: string }> = [];
    if (input.email) {
      filters.push({ field: 'email', operator: '=', value: input.email });
    }
    if (input.external_id) {
      filters.push({ field: 'external_id', operator: '=', value: input.external_id });
    }
    if (input.name) {
      filters.push({ field: 'name', operator: '~', value: input.name });
    }

    const query =
      filters.length === 1
        ? { field: filters[0].field, operator: filters[0].operator, value: filters[0].value }
        : { operator: 'AND', value: filters };

    return this.request('POST', '/contacts/search', { query });
  }

  async upsertContactByExternalId(
    externalId: string,
    attrs: Omit<CreateContactInput, 'external_id'>,
  ): Promise<IntercomContact> {
    const existing = await this.searchContacts({ external_id: externalId });
    if (existing.data && existing.data.length > 0) {
      return this.updateContact(existing.data[0].id, { ...attrs, external_id: externalId });
    }
    return this.createContact({ ...attrs, external_id: externalId });
  }

  // ── Conversations ─────────────────────────────────────────────────────────

  async createConversation(
    input: CreateConversationInput,
  ): Promise<IntercomConversation> {
    return this.request<IntercomConversation>('POST', '/conversations', input);
  }

  async getConversation(id: string): Promise<IntercomConversation> {
    return this.request<IntercomConversation>('GET', `/conversations/${id}`);
  }

  async replyToConversation(
    input: ReplyToConversationInput,
  ): Promise<IntercomConversation> {
    return this.request<IntercomConversation>(
      'POST',
      `/conversations/${input.conversationId}/reply`,
      {
        type: 'admin',
        admin_id: input.adminId,
        body: input.body,
        message_type: input.messageType || 'comment',
      },
    );
  }

  async closeConversation(
    input: CloseConversationInput,
  ): Promise<IntercomConversation> {
    return this.request<IntercomConversation>(
      'POST',
      `/conversations/${input.conversationId}/parts`,
      {
        type: 'admin',
        admin_id: input.adminId,
        body: input.body || 'Closing this conversation.',
        message_type: 'close',
      },
    );
  }

  async snoozeConversation(
    input: SnoozeConversationInput,
  ): Promise<IntercomConversation> {
    return this.request<IntercomConversation>(
      'POST',
      `/conversations/${input.conversationId}/reply`,
      {
        type: 'admin',
        admin_id: input.adminId,
        message_type: 'snoozed',
        snoozed_until: input.snoozedUntil,
      },
    );
  }

  async listConversations(
    page = 1,
    perPage = 20,
  ): Promise<{ conversations: IntercomConversation[]; total_count: number; pages: { total_pages: number } }> {
    return this.request(
      'GET',
      `/conversations?page=${page}&per_page=${perPage}`,
    );
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  async sendMessage(input: SendMessageInput): Promise<IntercomMessage> {
    return this.request<IntercomMessage>('POST', '/messages', input);
  }

  // ── Tags ──────────────────────────────────────────────────────────────────

  async listTags(): Promise<{ type: string; data: IntercomTag[] }> {
    return this.request('GET', '/tags');
  }

  async createTag(name: string): Promise<IntercomTag> {
    return this.request<IntercomTag>('POST', '/tags', { name });
  }

  async tagConversation(input: TagConversationInput): Promise<IntercomTag> {
    return this.request<IntercomTag>(
      'POST',
      `/conversations/${input.conversationId}/tags`,
      { id: input.tagId, admin_id: input.adminId },
    );
  }

  async untagConversation(
    conversationId: string,
    tagId: string,
    adminId: string,
  ): Promise<IntercomTag> {
    return this.request<IntercomTag>(
      'DELETE',
      `/conversations/${conversationId}/tags/${tagId}`,
      { admin_id: adminId },
    );
  }

  // ── Articles / Help Center ────────────────────────────────────────────────

  async searchArticles(
    input: SearchArticlesInput,
  ): Promise<{ data: IntercomArticle[]; total_count: number }> {
    return this.request('GET', `/articles/search?phrase=${encodeURIComponent(input.query)}&per_page=${input.perPage ?? 5}`);
  }

  async getArticle(id: string): Promise<IntercomArticle> {
    return this.request<IntercomArticle>('GET', `/articles/${id}`);
  }

  // ── Webhook Signature Verification ────────────────────────────────────────

  /**
   * Verifies that an inbound webhook payload was signed by Intercom using
   * HMAC-SHA1 with your client secret. Intercom transmits this in the
   * `x-hub-signature` header as `sha1=<hex_digest>`.
   */
  static verifyWebhookSignature(
    payload: string,
    signature: string,
    clientSecret: string,
  ): boolean {
    if (!signature || !clientSecret) {
      return false;
    }

    try {
      const expected = `sha1=${createHmac('sha1', clientSecret).update(payload).digest('hex')}`;
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expected);
      if (sigBuf.length !== expBuf.length) {
        return false;
      }
      return timingSafeEqual(sigBuf, expBuf);
    } catch {
      return false;
    }
  }
}
