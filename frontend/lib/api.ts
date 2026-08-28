import { apiCall } from '@/lib/api/client';

export interface CodeQualityMetrics {
  linesOfCode: number;
  testCoverage: number;
  cyclomaticComplexity: number;
  documentationCoverage: number;
  duplicateCodeRatio: number;
  maintainabilityIndex: number;
}

export interface PlagiarismResult {
  overallSimilarity: number;
  duplicateSegments: Array<{ source: string; similarity: number; lines: string }>;
  externalMatches: Array<{ repository: string; similarity: number; description: string }>;
}

export interface VerificationRequest {
    repositoryUrl: string;
    milestoneDescription: string;
    projectId: string;
}

export interface VerificationResponse {
    id: string;
    projectId: string;
    status: 'passed' | 'failed' | 'pending';
    score: number;
    summary: string;
    details: string[];
    verifiedAt: string;
    codeQuality?: CodeQualityMetrics;
    plagiarism?: PlagiarismResult;
}

export interface InvoiceRequest {
    projectId: string;
    workDescription: string;
    hoursWorked: number;
    hourlyRate: number;
}

export interface GeneratedInvoice {
    id: string;
    invoiceNumber: string;
    merchantId: string;
    projectId: string;
    subtotal: number;
    taxTotal: number;
    total: number;
    currency: string;
    status: string;
    summary: string;
    generatedAt: string;
}

export interface FormFieldOption {
  label: string;
  value: string;
}

export interface FormFieldDefinition {
  id: string;
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'file' | 'select';
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  accept?: string;
  pattern?: string;
  min?: number;
  max?: number;
  maxSizeBytes?: number;
  options?: FormFieldOption[];
  visibleIf?: {
    fieldName: string;
    value: string;
  };
}

export interface FormSchema {
  id: string;
  name: string;
  description?: string;
  fields: FormFieldDefinition[];
  analytics?: {
    views: number;
    submissions: number;
    completions: number;
    completionRate: number;
  };
}

export interface FormListResponse {
  forms: FormSchema[];
  total: number;
}

export interface FormCreateRequest {
  name: string;
  description?: string;
  fields: FormFieldDefinition[];
}

export interface FormSubmission {
  id: string;
  formId: string;
  submittedAt: string;
  values: Record<string, unknown>;
  success: boolean;
}

export interface FormSubmissionsResponse {
  submissions: FormSubmission[];
  total: number;
}

export interface FormDraft {
  id: string;
  formId: string;
  values: Record<string, unknown>;
  savedAt: string;
}

export interface FormDraftsResponse {
  drafts: FormDraft[];
  total: number;
}

export interface WebhookSecret {
  id: string;
  provider: 'stripe' | 'paypal' | 'github' | 'custom';
  isActive: boolean;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
}

export interface WebhookEvent {
  id: string;
  provider: 'stripe' | 'paypal' | 'github' | 'custom';
  eventType: string;
  payload: Record<string, unknown>;
  signature: string;
  timestamp: string;
  verified: boolean;
  processed: boolean;
  createdAt: string;
  processedAt?: string;
  error?: string;
  retryCount: number;
}

export interface WebhookSecretsResponse {
  secrets: WebhookSecret[];
  total: number;
}

export interface WebhookEventsResponse {
  events: WebhookEvent[];
  total: number;
}

export interface CreateWebhookSecretRequest {
  provider: 'stripe' | 'paypal' | 'github' | 'custom';
  secret: string;
  expiresAt?: string;
}

export interface RotateWebhookSecretRequest {
  newSecret: string;
  gracePeriodHours?: number;
}

export interface ApiKeySummary {
  keyId: string;
  description?: string;
}

export interface ApiKeyRotateResult extends ApiKeySummary {
  rotatedFrom: string;
  rawKey: string;
}

export interface ApiKeyCreateResult {
  data: ApiKeySummary;
  rawKey: string;
}

export interface ApiKeyUsagePoint {
  date: string;
  total: number;
  blocked: number;
}

export interface ApiKeyUsage {
  keyId: string;
  days: number;
  daily: ApiKeyUsagePoint[];
}

export interface MilestoneDependency {
  id: string;
  milestoneId: string;
  dependsOnMilestoneId: string;
}

export interface MilestoneGraphNode {
  id: string;
  title: string;
  status: string;
  dependsOn: string[];
}

