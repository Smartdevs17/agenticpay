export type ApiVersion = 'v1';

export type AgenticPayClientOptions = {
  baseUrl: string;
  apiKey?: string;
  apiVersion?: ApiVersion;
  timeoutMs?: number;
  retry?: {
    attempts: number;
    baseDelayMs: number;
    retryableStatusCodes?: number[];
  };
};

export type RequestContext = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
};

export type ResponseContext<T = unknown> = {
  status: number;
  headers: Headers;
  data: T;
};

export type RequestInterceptor = (
  context: RequestContext
) => Promise<RequestContext> | RequestContext;

export type ResponseInterceptor = <T>(
  context: ResponseContext<T>
) => Promise<ResponseContext<T>> | ResponseContext<T>;

export type VerificationRequest = {
  repositoryUrl: string;
  milestoneDescription: string;
  projectId: string;
};

export type InvoiceRequest = {
  projectId: string;
  workDescription: string;
  hoursWorked?: number;
  hourlyRate?: number;
};

export type SplitRecipient = {
  recipientId: string;
  walletAddress: string;
  percentage: number;
  minimumThreshold: number;
};

export type SplitConfigInput = {
  merchantId: string;
  platformFeePercentage: number;
  recipients: SplitRecipient[];
};

export type SplitExecutionInput = {
  splitId: string;
  paymentId: string;
  totalAmount: number;
  currency: string;
};

export type RefundPolicyInput = {
  merchantId: string;
  fullRefundWindowDays: number;
  autoApprovalThreshold: number;
  alwaysRefundUnderAmount: number;
  maxPartialRefundPercentage: number;
  requireReason: boolean;
};

export type RefundEvaluationInput = {
  merchantId: string;
  paymentId: string;
  paymentType: 'card' | 'crypto' | 'bank_transfer';
  amountPaid: number;
  requestedAmount: number;
  daysSincePayment: number;
  reason?: string;
  hasChargeback?: boolean;
  hasDispute?: boolean;
};
