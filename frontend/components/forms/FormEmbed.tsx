'use client';

import { useEffect, useState } from 'react';
import { FormSchema } from './types';
import { FormRenderer } from './FormRenderer';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface FormEmbedProps {
  formId: string;
  onSubmitComplete?: () => void;
}

export function FormEmbed({ formId, onSubmitComplete }: FormEmbedProps) {
  const [form, setForm] = useState<FormSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadForm = async () => {
      try {
        setLoading(true);
        const loadedForm = await api.forms.getForm(formId);
        setForm(loadedForm as FormSchema);
        setError(null);
      } catch (err) {
        console.error('Failed to load form:', err);
        setError('Failed to load form. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    loadForm();
  }, [formId]);

  const handleSubmit = async (values: Record<string, unknown>) => {
    try {
      await api.forms.submitForm(formId, values);
      toast.success('Form submitted successfully');
      if (onSubmitComplete) {
        onSubmitComplete();
      }
    } catch (err) {
      console.error('Failed to submit form:', err);
      toast.error('Failed to submit form');
      throw err;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Loading form...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Form not found</p>
      </div>
    );
  }

  return <FormRenderer form={form} onSubmit={handleSubmit} submitLabel="Submit" />;
}
