'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormRenderer } from '@/components/forms/FormRenderer';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { FormSchema } from '@/components/forms/types';

export default function PublicFormPage() {
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
        toast.error('Unable to load form');
      } finally {
        setLoading(false);
      }
    };

    if (formId) load();
  }, [formId]);

  if (loading) {
    return <p className="p-8">Loading form…</p>;
  }

  if (!form) {
    return <p className="p-8">Form not found.</p>;
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>{form.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <FormRenderer
            form={form}
            onSubmit={async (values) => {
              try {
                await api.forms.submitForm(form.id ?? '', values);
                toast.success('Your submission has been received.');
              } catch (error) {
                console.error(error);
                toast.error('Submission failed. Please verify your entries.');
              }
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
