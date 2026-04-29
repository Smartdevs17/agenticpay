import { randomUUID } from 'crypto';
import { queueEmail, EmailJobData } from './queue-producers.js';

export type OnboardingStatus = 'draft' | 'in_progress' | 'under_review' | 'approved' | 'rejected' | 'completed';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed';

export type TaskType = 'document_upload' | 'form_submission' | 'verification' | 'compliance_check';

export type DocumentType = 'business_license' | 'tax_id' | 'bank_statement' | 'identity_proof' | 'address_proof';

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
  progress: number; // 0-100
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

// Default onboarding tasks
const DEFAULT_TASKS: Omit<OnboardingTask, 'status'>[] = [
  {
    id: 'business_info',
    title: 'Business Information',
    description: 'Provide basic business details and contact information',
    type: 'form_submission',
    required: true,
    order: 1,
  },
  {
    id: 'business_license',
    title: 'Business License',
    description: 'Upload your business license or registration document',
    type: 'document_upload',
    required: true,
    order: 2,
  },
  {
    id: 'tax_id',
    title: 'Tax Identification',
    description: 'Upload your tax ID or EIN documentation',
    type: 'document_upload',
    required: true,
    order: 3,
  },
  {
    id: 'bank_verification',
    title: 'Bank Account Verification',
    description: 'Upload bank statement for account verification',
    type: 'document_upload',
    required: true,
    order: 4,
  },
  {
    id: 'identity_verification',
    title: 'Identity Verification',
    description: 'Upload government-issued ID for identity verification',
    type: 'document_upload',
    required: true,
    order: 5,
  },
  {
    id: 'address_proof',
    title: 'Address Proof',
    description: 'Upload utility bill or other proof of business address',
    type: 'document_upload',
    required: false,
    order: 6,
  },
  {
    id: 'compliance_check',
    title: 'Compliance Review',
    description: 'Automated compliance and risk assessment',
    type: 'compliance_check',
    required: true,
    order: 7,
  },
];

// In-memory storage (replace with database in production)
const onboardings = new Map<string, MerchantOnboarding>();

