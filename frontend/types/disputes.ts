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
  hash: string;
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
  filedBy: string;
  respondentId: string;
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
  responseDeadline: string;
  escalationDeadline: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface CreateDisputeForm {
  paymentId: string;
  respondentId: string;
  reason: DisputeReason;
  amount: number;
  currency: string;
  description: string;
  projectId?: string;
  invoiceId?: string;
}
