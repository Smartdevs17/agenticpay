import type { WebhookProvider } from './verification.js';

export interface WebhookAuditRecord {
  id: string;
  provider: WebhookProvider;
  eventId: string;
  payload: unknown;
  signaturePreview: string;
  verified: boolean;
  error?: string;
  receivedAt: string;
}

const auditLog: WebhookAuditRecord[] = [];
const MAX_AUDIT = 5000;

export function storeWebhookPayload(input: {
  provider: WebhookProvider;
  eventId: string;
  payload: unknown;
  signature: string;
  verified: boolean;
  error?: string;
}): WebhookAuditRecord {
  const record: WebhookAuditRecord = {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    provider: input.provider,
    eventId: input.eventId,
    payload: input.payload,
    signaturePreview: input.signature.slice(0, 16) + '…',
    verified: input.verified,
    error: input.error,
    receivedAt: new Date().toISOString(),
  };
  auditLog.unshift(record);
  if (auditLog.length > MAX_AUDIT) auditLog.length = MAX_AUDIT;
  return record;
}

export function getWebhookAuditLog(limit = 100): WebhookAuditRecord[] {
  return auditLog.slice(0, limit);
}

export function clearWebhookAudit(): void {
  auditLog.length = 0;
}