export class OnboardingService {
  static async createOnboarding(request: CreateOnboardingRequest): Promise<MerchantOnboarding> {
    const id = `onb_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const tasks: OnboardingTask[] = DEFAULT_TASKS.map(task => ({
      ...task,
      status: 'pending' as TaskStatus,
    }));

    const onboarding: MerchantOnboarding = {
      id,
      merchantId: request.merchantId,
      businessName: request.businessName,
      businessType: request.businessType,
      contactEmail: request.contactEmail,
      contactPhone: request.contactPhone,
      website: request.website,
      status: 'draft',
      progress: 0,
      tasks,
      createdAt: now,
      updatedAt: now,
    };

    onboardings.set(id, onboarding);
    return onboarding;
  }

  static async getOnboarding(id: string): Promise<MerchantOnboarding | null> {
    return onboardings.get(id) || null;
  }

  static async getOnboardingByMerchant(merchantId: string): Promise<MerchantOnboarding | null> {
    for (const onboarding of onboardings.values()) {
      if (onboarding.merchantId === merchantId) {
        return onboarding;
      }
    }
    return null;
  }

  static async updateTask(onboardingId: string, request: UpdateTaskRequest): Promise<MerchantOnboarding> {
    const onboarding = onboardings.get(onboardingId);
    if (!onboarding) {
      throw new Error('Onboarding not found');
    }

    const taskIndex = onboarding.tasks.findIndex(task => task.id === request.taskId);
    if (taskIndex === -1) {
      throw new Error('Task not found');
    }

    const task = onboarding.tasks[taskIndex];
    const now = new Date().toISOString();

    // Update task
    task.status = request.status;
    task.data = request.data || task.data;
    task.notes = request.notes || task.notes;

    // Set timestamps based on status
    if (request.status === 'completed') {
      task.completedAt = now;
      delete task.skippedAt;
      delete task.failedAt;
    } else if (request.status === 'skipped') {
      task.skippedAt = now;
      delete task.completedAt;
      delete task.failedAt;
    } else if (request.status === 'failed') {
      task.failedAt = now;
      delete task.completedAt;
      delete task.skippedAt;
    }

    // Update onboarding status and progress
    onboarding.updatedAt = now;
    onboarding.progress = this.calculateProgress(onboarding.tasks);
    onboarding.status = this.calculateStatus(onboarding);

    onboardings.set(onboardingId, onboarding);
    return onboarding;
  }

  static async submitDocument(onboardingId: string, request: SubmitDocumentRequest): Promise<MerchantOnboarding> {
    const onboarding = onboardings.get(onboardingId);
    if (!onboarding) {
      throw new Error('Onboarding not found');
    }

    const task = onboarding.tasks.find(task => task.id === request.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    if (task.type !== 'document_upload') {
      throw new Error('Task is not a document upload task');
    }

    // In a real implementation, this would save the file to storage
    const documentData = {
      documentType: request.documentType,
      fileName: request.fileName,
      fileSize: request.fileSize,
      mimeType: request.mimeType,
      uploadedAt: new Date().toISOString(),
      // fileData would be stored separately
    };

    return this.updateTask(onboardingId, {
      taskId: request.taskId,
      status: 'completed',
      data: { ...task.data, document: documentData },
    });
  }

  static async skipTask(onboardingId: string, request: SkipTaskRequest): Promise<MerchantOnboarding> {
    const onboarding = onboardings.get(onboardingId);
    if (!onboarding) {
      throw new Error('Onboarding not found');
    }

    const task = onboarding.tasks.find(task => task.id === request.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    if (task.required) {
      throw new Error('Required tasks cannot be skipped');
    }

    return this.updateTask(onboardingId, {
      taskId: request.taskId,
      status: 'skipped',
      notes: request.reason,
    });
  }

  static async submitForReview(onboardingId: string): Promise<MerchantOnboarding> {
    const onboarding = onboardings.get(onboardingId);
    if (!onboarding) {
      throw new Error('Onboarding not found');
    }

    if (onboarding.status !== 'in_progress') {
      throw new Error('Onboarding must be in progress to submit for review');
    }

    const now = new Date().toISOString();
    onboarding.status = 'under_review';
    onboarding.submittedAt = now;
    onboarding.updatedAt = now;

    onboardings.set(onboardingId, onboarding);

    // Send email notification to merchant
    await this.sendOnboardingSubmittedEmail(onboarding);

    return onboarding;
  }

  static async adminReview(request: AdminReviewRequest): Promise<MerchantOnboarding> {
    const onboarding = onboardings.get(request.onboardingId);
    if (!onboarding) {
      throw new Error('Onboarding not found');
    }

    if (onboarding.status !== 'under_review') {
      throw new Error('Onboarding must be under review');
    }

    const now = new Date().toISOString();
    onboarding.updatedAt = now;
    onboarding.reviewerId = request.reviewerId;
    onboarding.reviewNotes = request.reviewNotes;

    if (request.status === 'approved') {
      onboarding.status = 'approved';
      onboarding.approvedAt = now;
    } else if (request.status === 'rejected') {
      onboarding.status = 'rejected';
      onboarding.rejectedAt = now;
    } else if (request.status === 'needs_revision') {
      onboarding.status = 'in_progress';
      delete onboarding.submittedAt;
    }

    if (request.status === 'approved') {
      onboarding.status = 'approved';
      onboarding.approvedAt = now;
    } else if (request.status === 'rejected') {
      onboarding.status = 'rejected';
      onboarding.rejectedAt = now;
    } else if (request.status === 'needs_revision') {
      onboarding.status = 'in_progress';
      delete onboarding.submittedAt;
    }

    onboardings.set(request.onboardingId, onboarding);

    // Send email notification based on review status
    if (request.status === 'approved') {
      await this.sendOnboardingApprovedEmail(onboarding);
    } else if (request.status === 'rejected') {
      await this.sendOnboardingRejectedEmail(onboarding, request.reviewNotes);
    } else if (request.status === 'needs_revision') {
      await this.sendOnboardingRevisionEmail(onboarding, request.reviewNotes);
    }

    return onboarding;
  }

  static async getAllOnboardings(status?: OnboardingStatus): Promise<MerchantOnboarding[]> {
    const all = Array.from(onboardings.values());
    return status ? all.filter(o => o.status === status) : all;
  }

  // Email notification methods
  private static async sendOnboardingSubmittedEmail(onboarding: MerchantOnboarding): Promise<void> {
    const emailData: EmailJobData = {
      to: onboarding.contactEmail,
      subject: `Onboarding Submitted for Review - ${onboarding.businessName}`,
      body: `
Dear ${onboarding.businessName} Team,

Your merchant onboarding application has been successfully submitted for review.

Application Details:
- Business Name: ${onboarding.businessName}
- Submission Date: ${new Date().toLocaleDateString()}
- Progress: ${onboarding.progress}%

Our team will review your application and get back to you within 2-3 business days.

You can check your application status at any time by logging into your AgenticPay dashboard.

Best regards,
The AgenticPay Team
      `.trim(),
      html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #2563eb;">Onboarding Submitted for Review</h2>
  <p>Dear ${onboarding.businessName} Team,</p>
  <p>Your merchant onboarding application has been successfully submitted for review.</p>

  <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
    <h3 style="margin-top: 0; color: #374151;">Application Details:</h3>
    <ul style="color: #4b5563;">
      <li><strong>Business Name:</strong> ${onboarding.businessName}</li>
      <li><strong>Submission Date:</strong> ${new Date().toLocaleDateString()}</li>
      <li><strong>Progress:</strong> ${onboarding.progress}%</li>
    </ul>
  </div>

  <p>Our team will review your application and get back to you within 2-3 business days.</p>
  <p>You can check your application status at any time by logging into your AgenticPay dashboard.</p>

  <p style="margin-top: 30px;">Best regards,<br>The AgenticPay Team</p>
</div>
      `,
    };

