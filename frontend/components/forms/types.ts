export type FormFieldType = 'text' | 'number' | 'date' | 'file' | 'select';

export interface FormFieldOption {
  label: string;
  value: string;
}

export interface FormFieldVisibility {
  fieldName: string;
  value: string;
}

export interface FormFieldSchema {
  id: string;
  name: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  accept?: string;
  pattern?: string;
  min?: number;
  max?: number;
  maxSizeBytes?: number;
  options?: FormFieldOption[];
  visibleIf?: FormFieldVisibility;
}

export interface FormSchema {
  id?: string;
  name: string;
  description?: string;
  fields: FormFieldSchema[];
  analytics?: {
    views: number;
    submissions: number;
    completions: number;
    completionRate: number;
  };
}

export interface FileFieldValue {
  filename: string;
  mimeType: string;
  size: number;
  content: string;
}

export type FormSubmissionValues = Record<string, string | number | FileFieldValue | undefined>;
