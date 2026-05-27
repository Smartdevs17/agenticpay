import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';

export const formFieldTypeSchema = z.enum(['text', 'number', 'date', 'file', 'select']);

export const formOptionSchema = z.object({
  label: z.string().min(1, 'Option label is required'),
  value: z.string().min(1, 'Option value is required'),
});

export const formFieldVisibilitySchema = z.object({
  fieldName: z.string().min(1, 'Dependency field is required'),
  value: z.string().min(1, 'Dependency value is required'),
});

export const formFieldSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, 'Field name is required'),
  label: z.string().min(1, 'Field label is required'),
  type: formFieldTypeSchema,
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  accept: z.string().optional(),
  pattern: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  maxSizeBytes: z.number().positive().optional(),
  options: z.array(formOptionSchema).optional(),
  visibleIf: formFieldVisibilitySchema.optional(),
});

export const formDefinitionSchema = z.object({
  name: z.string().min(1, 'Form name is required'),
  description: z.string().optional(),
  fields: z.array(formFieldSchema).min(1, 'At least one field is required'),
});

export const formSubmissionSchema = z.object({
  values: z.record(z.any()),
});

export const formDraftSchema = z.object({
  values: z.record(z.any()),
});

export type FormField = z.infer<typeof formFieldSchema>;
export type FormDefinitionInput = z.infer<typeof formDefinitionSchema>;
export type FormDefinition = FormDefinitionInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  analytics: FormAnalytics;
};

export type FileFieldValue = {
  filename: string;
  mimeType: string;
  size: number;
  content: string;
};

export type FormSubmission = {
  id: string;
  formId: string;
  submittedAt: string;
  values: Record<string, unknown>;
  success: boolean;
};

export type FormDraft = {
  id: string;
  formId: string;
  values: Record<string, unknown>;
  savedAt: string;
};

export type FormAnalytics = {
  views: number;
  submissions: number;
  completions: number;
  completionRate: number;
};

const formAnalyticsDefaults: FormAnalytics = {
  views: 0,
  submissions: 0,
  completions: 0,
  completionRate: 0,
};

const forms = new Map<string, FormDefinition>();
const submissions = new Map<string, FormSubmission[]>();
const drafts = new Map<string, FormDraft[]>();

function sanitizeFileField(value: unknown): FileFieldValue | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.filename !== 'string' ||
    typeof candidate.mimeType !== 'string' ||
    typeof candidate.content !== 'string' ||
    typeof candidate.size !== 'number'
  ) {
    return null;
  }

  return {
    filename: candidate.filename,
    mimeType: candidate.mimeType,
    size: candidate.size,
    content: candidate.content,
  };
}

export function createForm(input: FormDefinitionInput): FormDefinition {
  const parsed = formDefinitionSchema.parse(input);
  const id = randomUUID();
  const now = new Date().toISOString();

  const form: FormDefinition = {
    id,
    name: parsed.name,
    description: parsed.description,
    fields: parsed.fields,
    createdAt: now,
    updatedAt: now,
    analytics: { ...formAnalyticsDefaults },
  };

  forms.set(id, form);
  submissions.set(id, []);

  return form;
}

export function listForms(): FormDefinition[] {
  return Array.from(forms.values()).map((form) => ({
    ...form,
    analytics: {
      ...form.analytics,
      completionRate: form.analytics.views > 0 ? Math.round((form.analytics.completions / form.analytics.views) * 100) : 0,
    },
  }));
}

export function getForm(id: string, trackView = false): FormDefinition | null {
  const form = forms.get(id) ?? null;
  if (!form) return null;

  if (trackView) {
    form.analytics.views += 1;
    form.analytics.completionRate = form.analytics.views > 0 ? Math.round((form.analytics.completions / form.analytics.views) * 100) : 0;
  }

  return {
    ...form,
    analytics: {
      ...form.analytics,
      completionRate: form.analytics.views > 0 ? Math.round((form.analytics.completions / form.analytics.views) * 100) : 0,
    },
  };
}

function isFieldVisible(field: FormField, values: Record<string, unknown>): boolean {
  if (!field.visibleIf) return true;

  const targetValue = values[field.visibleIf.fieldName];
  return String(targetValue) === field.visibleIf.value;
}

function validateFieldValue(field: FormField, value: unknown): string | null {
  if (field.type === 'file') {
    const fileValue = sanitizeFileField(value);
    if (!fileValue) {
      return field.required ? 'File upload is required' : null;
    }

    if (field.maxSizeBytes && fileValue.size > field.maxSizeBytes) {
      return `File exceeds maximum size of ${field.maxSizeBytes} bytes`;
    }

    if (field.accept && fileValue.mimeType) {
      const acceptPattern = field.accept
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.replace('*', '.*'))
        .join('|');
      const regex = new RegExp(`^(${acceptPattern})$`, 'i');
      if (!regex.test(fileValue.mimeType) && !regex.test(fileValue.filename)) {
        return `File type must match ${field.accept}`;
      }
    }

    return null;
  }

  const valueAsString = value === undefined || value === null ? '' : String(value);

  if (field.required && valueAsString.trim() === '') {
    return 'This field is required';
  }

  if (field.pattern && valueAsString.trim() !== '') {
    let regex: RegExp;
    try {
      regex = new RegExp(field.pattern);
    } catch {
      return 'Invalid field pattern in form configuration';
    }
    if (!regex.test(valueAsString)) {
      return 'Value does not match required pattern';
    }
  }

  if (field.type === 'number' && valueAsString !== '') {
    const numeric = Number(valueAsString);
    if (!Number.isFinite(numeric)) {
      return 'A valid number is required';
    }
    if (field.min !== undefined && numeric < field.min) {
      return `Value must be at least ${field.min}`;
    }
    if (field.max !== undefined && numeric > field.max) {
      return `Value must be at most ${field.max}`;
    }
  }

  if (field.type === 'select' && valueAsString !== '' && field.options?.length) {
    const valid = field.options.some((option) => option.value === valueAsString);
    if (!valid) {
      return 'Selected value is not valid';
    }
  }

  return null;
}

