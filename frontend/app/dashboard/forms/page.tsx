'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FormBuilder } from '@/components/forms/FormBuilder';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { FormSchema } from '@/components/forms/types';
import { Trash2, Eye, Copy, BarChart3 } from 'lucide-react';

export default function DashboardFormsPage() {
  const [forms, setForms] = useState<FormSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);

  const loadForms = async () => {
    try {
      setLoading(true);
      const response = await api.forms.listForms();
      setForms(response.forms);
    } catch (error) {
      console.error(error);
      toast.error('Unable to load forms');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadForms();
  }, []);

  const handleDeleteForm = async (formId: string) => {
    if (!confirm('Are you sure you want to delete this form?')) {
      return;
    }

    try {
      await api.forms.deleteForm(formId);
      toast.success('Form deleted successfully');
      loadForms();
    } catch (error) {
      console.error(error);
      toast.error('Failed to delete form');
    }
  };

  const handleCopyEmbedUrl = (formId: string) => {
    const embedUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/forms/embed/${formId}`;
    navigator.clipboard.writeText(embedUrl);
    toast.success('Embed URL copied to clipboard');
  };

  return (
    <div className="space-y-8 pb-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Forms</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Build and manage schema-driven forms that can be embedded anywhere.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Existing Forms</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p>Loading forms…</p>
          ) : forms.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">No forms created yet.</p>
              <Button onClick={loadForms}>Refresh</Button>
            </div>
          ) : (
            <div className="space-y-4">
              {forms.map((form) => (
                <div key={form.id} className="rounded-xl border border-input p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex-1">
                      <h2 className="text-lg font-semibold">{form.name}</h2>
                      <p className="text-sm text-muted-foreground">{form.description}</p>
                      <div className="mt-3 flex flex-wrap gap-3 text-sm text-muted-foreground">
                        <span>Views: {form.analytics?.views ?? 0}</span>
                        <span>Submissions: {form.analytics?.submissions ?? 0}</span>
                        <span>Completion: {form.analytics?.completionRate ?? 0}%</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/forms/${form.id}/analytics`}>
                        <Button variant="ghost" size="sm" className="gap-2">
                          <BarChart3 className="h-4 w-4" />
                          Analytics
                        </Button>
                      </Link>
                      <Link href={`/forms/embed/${form.id}`}>
                        <Button variant="outline" size="sm" className="gap-2">
                          <Eye className="h-4 w-4" />
                          View
                        </Button>
                      </Link>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopyEmbedUrl(form.id)}
                        className="gap-2"
                      >
                        <Copy className="h-4 w-4" />
                        Embed
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteForm(form.id)}
                        className="gap-2"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <section>
        <FormBuilder />
      </section>
    </div>
  );
}
