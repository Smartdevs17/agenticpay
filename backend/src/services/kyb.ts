import { randomUUID } from 'node:crypto';

export type KYBStatus =
  | 'pending'
  | 'documents_submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'requires_more_info'
  | 'expired';

export interface UBO {
  name: string;
  ownershipPercentage: number;
  nationality: string;
  dateOfBirth: string;
  documentType: 'passport' | 'national_id' | 'drivers_license';
  documentNumber: string;
}

export interface KYBDocument {
  type: string;
  url: string;
  name: string;
}

export interface KYBRecord {
  id: string;
  businessId: string;
  businessName: string;
  registrationNumber: string;
  registrationCountry: string;
  businessType: string;
  incorporationDate: string;
  ubos: UBO[];
  documents: KYBDocument[];
  website?: string;
  contactEmail: string;
  status: KYBStatus;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  reviewerNotes?: string;
  requestedDocuments?: string[];
  submittedAt: string;
  updatedAt: string;
  expiresAt?: string;
  renewalHistory: Array<{ renewedAt: string; notes?: string }>;
}

// In-memory store (replace with DB in production)
const kybStore = new Map<string, KYBRecord>();

function computeRiskScore(record: Omit<KYBRecord, 'id' | 'riskScore' | 'riskLevel' | 'status' | 'submittedAt' | 'updatedAt' | 'renewalHistory'>): number {
  let score = 100;

  // High-risk countries (simplified list)
  const highRiskCountries = ['AF', 'KP', 'IR', 'SY', 'YE'];
  if (highRiskCountries.includes(record.registrationCountry.toUpperCase())) score -= 40;

  // UBO concentration risk
  const maxOwnership = Math.max(...record.ubos.map((u) => u.ownershipPercentage));
  if (maxOwnership > 75) score -= 10;

  // Complex structure (many UBOs)
  if (record.ubos.length > 5) score -= 15;

  // Missing website
  if (!record.website) score -= 5;

  // Document count
  if (record.documents.length < 2) score -= 10;

  return Math.max(0, Math.min(100, score));
}

function riskLevel(score: number): 'low' | 'medium' | 'high' {
  if (score >= 70) return 'low';
  if (score >= 40) return 'medium';
  return 'high';
}

export function submitKYB(data: Omit<KYBRecord, 'id' | 'riskScore' | 'riskLevel' | 'status' | 'submittedAt' | 'updatedAt' | 'renewalHistory' | 'reviewerNotes' | 'requestedDocuments' | 'expiresAt'>): KYBRecord {
  const score = computeRiskScore(data);
  const now = new Date().toISOString();

  const record: KYBRecord = {
    ...data,
    id: `kyb_${randomUUID()}`,
    status: 'documents_submitted',
    riskScore: score,
    riskLevel: riskLevel(score),
    submittedAt: now,
    updatedAt: now,
    renewalHistory: [],
  };

  kybStore.set(record.id, record);
  return record;
}

export function getKYB(id: string): KYBRecord | undefined {
  return kybStore.get(id);
}

export function getKYBByBusinessId(businessId: string): KYBRecord | undefined {
  for (const record of kybStore.values()) {
    if (record.businessId === businessId) return record;
  }
  return undefined;
}

export function listKYBForReview(): KYBRecord[] {
  return Array.from(kybStore.values()).filter(
    (r) => r.status === 'documents_submitted' || r.status === 'under_review'
  );
}

export function updateKYBStatus(id: string, status: KYBStatus, notes?: string, requestedDocs?: string[]): KYBRecord | undefined {
  const record = kybStore.get(id);
  if (!record) return undefined;

  const updated: KYBRecord = {
    ...record,
    status,
    updatedAt: new Date().toISOString(),
    ...(notes !== undefined ? { reviewerNotes: notes } : {}),
    ...(requestedDocs !== undefined ? { requestedDocuments: requestedDocs } : {}),
    ...(status === 'approved'
      ? { expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() }
      : {}),
  };

  kybStore.set(id, updated);
  return updated;
}

export function renewKYB(id: string, documents: KYBDocument[], notes?: string): KYBRecord | undefined {
  const record = kybStore.get(id);
  if (!record) return undefined;

  const now = new Date().toISOString();
  const updated: KYBRecord = {
    ...record,
    documents: [...record.documents, ...documents],
    status: 'documents_submitted',
    updatedAt: now,
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    renewalHistory: [...record.renewalHistory, { renewedAt: now, notes }],
  };

  kybStore.set(id, updated);
  return updated;
}

export function getKYBAnalytics() {
  const all = Array.from(kybStore.values());
  const byStatus = all.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const byRisk = all.reduce<Record<string, number>>((acc, r) => {
    acc[r.riskLevel] = (acc[r.riskLevel] ?? 0) + 1;
    return acc;
  }, {});
  const avgRiskScore = all.length ? all.reduce((s, r) => s + r.riskScore, 0) / all.length : 0;

  return {
    total: all.length,
    byStatus,
    byRisk,
    avgRiskScore: Math.round(avgRiskScore),
    pendingReview: (byStatus['documents_submitted'] ?? 0) + (byStatus['under_review'] ?? 0),
  };
}