export function submitForm(formId: string, payload: unknown): FormSubmission {
  const form = forms.get(formId);
  if (!form) {
    throw new AppError(404, 'Form not found', 'NOT_FOUND');
  }

  const parsed = formSubmissionSchema.parse(payload);
  const values = parsed.values || {};

  const errors: Array<{ field: string; message: string }> = [];

  form.fields.forEach((field) => {
    if (!isFieldVisible(field, values)) return;

    const errorMessage = validateFieldValue(field, values[field.name]);
    if (errorMessage) {
      errors.push({ field: field.name, message: errorMessage });
    }
  });

  if (errors.length > 0) {
    throw new AppError(400, 'Form submission failed due to validation errors', 'VALIDATION_ERROR', { errors });
  }

  const success = true;
  const submission: FormSubmission = {
    id: randomUUID(),
    formId,
    submittedAt: new Date().toISOString(),
    values,
    success,
  };

  const formSubmissions = submissions.get(formId) ?? [];
  formSubmissions.push(submission);
  submissions.set(formId, formSubmissions);

  form.analytics.submissions += 1;
  if (success) {
    form.analytics.completions += 1;
  }
  form.analytics.completionRate = form.analytics.views > 0 ? Math.round((form.analytics.completions / form.analytics.views) * 100) : 0;

  return submission;
}

export function updateForm(id: string, input: FormDefinitionInput): FormDefinition {
  const form = forms.get(id);
  if (!form) {
    throw new AppError(404, 'Form not found', 'NOT_FOUND');
  }

  const parsed = formDefinitionSchema.parse(input);
  const updatedForm: FormDefinition = {
    ...form,
    ...parsed,
    updatedAt: new Date().toISOString(),
  };

  forms.set(id, updatedForm);
  return updatedForm;
}

export function deleteForm(id: string): void {
  const form = forms.get(id);
  if (!form) {
    throw new AppError(404, 'Form not found', 'NOT_FOUND');
  }

  forms.delete(id);
  submissions.delete(id);
  drafts.delete(id);
}

export function getFormSubmissions(formId: string): FormSubmission[] {
  const form = forms.get(formId);
  if (!form) {
    throw new AppError(404, 'Form not found', 'NOT_FOUND');
  }

  return submissions.get(formId) ?? [];
}

export function saveDraft(formId: string, values: Record<string, unknown>): FormDraft {
  const form = forms.get(formId);
  if (!form) {
    throw new AppError(404, 'Form not found', 'NOT_FOUND');
  }

  const draftId = randomUUID();
  const draft: FormDraft = {
    id: draftId,
    formId,
    values,
    savedAt: new Date().toISOString(),
  };

  const formDrafts = drafts.get(formId) ?? [];
  formDrafts.push(draft);
  drafts.set(formId, formDrafts);

  return draft;
}

export function getDrafts(formId: string): FormDraft[] {
  const form = forms.get(formId);
  if (!form) {
    throw new AppError(404, 'Form not found', 'NOT_FOUND');
  }

  return drafts.get(formId) ?? [];
}

export function deleteDraft(formId: string, draftId: string): void {
  const form = forms.get(formId);
  if (!form) {
    throw new AppError(404, 'Form not found', 'NOT_FOUND');
  }

  const formDrafts = drafts.get(formId) ?? [];
  const filteredDrafts = formDrafts.filter((draft) => draft.id !== draftId);
  drafts.set(formId, filteredDrafts);
}

// Seed a sample form so the feature is visible immediately.
(function seedSampleForm() {
  const sampleId = randomUUID();
  const sampleForm: FormDefinition = {
    id: sampleId,
    name: 'Client Intake Form',
    description: 'Capture client details, delivery dates, and optional file attachments.',
    fields: [
      {
        id: randomUUID(),
        name: 'clientName',
        label: 'Client Name',
        type: 'text',
        required: true,
        placeholder: 'Enter your full name',
      },
      {
        id: randomUUID(),
        name: 'projectBudget',
        label: 'Project Budget',
        type: 'number',
        required: true,
        placeholder: 'Enter budget',
        min: 100,
        max: 100000,
      },
      {
        id: randomUUID(),
        name: 'preferredContact',
        label: 'Preferred Contact Method',
        type: 'select',
        required: true,
        options: [
          { label: 'Email', value: 'email' },
          { label: 'Phone', value: 'phone' },
        ],
      },
      {
        id: randomUUID(),
        name: 'contactEmail',
        label: 'Contact Email',
        type: 'text',
        required: true,
        pattern: '^\\S+@\\S+\\.\\S+$',
        placeholder: 'you@example.com',
        visibleIf: { fieldName: 'preferredContact', value: 'email' },
      },
      {
        id: randomUUID(),
        name: 'contactPhone',
        label: 'Contact Phone',
        type: 'text',
        required: true,
        placeholder: '+1 555 123 4567',
        visibleIf: { fieldName: 'preferredContact', value: 'phone' },
      },
      {
        id: randomUUID(),
        name: 'proposalPackage',
        label: 'Upload Proposal',
        type: 'file',
        accept: '.pdf,.doc,.docx',
        maxSizeBytes: 5_000_000,
        helpText: 'Accepted formats: PDF or Word document. Max 5MB.',
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    analytics: { ...formAnalyticsDefaults },
  };

  forms.set(sampleId, sampleForm);
  submissions.set(sampleId, []);
})();
