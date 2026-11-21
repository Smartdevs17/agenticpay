import type {
  Payment,
  PaymentStatus,
  PaymentTrigger,
  Project,
  ProjectStatus,
  Milestone,
  MilestoneStatus,
  Dispute,
  DisputeReason,
  Invoice,
  Refund,
  Split,
  SplitRecipient,
  PaginationParams,
  PaginatedResult,
  ApiError,
  CurrencyCode,
  UUID,
  ISO8601,
} from '@agenticpay/types';

// Re-export domain types so consumers only need one package
export type {
  Payment,
  PaymentStatus,
  PaymentTrigger,
  Project,
  ProjectStatus,
  Milestone,
  MilestoneStatus,
  Dispute,
  DisputeReason,
  Invoice,
  Refund,
  Split,
  SplitRecipient,
  PaginationParams,
  PaginatedResult,
  ApiError,
  CurrencyCode,
  UUID,
  ISO8601,
};

// ─── Payments API ─────────────────────────────────────────────────────────────

export interface CreatePaymentRequest {
  from: string;
  to: string;
  amount: number;
  asset: CurrencyCode;
  trigger: PaymentTrigger;
  idempotencyKey?: string;
}

export interface CreatePaymentResponse {
  data: Payment;
}

export interface GetPaymentResponse {
  data: Payment;
}

export interface ListPaymentsRequest extends PaginationParams {
  status?: PaymentStatus;
  from?: string;
  to?: string;
}

export interface ListPaymentsResponse {
  data: PaginatedResult<Payment>;
}

// ─── Projects API ─────────────────────────────────────────────────────────────

export interface CreateProjectRequest {
  name: string;
  clientId: UUID;
  budget: number;
  currency: CurrencyCode;
  startDate: ISO8601;
  endDate?: ISO8601;
  description?: string;
}

export interface CreateProjectResponse {
  data: Project;
}

export interface UpdateProjectStatusRequest {
  status: ProjectStatus;
}

export interface AddMilestoneRequest {
  title: string;
  deliverable: string;
  amount: number;
  dueDate: ISO8601;
}

export interface AddMilestoneResponse {
  data: Milestone;
}

export interface UpdateMilestoneStatusRequest {
  status: MilestoneStatus;
  submissionUrl?: string;
  submissionNotes?: string;
  disputeReason?: string;
}

// ─── Disputes API ─────────────────────────────────────────────────────────────

export interface RaiseDisputeRequest {
  projectId: UUID;
  reason: DisputeReason;
  description?: string;
}

export interface RaiseDisputeResponse {
  data: Dispute;
}

export interface ResolveDisputeRequest {
  outcome: 'full_refund' | 'partial_refund' | 'release_to_payee' | 'dismissed';
  notes?: string;
}

// ─── Invoices API ─────────────────────────────────────────────────────────────

export interface CreateInvoiceRequest {
  projectId: UUID;
  amount: number;
  currency: CurrencyCode;
  dueDate: ISO8601;
}

export interface CreateInvoiceResponse {
  data: Invoice;
}

// ─── Refunds API ──────────────────────────────────────────────────────────────

export interface RequestRefundRequest {
  paymentId: UUID;
  amount: number;
  reason: string;
}

export interface RequestRefundResponse {
  data: Refund;
}

// ─── Splits API ───────────────────────────────────────────────────────────────

export interface CreateSplitRequest {
  paymentId: UUID;
  recipients: SplitRecipient[];
}

export interface CreateSplitResponse {
  data: Split;
}

// ─── Auth API ─────────────────────────────────────────────────────────────────

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  accessToken: string;
  expiresIn: number;
}

// ─── Webhook events ───────────────────────────────────────────────────────────

export type WebhookEventType =
  | 'payment.created'
  | 'payment.executed'
  | 'payment.failed'
  | 'payment.cancelled'
  | 'project.created'
  | 'project.funded'
  | 'project.completed'
  | 'project.disputed'
  | 'invoice.generated'
  | 'refund.requested'
  | 'refund.approved';

export interface WebhookPayload<T = unknown> {
  id: UUID;
  type: WebhookEventType;
  createdAt: ISO8601;
  data: T;
}
