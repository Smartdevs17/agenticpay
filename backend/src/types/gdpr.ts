export type GdprRequestType = 'erasure' | 'portability' | 'notification' | 'consent' | 'restriction';

export type GdprRequestStatus = 'pending' | 'processing' | 'completed' | 'rejected' | 'overdue';

export type ConsentPurpose =
  | 'analytics'
  | 'marketing'
  | 'payment_processing'
  | 'service_delivery'
  | 'third_party_sharing';

export type ConsentRecord = {
  userId: string;
  purpose: ConsentPurpose;
  granted: boolean;
  grantedAt: string | null;
  revokedAt: string | null;
  ipAddress: string;
  userAgent: string;
};

export type GdprRequest = {
  id: string;
  userId: string;
  type: GdprRequestType;
  status: GdprRequestStatus;
  createdAt: string;
  deadlineAt: string; // 30-day deadline
  processedAt: string | null;
  notes: string | null;
  requestedBy: string; // user or regulatory body
};

export type ThirdPartyProcessor = {
  id: string;
  name: string;
  purpose: string;
  dataCategories: string[];
  contractDate: string;
  dpaSignedAt: string | null; // Data Processing Agreement
  contactEmail: string;
  privacyPolicyUrl: string;
};

export type AuditEntry = {
  id: string;
  timestamp: string;
  action: string;
  userId: string | null;
  requestId: string | null;
  details: Record<string, unknown>;
  performedBy: string;
};

export type RetentionPolicy = {
  dataCategory: string;
  retentionDays: number;
  legalBasis: string;
  autoDelete: boolean;
};

export type UserDataExport = {
  exportedAt: string;
  userId: string;
  profile: Record<string, unknown>;
  consents: ConsentRecord[];
  gdprRequests: GdprRequest[];
  auditTrail: AuditEntry[];
};
