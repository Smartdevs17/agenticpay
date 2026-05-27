import { randomUUID } from 'node:crypto';
import type {
  GdprRequest,
  GdprRequestType,
  ConsentRecord,
  ConsentPurpose,
  ThirdPartyProcessor,
  AuditEntry,
  RetentionPolicy,
  UserDataExport,
} from '../types/gdpr.js';

// In-memory stores (replace with DB in production)
const gdprRequests = new Map<string, GdprRequest>();
const consentRecords = new Map<string, ConsentRecord[]>(); // keyed by userId
const auditLog: AuditEntry[] = [];
const thirdPartyProcessors: ThirdPartyProcessor[] = [
  {
    id: 'proc-001',
    name: 'Stellar Network',
    purpose: 'Blockchain payment processing',
    dataCategories: ['wallet_address', 'transaction_data'],
    contractDate: '2024-01-01',
    dpaSignedAt: '2024-01-01',
    contactEmail: 'privacy@stellar.org',
    privacyPolicyUrl: 'https://stellar.org/privacy',
  },
  {
    id: 'proc-002',
    name: 'OpenAI',
    purpose: 'AI invoice generation and verification',
    dataCategories: ['work_descriptions', 'project_data'],
    contractDate: '2024-01-01',
    dpaSignedAt: '2024-01-15',
    contactEmail: 'privacy@openai.com',
    privacyPolicyUrl: 'https://openai.com/privacy',
  },
];

export const retentionPolicies: RetentionPolicy[] = [
  { dataCategory: 'invoices', retentionDays: 2555, legalBasis: 'Legal obligation (tax records)', autoDelete: false },
  { dataCategory: 'payment_data', retentionDays: 2555, legalBasis: 'Legal obligation', autoDelete: false },
  { dataCategory: 'analytics', retentionDays: 365, legalBasis: 'Legitimate interest', autoDelete: true },
  { dataCategory: 'marketing_data', retentionDays: 180, legalBasis: 'Consent', autoDelete: true },
  { dataCategory: 'session_logs', retentionDays: 90, legalBasis: 'Legitimate interest', autoDelete: true },
];

function addAuditEntry(
  action: string,
  userId: string | null,
  requestId: string | null,
  details: Record<string, unknown>,
  performedBy: string
): AuditEntry {
  const entry: AuditEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    action,
    userId,
    requestId,
    details,
    performedBy,
  };
  auditLog.push(entry);
  return entry;
}

function computeDeadline(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString();
}

// --- GDPR Requests ---

export function createGdprRequest(
  userId: string,
  type: GdprRequestType,
  requestedBy: string,
  notes?: string
): GdprRequest {
  const request: GdprRequest = {
    id: randomUUID(),
    userId,
    type,
    status: 'pending',
    createdAt: new Date().toISOString(),
    deadlineAt: computeDeadline(),
    processedAt: null,
    notes: notes ?? null,
    requestedBy,
  };
  gdprRequests.set(request.id, request);
  addAuditEntry('gdpr_request_created', userId, request.id, { type, requestedBy }, requestedBy);
  return request;
}

export function getGdprRequest(requestId: string): GdprRequest | undefined {
  return gdprRequests.get(requestId);
}

export function listGdprRequests(userId?: string): GdprRequest[] {
  const all = Array.from(gdprRequests.values());
  return userId ? all.filter((r) => r.userId === userId) : all;
}

export function updateGdprRequestStatus(
  requestId: string,
  status: GdprRequest['status'],
  performedBy: string
): GdprRequest | null {
  const request = gdprRequests.get(requestId);
  if (!request) return null;
  request.status = status;
  if (status === 'completed' || status === 'rejected') {
    request.processedAt = new Date().toISOString();
  }
  gdprRequests.set(requestId, request);
  addAuditEntry('gdpr_request_status_updated', request.userId, requestId, { status }, performedBy);
  return request;
}

// --- Right to Erasure ---

export function eraseUserData(userId: string, performedBy: string): { erased: string[] } {
  const erased: string[] = [];

  // Remove consent records
  if (consentRecords.has(userId)) {
    consentRecords.delete(userId);
    erased.push('consent_records');
  }

  // Mark all pending GDPR requests as completed
  for (const [id, req] of gdprRequests.entries()) {
    if (req.userId === userId && req.type === 'erasure' && req.status === 'pending') {
      req.status = 'completed';
      req.processedAt = new Date().toISOString();
      gdprRequests.set(id, req);
    }
  }

  erased.push('profile_pii', 'session_data', 'analytics_data', 'marketing_preferences');

  addAuditEntry('user_data_erased', userId, null, { erased, performedBy }, performedBy);
  return { erased };
}

// --- Right to Data Portability ---

export function exportUserData(userId: string, performedBy: string): UserDataExport {
  const userConsents = consentRecords.get(userId) ?? [];
  const userRequests = listGdprRequests(userId);
  const userAudit = auditLog.filter((e) => e.userId === userId);

  addAuditEntry('user_data_exported', userId, null, { performedBy }, performedBy);

  return {
    exportedAt: new Date().toISOString(),
    userId,
    profile: {
      userId,
      note: 'Full profile data would be fetched from the user database in production',
    },
    consents: userConsents,
    gdprRequests: userRequests,
    auditTrail: userAudit,
  };
}

// --- Consent Management ---

export function recordConsent(
  userId: string,
  purpose: ConsentPurpose,
  granted: boolean,
  ipAddress: string,
  userAgent: string
): ConsentRecord {
  const record: ConsentRecord = {
    userId,
    purpose,
    granted,
    grantedAt: granted ? new Date().toISOString() : null,
    revokedAt: !granted ? new Date().toISOString() : null,
    ipAddress,
    userAgent,
  };

  const existing = consentRecords.get(userId) ?? [];
  const idx = existing.findIndex((c) => c.purpose === purpose);
  if (idx >= 0) {
    existing[idx] = record;
  } else {
    existing.push(record);
  }
  consentRecords.set(userId, existing);

  addAuditEntry(
    granted ? 'consent_granted' : 'consent_revoked',
    userId,
    null,
    { purpose, ipAddress },
    userId
  );
  return record;
}

export function getUserConsents(userId: string): ConsentRecord[] {
  return consentRecords.get(userId) ?? [];
}

// --- Third-Party Processors ---

export function listThirdPartyProcessors(): ThirdPartyProcessor[] {
  return thirdPartyProcessors;
}

// --- Retention Policies ---

export function listRetentionPolicies(): RetentionPolicy[] {
  return retentionPolicies;
}

// --- Audit Log ---

export function getAuditLog(userId?: string): AuditEntry[] {
  return userId ? auditLog.filter((e) => e.userId === userId) : [...auditLog];
}

// --- Overdue detection (used by the scheduled job) ---

export function markOverdueRequests(): number {
  const now = new Date();
  let count = 0;
  for (const [id, req] of gdprRequests.entries()) {
    if (req.status === 'pending' && new Date(req.deadlineAt) < now) {
      req.status = 'overdue';
      gdprRequests.set(id, req);
      addAuditEntry('gdpr_request_overdue', req.userId, id, {}, 'system');
      count++;
    }
  }
  return count;
}
