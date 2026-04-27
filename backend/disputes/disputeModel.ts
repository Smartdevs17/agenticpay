export type DisputeStatus =
  | "pending"
  | "awaiting_response"
  | "under_review"
  | "resolved"
  | "escalated"
  | "dismissed";

export type DisputeReason =
  | "service_not_delivered"
  | "partial_delivery"
  | "quality_issue"
  | "unauthorized_charge"
  | "duplicate_charge"
  | "other";

export type ResolutionOutcome =
  | "full_refund"
  | "partial_refund"
  | "release_to_payee"
  | "dismissed"
  | "pending";

export interface Evidence {
  id: string;
  disputeId: string;
  submittedBy: string;
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  description: string;
  timestamp: string;
  hash: string; // SHA256 for tamper detection
}

export interface DisputeMessage {
  id: string;
  disputeId: string;
  senderId: string;
  senderRole: "payer" | "payee" | "arbitrator" | "system";
  content: string;
  timestamp: string;
}

export interface Dispute {
  id: string;
  paymentId: string;
  projectId?: string;
  invoiceId?: string;
  filedBy: string; // userId of payer
  respondentId: string; // userId of payee
  arbitratorId?: string;
  status: DisputeStatus;
  reason: DisputeReason;
  amount: number;
  currency: string;
  description: string;
  evidence: Evidence[];
  messages: DisputeMessage[];
  resolution: ResolutionOutcome;
  resolutionNote?: string;
  refundAmount?: number;
  responseDeadline: string; // ISO timestamp - respondent must reply by
  escalationDeadline: string; // ISO timestamp - auto-escalate if unresolved
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface CreateDisputeDto {
  paymentId: string;
  projectId?: string;
  invoiceId?: string;
  respondentId: string;
  reason: DisputeReason;
  amount: number;
  currency: string;
  description: string;
}

export interface RespondDisputeDto {
  disputeId: string;
  response: string;
}

export interface ResolveDisputeDto {
  disputeId: string;
  outcome: ResolutionOutcome;
  resolutionNote: string;
  refundAmount?: number;
}

export interface DisputeAnalytics {
  total: number;
  byStatus: Record<DisputeStatus, number>;
  byReason: Record<DisputeReason, number>;
  averageResolutionDays: number;
  totalRefunded: number;
  escalationRate: number;
}
