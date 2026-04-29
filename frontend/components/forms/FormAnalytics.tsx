'use client';

import { useEffect, useState } from 'react';
import { FormSchema, FormSubmission } from '@/lib/api';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { Download, X } from 'lucide-react';

interface FormAnalyticsProps {
  formId: string;
}

export function FormAnalytics({ formId }: FormAnalyticsProps) {
  const [form, setForm] = useState<FormSchema | null>(null);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSubmission, setSelectedSubmission] = useState<FormSubmission | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [formData, submissionsData] = await Promise.all([
          api.forms.getForm(formId),
          api.forms.getSubmissions(formId),
        ]);
        setForm(formData as FormSchema);
        setSubmissions((submissionsData as any).submissions);
      } catch (err) {
        console.error('Failed to load analytics:', err);
        toast.error('Failed to load form analytics');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [formId]);

  const exportSubmissions = () => {
    const csv = [
      ['Submission ID', 'Submitted At', ...form?.fields.map(f => f.label) || []].join(','),
      ...submissions.map(sub =>
        [
          sub.id,
          sub.submittedAt,
          ...form?.fields.map(f => {
            const value = sub.values[f.name];
            if (typeof value === 'object' && value !== null && 'filename' in value) {
              return (value as any).filename;
            }
            return String(value || '');
          }) || [],
        ].join(',')
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${form?.name || 'form'}-submissions.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading analytics...</div>;
  }

  if (!form) {
    return <div className="p-8 text-center text-destructive">Form not found</div>;
  }

  const completionRate = form.analytics?.completionRate || 0;
  const incompleteViews = (form.analytics?.views || 0) - (form.analytics?.completions || 0);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">{form.name}</h2>
        {form.description && <p className="text-muted-foreground">{form.description}</p>}
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Views</p>
          <p className="text-3xl font-bold">{form.analytics?.views || 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Submissions</p>
          <p className="text-3xl font-bold">{form.analytics?.submissions || 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Completions</p>
          <p className="text-3xl font-bold">{form.analytics?.completions || 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Completion Rate</p>
          <p className="text-3xl font-bold">{completionRate}%</p>
        </Card>
      </div>

      {/* Charts using CSS bars */}
      {form.analytics && form.analytics.views > 0 && (
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Activity Chart */}
          <Card className="p-6">
            <h3 className="mb-6 font-semibold">Form Activity</h3>
            <div className="space-y-4">
              {[
                { label: 'Views', value: form.analytics.views, color: 'bg-blue-500' },
                { label: 'Submissions', value: form.analytics.submissions, color: 'bg-green-500' },
                { label: 'Completions', value: form.analytics.completions, color: 'bg-purple-500' },
              ].map((item) => {
                const maxValue = form.analytics?.views || 1;
                const percentage = (item.value / maxValue) * 100;
                return (
                  <div key={item.label} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="font-medium">{item.value}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full ${item.color} transition-all`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Completion Rate Pie */}
          <Card className="p-6">
            <h3 className="mb-6 font-semibold">Completion Rate</h3>
            <div className="flex items-center gap-8">
              <div className="flex-1">
                <div className="relative w-40 h-40 mx-auto">
                  <svg viewBox="0 0 100 100" className="w-full h-full">
                    {/* Background circle */}
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#e5e7eb" strokeWidth="8" />
                    {/* Completed circle */}
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="8"
                      strokeDasharray={`${(completionRate / 100) * 251.2} 251.2`}
                      strokeDashoffset="0"
                      transform="rotate(-90 50 50)"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl font-bold">{completionRate}%</span>
                  </div>
                </div>
              </div>
              <div className="space-y-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full" />
                  <span>Completed: {form.analytics.completions}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-red-500 rounded-full" />
                  <span>Incomplete: {incompleteViews}</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Submissions Table */}
      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">Recent Submissions ({submissions.length})</h3>
          {submissions.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={exportSubmissions}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
          )}
        </div>

        {submissions.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No submissions yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr>
                  <th className="text-left py-2 px-4">Submitted At</th>
                  <th className="text-left py-2 px-4">Status</th>
                  <th className="text-right py-2 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((submission) => (
                  <tr key={submission.id} className="border-b hover:bg-muted/50">
                    <td className="py-2 px-4">
                      {new Date(submission.submittedAt).toLocaleString()}
                    </td>
                    <td className="py-2 px-4">
                      <span className="inline-block rounded-full bg-green-100 px-2 py-1 text-xs text-green-800">
                        Completed
                      </span>
                    </td>
                    <td className="py-2 px-4 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedSubmission(submission)}
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Submission Detail Modal */}
      {selectedSubmission && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <Card className="max-w-2xl w-full max-h-96 overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-background">
              <h3 className="font-semibold">Submission Details</h3>
              <button
                onClick={() => setSelectedSubmission(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="text-sm">
                <p className="text-muted-foreground">Submitted: {new Date(selectedSubmission.submittedAt).toLocaleString()}</p>
              </div>
              {Object.entries(selectedSubmission.values).map(([key, value]) => {
                const field = form.fields.find(f => f.name === key);
                return (
                  <div key={key} className="border-t pt-4">
                    <p className="text-sm font-medium">{field?.label || key}</p>
                    <p className="text-sm text-muted-foreground break-words">
                      {typeof value === 'object' && value !== null && 'filename' in value
                        ? `File: ${(value as any).filename} (${(value as any).size} bytes)`
                        : String(value)}
                    </p>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
