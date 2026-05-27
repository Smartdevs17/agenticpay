'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FormRenderer } from '@/components/forms/FormRenderer';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { FormSchema } from '@/components/forms/types';

export default function EmbeddedFormPage() {
  const params = useParams();
  const formId = params?.id as string;
  const [form, setForm] = useState<FormSchema | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await api.forms.getForm(formId);
        setForm(result);
      } catch (error) {
        console.error(error);
        toast.error('Unable to load embedded form');
      } finally {
        setLoading(false);
      }
    };

    if (formId) load();
  }, [formId]);

  if (loading) {
    return <p className="p-8">Loading embedded form…</p>;
  }

  if (!form) {
    return <p className="p-8">Embedded form not found.</p>;
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl rounded-3xl border border-input bg-white p-6 shadow-xl">
        <FormRenderer
          form={form}
          submitLabel="Submit"
          onSubmit={async (values) => {
            try {
              await api.forms.submitForm(form.id ?? '', values);
              toast.success('Submission received');
            } catch (error) {
              console.error(error);
              toast.error('Submission failed.');
            }
          }}
        />
      </div>
    </div>
  );
}
