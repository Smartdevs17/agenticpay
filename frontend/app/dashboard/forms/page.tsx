'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FormBuilder } from '@/components/forms/FormBuilder';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { FormSchema } from '@/components/forms/types';
import { Trash2, Eye, Copy, BarChart3, X } from 'lucide-react';

export default function DashboardFormsPage() {
  const [forms, setForms] = useState<FormSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [embedSnippetFormId, setEmbedSnippetFormId] = useState<string | null>(null);

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

  const getEmbedSnippet = (formId: string): string => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const src = `${origin}/forms/embed/${formId}`;
    return `<iframe\n  src="${src}"\n  width="100%"\n  height="600"\n  frameborder="0"\n  sandbox="allow-forms allow-scripts allow-same-origin"\n  title="Payment Form"\n></iframe>`;
  };

  const handleCopyEmbedSnippet = (formId: string) => {
    navigator.clipboard.writeText(getEmbedSnippet(formId));
    toast.success('iframe snippet copied to clipboard');
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
                        onClick={() =>
                          setEmbedSnippetFormId(
                            embedSnippetFormId === form.id ? null : form.id,
                          )
                        }
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
                  {embedSnippetFormId === form.id && (
                    <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-900/10 dark:border-blue-800 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-blue-700 dark:text-blue-400">
                          Embed snippet — paste this into your website's HTML:
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEmbedSnippetFormId(null)}
                          className="h-6 w-6 p-0"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <pre className="text-xs font-mono bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
                        {getEmbedSnippet(form.id)}
                      </pre>
                      <Button
                        size="sm"
                        onClick={() => handleCopyEmbedSnippet(form.id)}
                        className="gap-2"
                      >
                        <Copy className="h-4 w-4" />
                        Copy snippet
                      </Button>
                    </div>
                  )}
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
