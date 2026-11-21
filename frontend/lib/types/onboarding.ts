export type OnboardingStatus =
  | 'draft'
  | 'in_progress'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'completed';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed';

export type TaskType = 'document_upload' | 'form_submission' | 'verification' | 'compliance_check';

export type DocumentType =
  | 'business_license'
  | 'tax_id'
  | 'bank_statement'
  | 'identity_proof'
  | 'address_proof';

export interface OnboardingTask {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  required: boolean;
  order: number;
  status: TaskStatus;
  completedAt?: string;
  skippedAt?: string;
  failedAt?: string;
  data?: Record<string, any>;
  notes?: string;
}

export interface MerchantOnboarding {
  id: string;
  merchantId: string;
  businessName: string;
  businessType: string;
  contactEmail: string;
  contactPhone?: string;
  website?: string;
  status: OnboardingStatus;
  progress: number;
  tasks: OnboardingTask[];
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
  reviewNotes?: string;
  reviewerId?: string;
}

export interface CreateOnboardingRequest {
  merchantId: string;
  businessName: string;
  businessType: string;
  contactEmail: string;
  contactPhone?: string;
  website?: string;
}

export interface UpdateTaskRequest {
  taskId: string;
  status: TaskStatus;
  data?: Record<string, any>;
  notes?: string;
}

export interface SubmitDocumentRequest {
  taskId: string;
  documentType: DocumentType;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileData?: string;
}

export interface SkipTaskRequest {
  taskId: string;
  reason: string;
}

export interface AdminReviewRequest {
  onboardingId: string;
  status: 'approved' | 'rejected' | 'needs_revision';
  reviewNotes?: string;
  reviewerId: string;
}