    await queueEmail(emailData);
  }

  private static async sendOnboardingApprovedEmail(onboarding: MerchantOnboarding): Promise<void> {
    const emailData: EmailJobData = {
      to: onboarding.contactEmail,
      subject: `🎉 Onboarding Approved - Welcome to AgenticPay!`,
      body: `
Congratulations ${onboarding.businessName}!

Your merchant onboarding application has been approved. You can now start using AgenticPay to accept payments and manage your business transactions.

Next Steps:
1. Log into your AgenticPay dashboard
2. Complete your payment method setup
3. Start creating projects and accepting payments

Welcome to the AgenticPay community!

Best regards,
The AgenticPay Team
      `.trim(),
      html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #16a34a; font-size: 28px;">🎉 Congratulations!</h1>
  </div>

  <h2 style="color: #2563eb;">Onboarding Approved - Welcome to AgenticPay!</h2>
  <p>Dear ${onboarding.businessName} Team,</p>

  <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 20px; border-radius: 8px; margin: 20px 0;">
    <p style="color: #166534; font-weight: bold;">
      Your merchant onboarding application has been approved!
    </p>
  </div>

  <h3 style="color: #374151;">Next Steps:</h3>
  <ol style="color: #4b5563;">
    <li>Log into your AgenticPay dashboard</li>
    <li>Complete your payment method setup</li>
    <li>Start creating projects and accepting payments</li>
  </ol>

  <p style="margin-top: 30px; font-weight: bold;">Welcome to the AgenticPay community!</p>
  <p>Best regards,<br>The AgenticPay Team</p>
</div>
      `,
    };

    await queueEmail(emailData);
  }

  private static async sendOnboardingRejectedEmail(onboarding: MerchantOnboarding, reviewNotes?: string): Promise<void> {
    const emailData: EmailJobData = {
      to: onboarding.contactEmail,
      subject: `Onboarding Application Update - ${onboarding.businessName}`,
      body: `
Dear ${onboarding.businessName} Team,

We have reviewed your merchant onboarding application and unfortunately it has been rejected at this time.

${reviewNotes ? `Review Notes: ${reviewNotes}` : ''}

You can:
1. Address the issues mentioned in the review notes
2. Re-submit your application for review
3. Contact our support team for assistance

We appreciate your interest in AgenticPay and encourage you to reapply once you've addressed the requirements.

Best regards,
The AgenticPay Team
      `.trim(),
      html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #dc2626;">Onboarding Application Update</h2>
  <p>Dear ${onboarding.businessName} Team,</p>

  <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 20px; border-radius: 8px; margin: 20px 0;">
    <p style="color: #991b1b;">
      We have reviewed your merchant onboarding application and unfortunately it has been rejected at this time.
    </p>
  </div>

  ${reviewNotes ? `
  <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
    <h3 style="margin-top: 0; color: #374151;">Review Notes:</h3>
    <p style="color: #4b5563;">${reviewNotes}</p>
  </div>
  ` : ''}

  <h3 style="color: #374151;">What you can do next:</h3>
  <ul style="color: #4b5563;">
    <li>Address the issues mentioned in the review notes</li>
    <li>Re-submit your application for review</li>
    <li>Contact our support team for assistance</li>
  </ul>

  <p style="margin-top: 30px;">We appreciate your interest in AgenticPay and encourage you to reapply once you've addressed the requirements.</p>
  <p>Best regards,<br>The AgenticPay Team</p>
</div>
      `,
    };

    await queueEmail(emailData);
  }

  private static async sendOnboardingRevisionEmail(onboarding: MerchantOnboarding, reviewNotes?: string): Promise<void> {
    const emailData: EmailJobData = {
      to: onboarding.contactEmail,
      subject: `Onboarding Revision Required - ${onboarding.businessName}`,
      body: `
Dear ${onboarding.businessName} Team,

Your merchant onboarding application requires some revisions before it can be approved.

${reviewNotes ? `Review Notes: ${reviewNotes}` : ''}

Please log into your AgenticPay dashboard to make the necessary changes and resubmit your application.

Best regards,
The AgenticPay Team
      `.trim(),
      html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #d97706;">Onboarding Revision Required</h2>
  <p>Dear ${onboarding.businessName} Team,</p>

  <div style="background: #fffbeb; border: 1px solid #fde68a; padding: 20px; border-radius: 8px; margin: 20px 0;">
    <p style="color: #92400e;">
      Your merchant onboarding application requires some revisions before it can be approved.
    </p>
  </div>

  ${reviewNotes ? `
  <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
    <h3 style="margin-top: 0; color: #374151;">Review Notes:</h3>
    <p style="color: #4b5563;">${reviewNotes}</p>
  </div>
  ` : ''}

  <p>Please log into your AgenticPay dashboard to make the necessary changes and resubmit your application.</p>

  <p style="margin-top: 30px;">Best regards,<br>The AgenticPay Team</p>
</div>
      `,
    };

    await queueEmail(emailData);
  }

  private static calculateProgress(tasks: OnboardingTask[]): number {
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(task => task.status === 'completed').length;
    const skippedTasks = tasks.filter(task => task.status === 'skipped').length;

    // Skipped tasks count as completed for progress calculation
    const effectiveCompleted = completedTasks + skippedTasks;
    return Math.round((effectiveCompleted / totalTasks) * 100);
  }

  private static calculateStatus(onboarding: MerchantOnboarding): OnboardingStatus {
    const tasks = onboarding.tasks;
    const requiredTasks = tasks.filter(task => task.required);
    const allRequiredCompleted = requiredTasks.every(task =>
      task.status === 'completed' || task.status === 'skipped'
    );

    if (onboarding.status === 'approved') return 'approved';
    if (onboarding.status === 'rejected') return 'rejected';
    if (onboarding.status === 'under_review') return 'under_review';
    if (onboarding.status === 'completed') return 'completed';

    if (allRequiredCompleted && onboarding.progress === 100) {
      return 'completed';
    }

    if (tasks.some(task => task.status === 'in_progress' || task.status === 'completed')) {
      return 'in_progress';
    }

    return 'draft';
  }
}