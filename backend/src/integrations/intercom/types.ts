import { z } from 'zod';

export interface IntercomClientConfig {
  accessToken: string;
  apiUrl?: string;
  appId?: string;
  adminId?: string;
  timeoutMs?: number;
}

// ── Contacts ────────────────────────────────────────────────────────────────

export interface IntercomContact {
  id: string;
  type: 'user' | 'lead';
  external_id?: string;
  email?: string;
  name?: string;
  phone?: string;
  role: string;
  created_at: number;
  updated_at: number;
  custom_attributes?: Record<string, unknown>;
}

export interface CreateContactInput {
  role: 'user' | 'lead';
  external_id?: string;
  email?: string;
  name?: string;
  phone?: string;
  custom_attributes?: Record<string, unknown>;
}

export interface SearchContactsInput {
  email?: string;
  external_id?: string;
  name?: string;
}

// ── Conversations ───────────────────────────────────────────────────────────

export interface IntercomConversation {
  id: string;
  type: 'conversation';
  title?: string;
  state: 'open' | 'closed' | 'snoozed';
  open: boolean;
  created_at: number;
  updated_at: number;
  waiting_since?: number;
  source?: {
    type: string;
    id: string;
    body: string;
    author: { type: string; id: string; name?: string; email?: string };
  };
  tags?: { tags: Array<{ id: string; name: string }> };
  custom_attributes?: Record<string, unknown>;
}

export interface CreateConversationInput {
  from: { type: 'user' | 'lead'; id?: string; email?: string };
  body: string;
}

export interface ReplyToConversationInput {
  conversationId: string;
  adminId: string;
  body: string;
  messageType?: 'comment' | 'note';
}

export interface CloseConversationInput {
  conversationId: string;
  adminId: string;
  body?: string;
}

export interface SnoozeConversationInput {
  conversationId: string;
  adminId: string;
  snoozedUntil: number;
}

// ── Messages ────────────────────────────────────────────────────────────────

export interface IntercomMessage {
  id: string;
  type: 'admin_message' | 'user_message';
  body: string;
  message_type: 'inapp' | 'email';
  created_at: number;
}

export interface SendMessageInput {
  message_type: 'inapp' | 'email';
  subject?: string;
  body: string;
  template?: string;
  from: { type: 'admin'; id: string };
  to: { type: 'user' | 'lead'; id?: string; email?: string };
}

// ── Tags ────────────────────────────────────────────────────────────────────

export interface IntercomTag {
  id: string;
  name: string;
  type: 'tag';
}

export interface TagConversationInput {
  conversationId: string;
  tagId: string;
  adminId: string;
}

// ── Articles ────────────────────────────────────────────────────────────────

export interface IntercomArticle {
  id: string;
  type: 'article';
  title: string;
  description?: string;
  body: string;
  state: 'published' | 'draft';
  url?: string;
  created_at: number;
  updated_at: number;
}

export interface SearchArticlesInput {
  query: string;
  perPage?: number;
}

// ── Webhooks (Inbound from Intercom) ────────────────────────────────────────

export type IntercomWebhookTopic =
  | 'conversation.created'
  | 'conversation.user.replied'
  | 'conversation.admin.replied'
  | 'conversation.admin.closed'
  | 'conversation.admin.opened'
  | 'conversation.admin.snoozed'
  | 'conversation.admin.unsnoozed'
  | 'conversation.admin.assigned'
  | 'conversation.rating.added'
  | 'contact.created'
  | 'contact.signed_up'
  | 'contact.tag.created'
  | 'contact.tag.deleted';

export interface IntercomWebhookEvent {
  type: 'notification_event';
  app_id: string;
  topic: IntercomWebhookTopic;
  id: string;
  created_at: number;
  delivery_status: string;
  data: {
    type: string;
    item: Record<string, unknown>;
  };
}

// ── Support Service Types & Zod Schemas ─────────────────────────────────────

export const supportTicketCategorySchema = z.enum([
  'payment_failure',
  'dispute',
  'refund',
  'kyc',
  'billing',
  'general',
  'bug',
]);
export type SupportTicketCategory = z.infer<typeof supportTicketCategorySchema>;

export const supportTicketPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export type SupportTicketPriority = z.infer<typeof supportTicketPrioritySchema>;

export const createSupportTicketSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  email: z.string().email().optional(),
  name: z.string().optional(),
  subject: z.string().optional(),
  message: z.string().min(1, 'message is required'),
  category: supportTicketCategorySchema.default('general'),
  priority: supportTicketPrioritySchema.default('normal'),
  metadata: z.record(z.unknown()).optional(),
});
export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>;

export const replyConversationSchema = z.object({
  adminId: z.string().optional(),
  body: z.string().min(1, 'body is required'),
  messageType: z.enum(['comment', 'note']).default('comment'),
});
export type ReplyConversationInput = z.infer<typeof replyConversationSchema>;

export const closeConversationSchema = z.object({
  adminId: z.string().optional(),
  body: z.string().optional(),
});
export type CloseConversationBodyInput = z.infer<typeof closeConversationSchema>;

export const snoozeConversationSchema = z.object({
  adminId: z.string().optional(),
  snoozedUntil: z.number().int().positive(),
});
export type SnoozeConversationBodyInput = z.infer<typeof snoozeConversationSchema>;

export const tagConversationSchema = z.object({
  tagId: z.string().min(1, 'tagId is required'),
  adminId: z.string().optional(),
});
export type TagConversationBodyInput = z.infer<typeof tagConversationSchema>;

export const escalatePaymentIssueSchema = z.object({
  paymentId: z.string().min(1, 'paymentId is required'),
  userId: z.string().min(1, 'userId is required'),
  userEmail: z.string().email().optional(),
  userName: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().min(1),
  failureReason: z.string().min(1, 'failureReason is required'),
  transactionHash: z.string().optional(),
  invoiceId: z.string().optional(),
  provider: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type EscalatePaymentIssueInput = z.infer<typeof escalatePaymentIssueSchema>;

export const syncCustomerContactSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  email: z.string().email(),
  name: z.string().optional(),
  phone: z.string().optional(),
  tier: z.string().optional(),
  walletAddress: z.string().optional(),
  customAttributes: z.record(z.unknown()).optional(),
});
export type SyncCustomerContactInput = z.infer<typeof syncCustomerContactSchema>;

export const searchArticlesSchema = z.object({
  query: z.string().min(1, 'query is required'),
  perPage: z.coerce.number().int().min(1).max(20).default(5),
});
export type SearchArticlesQuery = z.infer<typeof searchArticlesSchema>;
