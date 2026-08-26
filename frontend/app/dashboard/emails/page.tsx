'use client';

import { useEffect, useState } from 'react';

interface TemplateSummary {
  id: string;
  version: number;
  variants: string[];
}

interface PreviewResult {
  subject: string;
  htmlBody: string;
  version: number;
  variant: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

/** Template preview server UI: pick a component-based template + A/B variant and render it live. */
export default function EmailTemplatesPage() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [bucketKey, setBucketKey] = useState('preview-1');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/v2/email/templates/registry`)
      .then((res) => res.json())
      .then((data) => {
        setTemplates(data.templates ?? []);
        if (data.templates?.[0]) setSelectedId(data.templates[0].id);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    fetch(`${API_URL}/api/v2/email/templates/registry/${selectedId}/preview?bucketKey=${encodeURIComponent(bucketKey)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setError(null);
        setPreview(data);
      })
      .catch((err) => setError(err.message));
  }, [selectedId, bucketKey]);

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <h1 className="text-2xl font-semibold">Email Templates</h1>

        <div className="flex flex-wrap items-center gap-3">
          <select
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} (v{t.version}, {t.variants.length} variant{t.variants.length > 1 ? 's' : ''})
              </option>
            ))}
          </select>
          <input
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={bucketKey}
            onChange={(e) => setBucketKey(e.target.value)}
            placeholder="A/B bucket key (e.g. recipient email)"
          />
          {preview && <span className="text-xs text-muted-foreground">Rendered variant: {preview.variant}</span>}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {preview && (
          <div className="rounded-lg border">
            <div className="border-b bg-muted/50 px-4 py-2 text-sm font-medium">Subject: {preview.subject}</div>
            <iframe title="Email preview" className="h-[600px] w-full" srcDoc={preview.htmlBody} sandbox="" />
          </div>
        )}
      </div>
    </main>
  );
}
