// ─── Common primitives ────────────────────────────────────────────────────────

export type ISO8601 = string;
export type UUID = string;
export type CurrencyCode = string; // e.g. "USD", "USDC", "XLM"

// ─── Domain: Payments ─────────────────────────────────────────────────────────

export type PaymentStatus = 'pending' | 'executed' | 'failed' | 'cancelled';

export type PaymentTriggerType = 'immediate' | 'scheduled' | 'conditional';

export interface PaymentTrigger {
  type: PaymentTriggerType;
  executeAt?: ISO8601;
  condition?: string;
}

export interface Payment {
  id: UUID;
  from: string;
  to: string;
  amount: number;
  asset: CurrencyCode;
  status: PaymentStatus;
  trigger: PaymentTrigger;
  createdAt: ISO8601;
  updatedAt: ISO8601;
}

// ─── Domain: Projects ─────────────────────────────────────────────────────────

export type ProjectStatus = 'active' | 'completed' | 'archived' | 'disputed' | 'abandoned';

export type MilestoneStatus =
  | 'pending'
  | 'submitted'
  | 'approved'
  | 'released'
  | 'disputed';

export interface Milestone {
  id: UUID;
  title: string;
  deliverable: string;
  amount: number;
  dueDate: ISO8601;
  status: MilestoneStatus;
  submittedAt: ISO8601 | null;
  approvedAt: ISO8601 | null;
  submissionUrl: string | null;
  submissionNotes: string | null;
  disputeReason: string | null;
  createdAt: ISO8601;
  updatedAt: ISO8601;
}

export interface Project {
  id: UUID;
  name: string;
  clientId: UUID;
  ownerId: UUID;
  budget: number;
  spentBudget: number;
  currency: CurrencyCode;
  startDate: ISO8601;
  endDate: ISO8601 | null;
  description?: string;
  status: ProjectStatus;
  archivedAt: ISO8601 | null;
  createdAt: ISO8601;
  updatedAt: ISO8601;
  scopeChangeCount: number;
}

// ─── Domain: Disputes ─────────────────────────────────────────────────────────

export type DisputeStatus =
  | 'pending'
  | 'awaiting_response'
  | 'under_review'
  | 'resolved'
  | 'escalated'
  | 'dismissed';

export type DisputeReason =
  | 'service_not_delivered'
  | 'partial_delivery'
  | 'quality_issue'
  | 'unauthorized_charge'
  | 'duplicate_charge'
  | 'other';

export type ResolutionOutcome =
  | 'full_refund'
  | 'partial_refund'
  | 'release_to_payee'
  | 'dismissed'
  | 'pending';

export interface Dispute {
  id: UUID;
  projectId: UUID;
  raisedBy: UUID;
  reason: DisputeReason;
  status: DisputeStatus;
  outcome: ResolutionOutcome | null;
  createdAt: ISO8601;
  updatedAt: ISO8601;
}

// ─── Domain: Users / Auth ────────────────────────────────────────────────────

export interface User {
  id: UUID;
  email: string;
  displayName?: string;
  role: UserRole;
  createdAt: ISO8601;
  updatedAt: ISO8601;
}

export type UserRole = 'client' | 'freelancer' | 'admin';

// ─── Domain: Invoices ─────────────────────────────────────────────────────────

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';

export interface Invoice {
  id: UUID;
  projectId: UUID;
  clientId: UUID;
  freelancerId: UUID;
  amount: number;
  currency: CurrencyCode;
  status: InvoiceStatus;
  dueDate: ISO8601;
  issuedAt: ISO8601;
  paidAt: ISO8601 | null;
}

// ─── Domain: Receipts ────────────────────────────────────────────────────────

export interface Receipt {
  tokenId: string;
  paymentId: UUID;
  sender: string;
  recipient: string;
  amount: number;
  asset: CurrencyCode;
  mintedAt: ISO8601;
}

// ─── Domain: Refunds ─────────────────────────────────────────────────────────

export type RefundStatus = 'requested' | 'approved' | 'rejected' | 'processed';

export interface Refund {
  id: UUID;
  paymentId: UUID;
  amount: number;
  currency: CurrencyCode;
  status: RefundStatus;
  reason: string;
  requestedAt: ISO8601;
  resolvedAt: ISO8601 | null;
}

// ─── Domain: Splits ──────────────────────────────────────────────────────────

export interface SplitRecipient {
  address: string;
  basisPoints: number; // out of 10_000
}

export interface Split {
  id: UUID;
  paymentId: UUID;
  recipients: SplitRecipient[];
  status: 'created' | 'executed';
  createdAt: ISO8601;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// ─── Error envelope ──────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

// ─── Result / Option primitives ──────────────────────────────────────────────

export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export type Option<T> = T | null | undefined;

export interface AppError {
  code: string;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export type ValidationAppError = AppError & { code: 'VALIDATION_ERROR'; statusCode: 400 };
export type NotFoundAppError = AppError & { code: 'NOT_FOUND'; statusCode: 404 };
export type ForbiddenAppError = AppError & { code: 'FORBIDDEN'; statusCode: 403 };
export type ConflictAppError = AppError & { code: 'CONFLICT'; statusCode: 409 };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E extends AppError>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}
