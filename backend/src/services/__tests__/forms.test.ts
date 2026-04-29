import { describe, it, expect, beforeEach } from 'vitest';
import {
  createForm,
  getForm,
  listForms,
  submitForm,
  updateForm,
  deleteForm,
  getFormSubmissions,
  saveDraft,
  getDrafts,
  deleteDraft,
  formDefinitionSchema,
} from '../services/forms';

describe('Form Builder - Schema Validation & Management', () => {
  const sampleFormInput = {
    name: 'Test Form',
    description: 'A test form',
    fields: [
      {
        id: 'field-1',
        name: 'email',
        label: 'Email Address',
        type: 'text' as const,
        required: true,
        pattern: '^\\S+@\\S+\\.\\S+$',
      },
      {
        id: 'field-2',
        name: 'contactMethod',
        label: 'Preferred Contact',
        type: 'select' as const,
        required: true,
        options: [
          { label: 'Email', value: 'email' },
          { label: 'Phone', value: 'phone' },
        ],
      },
      {
        id: 'field-3',
        name: 'phone',
        label: 'Phone Number',
        type: 'text' as const,
        visibleIf: { fieldName: 'contactMethod', value: 'phone' },
      },
      {
        id: 'field-4',
        name: 'budget',
        label: 'Budget',
        type: 'number' as const,
        min: 100,
        max: 10000,
      },
      {
        id: 'field-5',
        name: 'document',
        label: 'Upload Document',
        type: 'file' as const,
        accept: '.pdf,.doc',
        maxSizeBytes: 1000000,
      },
    ],
  };

  describe('Form CRUD Operations', () => {
    it('should create a form with valid schema', () => {
      const form = createForm(sampleFormInput);
      expect(form.id).toBeDefined();
      expect(form.name).toBe('Test Form');
      expect(form.description).toBe('A test form');
      expect(form.fields).toHaveLength(5);
      expect(form.analytics).toEqual({
        views: 0,
        submissions: 0,
        completions: 0,
        completionRate: 0,
      });
    });

    it('should retrieve a form by ID with view tracking', () => {
      const created = createForm(sampleFormInput);
      const retrieved = getForm(created.id, true);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.analytics.views).toBe(1);
    });

    it('should list all forms', () => {
      const form1 = createForm(sampleFormInput);
      const form2 = createForm({ ...sampleFormInput, name: 'Form 2' });
      const forms = listForms();
      expect(forms.length).toBeGreaterThanOrEqual(2);
      expect(forms.some((f) => f.id === form1.id)).toBeTruthy();
      expect(forms.some((f) => f.id === form2.id)).toBeTruthy();
    });

    it('should update a form', () => {
      const created = createForm(sampleFormInput);
      const updated = updateForm(created.id, {
        ...sampleFormInput,
        name: 'Updated Form',
      });
      expect(updated.name).toBe('Updated Form');
      expect(updated.id).toBe(created.id);
    });

    it('should delete a form', () => {
      const created = createForm(sampleFormInput);
      deleteForm(created.id);
      const retrieved = getForm(created.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('Form Validation - Conditional Visibility', () => {
    it('should validate required fields only for visible fields', () => {
      const form = createForm(sampleFormInput);
      const submission = submitForm(form.id, {
        values: {
          email: 'test@example.com',
          contactMethod: 'email',
          // phone not required because contactMethod !== 'phone'
          budget: 500,
        },
      });
      expect(submission.success).toBe(true);
    });

    it('should reject when required visible field is missing', () => {
      const form = createForm(sampleFormInput);
      expect(() => {
        submitForm(form.id, {
          values: {
            email: 'test@example.com',
            contactMethod: 'phone',
            // phone is required but missing
            budget: 500,
          },
        });
      }).toThrow();
    });
  });

  describe('Form Validation - Pattern Matching', () => {
    it('should validate email pattern', () => {
      const form = createForm(sampleFormInput);
      expect(() => {
        submitForm(form.id, {
          values: {
            email: 'invalid-email',
            contactMethod: 'email',
            budget: 500,
          },
        });
      }).toThrow('Value does not match required pattern');
    });

    it('should accept valid email pattern', () => {
      const form = createForm(sampleFormInput);
      const submission = submitForm(form.id, {
        values: {
          email: 'valid@example.com',
          contactMethod: 'email',
          budget: 500,
        },
      });
      expect(submission.success).toBe(true);
    });
  });

  describe('Form Validation - Range Constraints', () => {
    it('should reject value below minimum', () => {
      const form = createForm(sampleFormInput);
      expect(() => {
        submitForm(form.id, {
          values: {
            email: 'test@example.com',
            contactMethod: 'email',
            budget: 50, // Below min of 100
          },
        });
      }).toThrow('Value must be at least 100');
    });

    it('should reject value above maximum', () => {
      const form = createForm(sampleFormInput);
      expect(() => {
        submitForm(form.id, {
          values: {
            email: 'test@example.com',
            contactMethod: 'email',
            budget: 50000, // Above max of 10000
          },
        });
      }).toThrow('Value must be at most 10000');
    });
  });

  describe('Form Submissions & Analytics', () => {
    it('should track submissions and update analytics', () => {
      const form = createForm(sampleFormInput);
      getForm(form.id, true); // Track view
      submitForm(form.id, {
        values: {
          email: 'test@example.com',
          contactMethod: 'email',
          budget: 500,
        },
      });

      const updated = getForm(form.id);
      expect(updated?.analytics.views).toBe(1);
      expect(updated?.analytics.submissions).toBe(1);
      expect(updated?.analytics.completions).toBe(1);
      expect(updated?.analytics.completionRate).toBe(100);
    });

    it('should retrieve form submissions', () => {
      const form = createForm(sampleFormInput);
      submitForm(form.id, {
        values: {
          email: 'test1@example.com',
          contactMethod: 'email',
          budget: 500,
        },
      });
      submitForm(form.id, {
        values: {
          email: 'test2@example.com',
          contactMethod: 'email',
          budget: 600,
        },
      });

      const submissions = getFormSubmissions(form.id);
      expect(submissions).toHaveLength(2);
      expect(submissions[0].formId).toBe(form.id);
    });
  });

  describe('Form Drafts Management', () => {
    it('should save and retrieve form drafts', () => {
      const form = createForm(sampleFormInput);
      const draft = saveDraft(form.id, {
        email: 'draft@example.com',
        contactMethod: 'email',
      });

      expect(draft.id).toBeDefined();
      expect(draft.formId).toBe(form.id);
      expect(draft.values.email).toBe('draft@example.com');

      const drafts = getDrafts(form.id);
      expect(drafts).toHaveLength(1);
      expect(drafts[0].id).toBe(draft.id);
    });

    it('should delete draft by ID', () => {
      const form = createForm(sampleFormInput);
      const draft = saveDraft(form.id, {
        email: 'draft@example.com',
      });

      deleteDraft(form.id, draft.id);
      const remaining = getDrafts(form.id);
      expect(remaining).toHaveLength(0);
    });

    it('should support multiple drafts per form', () => {
      const form = createForm(sampleFormInput);
      saveDraft(form.id, { email: 'draft1@example.com' });
      saveDraft(form.id, { email: 'draft2@example.com' });

      const drafts = getDrafts(form.id);
      expect(drafts).toHaveLength(2);
    });
  });

  describe('Form Validation - File Uploads', () => {
    it('should validate file size constraints', () => {
      const form = createForm(sampleFormInput);
      expect(() => {
        submitForm(form.id, {
          values: {
            email: 'test@example.com',
            contactMethod: 'email',
            budget: 500,
            document: {
              filename: 'large-file.pdf',
              mimeType: 'application/pdf',
              size: 2000000, // Exceeds max of 1000000
              content: 'base64content',
            },
          },
        });
      }).toThrow('File exceeds maximum size');
    });

    it('should validate file type constraints', () => {
      const form = createForm(sampleFormInput);
      expect(() => {
        submitForm(form.id, {
          values: {
            email: 'test@example.com',
            contactMethod: 'email',
            budget: 500,
            document: {
              filename: 'image.jpg',
              mimeType: 'image/jpeg',
              size: 500000,
              content: 'base64content',
            },
          },
        });
      }).toThrow('File type must match');
    });

    it('should accept valid file uploads', () => {
      const form = createForm(sampleFormInput);
      const submission = submitForm(form.id, {
        values: {
          email: 'test@example.com',
          contactMethod: 'email',
          budget: 500,
          document: {
            filename: 'valid.pdf',
            mimeType: 'application/pdf',
            size: 500000,
            content: 'base64content',
          },
        },
      });
      expect(submission.success).toBe(true);
    });
  });

  describe('Field Type Validation - Select', () => {
    it('should validate select field options', () => {
      const form = createForm(sampleFormInput);
      expect(() => {
        submitForm(form.id, {
          values: {
            email: 'test@example.com',
            contactMethod: 'invalid-option', // Not in options
            budget: 500,
          },
        });
      }).toThrow('Selected value is not valid');
    });
  });
});
