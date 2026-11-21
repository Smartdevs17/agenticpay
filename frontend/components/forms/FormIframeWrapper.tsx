'use client';

import { useEffect } from 'react';

interface FormIframeWrapperProps {
  formId: string;
}

/**
 * FormIframeWrapper provides instructions for embedding a form via iframe.
 * The actual embedded form is served from /forms/embed/[id] route.
 */
export function FormIframeWrapper({ formId }: FormIframeWrapperProps) {
  const embedUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/forms/embed/${formId}`;
  const iframeCode = `<iframe
  src="${embedUrl}"
  width="100%"
  height="600"
  frameborder="0"
  style="border: 1px solid #e5e7eb; border-radius: 0.5rem; margin: 1rem 0;"
  allow="geolocation; microphone; camera"
></iframe>`;

  useEffect(() => {
    // Listen for messages from embedded forms
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== typeof window !== 'undefined' ? window.location.origin : '') {
        return;
      }
      if (event.data.type === 'form:submitted') {
        console.log('Form submitted:', event.data.payload);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="space-y-6 rounded-lg border border-input p-6">
      <div className="space-y-2">
        <h3 className="font-semibold">Embed This Form</h3>
        <p className="text-sm text-muted-foreground">
          Copy the code below to embed this form on your website.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Embed URL</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={embedUrl}
            readOnly
            className="flex-1 rounded-md border border-input bg-muted px-3 py-2 text-sm"
          />
          <button
            onClick={() => {
              navigator.clipboard.writeText(embedUrl);
              alert('Copied to clipboard!');
            }}
            className="round-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted"
          >
            Copy
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="iframe-code" className="text-sm font-medium">
          HTML Code
        </label>
        <textarea
          id="iframe-code"
          value={iframeCode}
          readOnly
          className="h-32 w-full rounded-md border border-input bg-muted p-3 font-mono text-xs"
        />
        <button
          onClick={() => {
            navigator.clipboard.writeText(iframeCode);
            alert('Copied to clipboard!');
          }}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted"
        >
          Copy Code
        </button>
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <p>
          <strong>Note:</strong> The embedded form will auto-save drafts to the user's browser. Form submissions are tracked in
          the analytics dashboard.
        </p>
      </div>
    </div>
  );
}