export interface MilestoneGraph {
  projectId: string;
  nodes: MilestoneGraphNode[];
}

export type CheckoutPaymentMethod = 'crypto' | 'card' | 'wallet';

export interface CheckoutSession {
  id: string;
  merchantId: string;
  merchantName: string;
  amount: number;
  currency: string;
  description?: string;
  allowedMethods: CheckoutPaymentMethod[];
  selectedMethod?: CheckoutPaymentMethod;
  status: 'created' | 'payment_pending' | 'processing' | 'completed' | 'expired' | 'abandoned';
  customerEmail?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  lockedRate?: { rate: number; lockedAt: string; expiresAt: string; pair: string };
  transactionId?: string;
}

export interface ExchangeRates {
  rates: Record<string, number>;
  updatedAt: string;
}

export interface PaymentLinkDetails {
  slug: string;
  merchantName: string;
  amount: number;
  currency: string;
  status: string;
  description?: string;
}

export interface PaymentLinkCompletionResult {
  success: boolean;
  transactionId?: string;
}

export const api = {
    /**
     * AI Work Verification
     */
    verifyWork: async (data: VerificationRequest) => {
        return apiCall<VerificationResponse>('/verification/verify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });
    },

    /**
     * AI Invoice Generation
     */
    generateInvoice: async (data: InvoiceRequest) => {
        return apiCall<GeneratedInvoice>('/invoice/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });
    },

    /**
     * Get Verification Result
     */
    getVerification: async (id: string) => {
        return apiCall<VerificationResponse>(`/verification/${id}`, {
            method: 'GET',
        });
    },

    /**
     * List Verification Results
     */
    listVerifications: async (projectId?: string) => {
        const query = projectId ? `?projectId=${projectId}` : '';
        return apiCall<{ data: VerificationResponse[] }>(`/verification${query}`, {
            method: 'GET',
        });
    },

    /**
     * API Key Management
     */
    apiKeys: {
      list: async () => apiCall<{ data: ApiKeySummary[] }>('/api-keys', { method: 'GET' }),
      create: async (payload: { name: string; tier?: string; scopes?: string[]; expiresInDays?: number }) =>
        apiCall<ApiKeyCreateResult>('/api-keys', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      getUsage: async (windowMs?: number) =>
        apiCall<ApiKeyUsage>(`/api-keys/usage${windowMs ? `?window=${windowMs}` : ''}`, { method: 'GET' }),
      revoke: async (id: string) => apiCall<{ success: boolean; keyId: string; status: string }>(`/api-keys/${id}/revoke`, { method: 'POST' }),
      rotate: async (id: string) => apiCall<ApiKeyRotateResult>(`/api-keys/${id}/rotate`, { method: 'POST' }),
      delete: async (id: string) => apiCall<{ success: boolean }>(`/api-keys/${id}`, { method: 'DELETE' }),
    },

    /**
     * Milestone Dependencies
     */
    milestones: {
      getGraph: async (projectId: string) => apiCall<{ data: MilestoneGraph }>(`/milestones/${projectId}/graph`, { method: 'GET' }),
      getDependencies: async (projectId: string) => apiCall<{ data: MilestoneDependency[] }>(`/milestones/${projectId}/dependencies`, { method: 'GET' }),
      addDependency: async (projectId: string, payload: { milestoneId: string; dependsOnMilestoneId: string }) =>
        apiCall<MilestoneDependency>(`/milestones/${projectId}/dependencies`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      removeDependency: async (dependencyId: string) => apiCall<void>(`/milestones/dependencies/${dependencyId}`, { method: 'DELETE' }),
      getBlocked: async (projectId: string) => apiCall<{ data: string[] }>(`/milestones/${projectId}/blocked`, { method: 'GET' }),
    },

    /**
     * Forms API
     */
    forms: {
      listForms: async () => apiCall<FormListResponse>('/forms', { method: 'GET' }),
      getForm: async (id: string) => apiCall<FormSchema>(`/forms/${id}`, { method: 'GET' }),
      createForm: async (payload: FormCreateRequest) => apiCall<FormSchema>('/forms', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      updateForm: async (id: string, payload: FormCreateRequest) => apiCall<FormSchema>(`/forms/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
      deleteForm: async (id: string) => apiCall<void>(`/forms/${id}`, {
        method: 'DELETE',
      }),
      submitForm: async (id: string, values: Record<string, unknown>) => apiCall<FormSubmission>(`/forms/${id}/submissions`, {
        method: 'POST',
        body: JSON.stringify({ values }),
      }),
      getSubmissions: async (id: string) => apiCall<FormSubmissionsResponse>(`/forms/${id}/submissions`, {
        method: 'GET',
      }),
      saveDraft: async (id: string, values: Record<string, unknown>) => apiCall<FormDraft>(`/forms/${id}/drafts`, {
        method: 'POST',
        body: JSON.stringify({ values }),
      }),
      getDrafts: async (id: string) => apiCall<FormDraftsResponse>(`/forms/${id}/drafts`, {
        method: 'GET',
      }),
      deleteDraft: async (id: string, draftId: string) => apiCall<void>(`/forms/${id}/drafts/${draftId}`, {
        method: 'DELETE',
      }),
    },

    /**
     * Webhook Management API
     */
    webhooks: {
      // Secret management
      listSecrets: async () => apiCall<WebhookSecretsResponse>('/webhooks/secrets', { method: 'GET' }),
      createSecret: async (payload: CreateWebhookSecretRequest) => apiCall<WebhookSecret>('/webhooks/secrets', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      rotateSecret: async (provider: string, payload: RotateWebhookSecretRequest) => apiCall<WebhookSecret>(`/webhooks/secrets/${provider}/rotate`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      deleteSecret: async (secretId: string) => apiCall<void>(`/webhooks/secrets/${secretId}`, {
        method: 'DELETE',
      }),

      // Event management
      listEvents: async (limit?: number) => apiCall<WebhookEventsResponse>(`/webhooks/events${limit ? `?limit=${limit}` : ''}`, { method: 'GET' }),
      listQueuedEvents: async (limit?: number) => apiCall<WebhookEventsResponse>(`/webhooks/events/queued${limit ? `?limit=${limit}` : ''}`, { method: 'GET' }),
      retryEvent: async (eventId: string) => apiCall<WebhookEvent>(`/webhooks/events/${eventId}/retry`, {
        method: 'POST',
      }),
      markEventProcessed: async (eventId: string) => apiCall<WebhookEvent>(`/webhooks/events/${eventId}/process`, {
        method: 'POST',
      }),
    },

    /**
     * Hosted Checkout API
     */
    checkout: {
      createSession: async (payload: {
        merchantId: string;
        amount: number;
        currency: string;
        description?: string;
        allowedMethods?: CheckoutPaymentMethod[];
        customerEmail?: string;
      }) => apiCall<{ data: CheckoutSession }>('/checkout/sessions', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      getSession: async (id: string) => apiCall<{ data: CheckoutSession }>(`/checkout/sessions/${id}`, {
        method: 'GET',
      }),
      selectPaymentMethod: async (id: string, method: CheckoutPaymentMethod) => apiCall<{ data: CheckoutSession }>(`/checkout/sessions/${id}/payment-method`, {
        method: 'POST',
        body: JSON.stringify({ method }),
      }),
      lockRate: async (id: string) => apiCall<{ data: CheckoutSession }>(`/checkout/sessions/${id}/lock-rate`, {
        method: 'POST',
      }),
      processPayment: async (id: string, details: Record<string, unknown>) => apiCall<{ data: CheckoutSession }>(`/checkout/sessions/${id}/pay`, {
        method: 'POST',
        body: JSON.stringify(details),
      }),
      getReceiptUrl: (id: string) => `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/checkout/sessions/${id}/receipt`,
      getExchangeRates: async () => apiCall<{ data: ExchangeRates }>('/checkout/exchange-rates', {
        method: 'GET',
      }),
    },

    /**
     * Payment Links API
     */
    paymentLinks: {
      getLinkBySlug: async (slug: string, options?: { variant?: string; password?: string }) => {
        const queryParams = new URLSearchParams();
        if (options?.variant) queryParams.append('variant', options.variant);
        if (options?.password) queryParams.append('password', options.password);
        const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';
        return apiCall<PaymentLinkDetails>(`/payment-links/r/${slug}${queryString}`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
        });
      },
      completePayment: async (slug: string, payload: { source?: string; variant?: string; password?: string; amountPaid?: number }) => {
        return apiCall<PaymentLinkCompletionResult>(`/payment-links/r/${slug}/complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
      },
    },
};