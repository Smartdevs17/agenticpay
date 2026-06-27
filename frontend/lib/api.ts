import { apiCall } from '@/lib/api/client';

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
}

export interface InvoiceRequest {
    projectId: string;
    workDescription: string;
    hoursWorked: number;
    hourlyRate: number;
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
  payload: any;
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

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  previousHash: string;
  hash: string;
  suspicious?: boolean;
}

export interface AuditEntriesResponse {
  entries: AuditLogEntry[];
  total: number;
}

export interface AuditVerifyResponse {
  valid: boolean;
  brokenAt?: string;
}

export interface BatchPaymentItem {
  recipient: string;
  amount: string;
  asset: string;
  memo?: string;
}

export interface BatchEstimate {
  totalPayments: number;
  totalAmount: string;
  byAsset: Record<string, string>;
  estimatedGasUnits: number;
  duplicateCount: number;
  invalidAddressCount: number;
  estimatedDurationMs: number;
}

export interface BatchRecord {
  id: string;
  label?: string;
  status: string;
  total: number;
  succeeded: number;
  failed: number;
  payments: BatchPaymentItem[];
  results: Array<{
    index: number;
    recipient: string;
    amount: string;
    asset: string;
    status: string;
    txHash?: string;
    error?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledBatch {
  id: string;
  label?: string;
  payments: BatchPaymentItem[];
  scheduledAt: string;
  executeAt: string;
  status: string;
  result?: BatchRecord;
  createdAt: string;
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
        return apiCall('/invoice/generate', {
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
        return apiCall(`/verification/${id}`, {
            method: 'GET',
        });
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
      submitForm: async (id: string, values: Record<string, unknown>) => apiCall(`/forms/${id}/submissions`, {
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
      retryEvent: async (eventId: string) => apiCall(`/webhooks/events/${eventId}/retry`, {
        method: 'POST',
      }),
      markEventProcessed: async (eventId: string) => apiCall(`/webhooks/events/${eventId}/process`, {
        method: 'POST',
      }),
    },

    audit: {
      listEntries: async (query?: { userId?: string; action?: string; resource?: string; limit?: number }) => {
        const params = new URLSearchParams();
        if (query?.userId) params.set('userId', query.userId);
        if (query?.action) params.set('action', query.action);
        if (query?.resource) params.set('resource', query.resource);
        if (query?.limit) params.set('limit', String(query.limit));
        return apiCall<AuditEntriesResponse>(`/audit/entries${params.size ? `?${params}` : ''}`, { method: 'GET' });
      },
      verify: async () => apiCall<AuditVerifyResponse>('/audit/verify', { method: 'GET' }),
      anchor: async () => apiCall('/audit/anchor', { method: 'POST' }),
      listAnchors: async () => apiCall<{ anchors: unknown[] }>('/audit/anchors', { method: 'GET' }),
      exportJsonUrl: '/api/v1/audit/export/json',
      exportCsvUrl: '/api/v1/audit/export/csv',
      streamExportUrl: (format: 'csv' | 'jsonl' = 'csv') => `/api/v1/exports/audit/stream?format=${format}`,
    },

    /**
     * Contract Pause Management API (Issue #513)
     */
    contractPause: {
      list: async (filters?: { status?: string; chain?: string }) => {
        const params = new URLSearchParams();
        if (filters?.status) params.set('status', filters.status);
        if (filters?.chain) params.set('chain', filters.chain);
        return apiCall<{ records: unknown[]; total: number }>(`/admin/contracts/pause${params.size ? `?${params}` : ''}`, { method: 'GET' });
      },
      get: async (pauseId: string) => apiCall(`/admin/contracts/pause/${pauseId}`, { method: 'GET' }),
      request: async (payload: { chain: string; contractAddress: string; pauseImplementation: string; requestedBy: string; threshold?: number; timeoutSeconds?: number }) =>
        apiCall('/admin/contracts/pause/request', { method: 'POST', body: JSON.stringify(payload) }),
      approve: async (pauseId: string, guardianAddress: string) =>
        apiCall(`/admin/contracts/pause/${pauseId}/approve`, { method: 'POST', body: JSON.stringify({ guardianAddress }) }),
      resolve: async (pauseId: string, resolvedBy: string) =>
        apiCall(`/admin/contracts/pause/${pauseId}/resolve`, { method: 'POST', body: JSON.stringify({ resolvedBy }) }),
      checkExpiry: async () => apiCall('/admin/contracts/pause/check-expiry', { method: 'POST' }),
      listGuardians: async () => apiCall<{ guardians: unknown[] }>('/admin/contracts/pause/guardians/list', { method: 'GET' }),
      addGuardian: async (address: string, chain: string) =>
        apiCall('/admin/contracts/pause/guardians', { method: 'POST', body: JSON.stringify({ address, chain }) }),
      removeGuardian: async (address: string) =>
        apiCall(`/admin/contracts/pause/guardians/${encodeURIComponent(address)}`, { method: 'DELETE' }),
    },

    /**
     * Streaming Export API (Issue #500)
     */
    exports: {
      getJobStatus: async (exportId: string) => apiCall<{ id: string; status: string; rowsProcessed: number; progress?: number }>(`/exports/${exportId}/status`, { method: 'GET' }),
      cancelExport: async (exportId: string) => apiCall(`/exports/${exportId}`, { method: 'DELETE' }),
      listJobs: async () => apiCall<{ jobs: unknown[]; activeCount: number }>('/exports/jobs/list', { method: 'GET' }),
      auditStreamUrl: (params?: { format?: string; startDate?: string; endDate?: string; limit?: string }) => {
        const query = new URLSearchParams();
        if (params?.format) query.set('format', params.format);
        if (params?.startDate) query.set('startDate', params.startDate);
        if (params?.endDate) query.set('endDate', params.endDate);
        if (params?.limit) query.set('limit', params.limit);
        return `/api/v1/exports/audit/stream${query.size ? `?${query}` : ''}`;
      },
      paymentsStreamUrl: (params?: { format?: string; from?: string; to?: string; limit?: string }) => {
        const query = new URLSearchParams();
        if (params?.format) query.set('format', params.format);
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        if (params?.limit) query.set('limit', params.limit);
        return `/api/v1/exports/payments/stream${query.size ? `?${query}` : ''}`;
      },
    },

    /**
     * Batch Payment API
     */
    batch: {
      parse: async (payload: { payments: BatchPaymentItem[] }) => apiCall(`/batch/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      parseCSV: async (csv: string) => apiCall(`/batch/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: csv,
      }),
      estimate: async (payload: { payments: BatchPaymentItem[] }) => apiCall<BatchEstimate>(`/batch/estimate`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      submit: async (payload: { payments: BatchPaymentItem[]; label?: string }) => apiCall<BatchRecord>(`/batch/submit`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      schedule: async (payload: { payments: BatchPaymentItem[]; executeAt: string; label?: string }) => apiCall<ScheduledBatch>(`/batch/schedule`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      list: async () => apiCall<{ batches: BatchRecord[] }>(`/batch`, { method: 'GET' }),
      get: async (id: string) => apiCall<BatchRecord>(`/batch/${id}`, { method: 'GET' }),
      getReport: async (id: string) => apiCall(`/batch/${id}/report`, { method: 'GET' }),
      listScheduled: async () => apiCall<{ batches: ScheduledBatch[] }>(`/batch/scheduled`, { method: 'GET' }),
      cancelScheduled: async (id: string) => apiCall<ScheduledBatch>(`/batch/scheduled/${id}`, { method: 'DELETE' }),
    },
};
