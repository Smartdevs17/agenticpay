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
};
