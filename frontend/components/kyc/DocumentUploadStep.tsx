'use client';

import { useRef, useState } from 'react';
import { CheckCircle2, Circle, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KycStatusBadge } from '@/components/kyc/KycStatusBadge';
import {
  ADDRESS_DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  IDENTITY_DOCUMENT_TYPES,
  KYC_ALLOWED_MIME_TYPES,
  isIdentityDocument,
  readFileAsBase64,
  validateDocumentForm,
  type FieldErrors,
  type KycDocument,
  type KycDocumentForm,
  type KycDocumentType,
  type KycDocumentUpload,
  type KycRequirement,
} from '@/lib/kyc';

interface DocumentUploadStepProps {
  documents: KycDocument[];
  requirements: KycRequirement[];
  defaultCountry?: string;
  disabled?: boolean;
  /** Resolves to true when the upload was accepted, so the form can reset. */
  onUpload: (upload: KycDocumentUpload) => Promise<boolean>;
  onBack: () => void;
  onContinue: () => void;
}

export function DocumentUploadStep({
  documents,
  requirements,
  defaultCountry = '',
  disabled,
  onUpload,
  onBack,
  onContinue,
}: DocumentUploadStepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<KycDocumentForm>({
    type: 'passport',
    documentNumber: '',
    issuingCountry: defaultCountry,
    issueDate: '',
    expiryDate: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [uploading, setUploading] = useState(false);

  const identity = isIdentityDocument(form.type);
  const allSatisfied = requirements.length > 0 && requirements.every((r) => r.satisfied);

  const update = (patch: Partial<KycDocumentForm>) => setForm((f) => ({ ...f, ...patch }));

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    const fieldErrors = validateDocumentForm(form, file);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0 || !file) return;

    setUploading(true);
    try {
      const accepted = await onUpload({
        type: form.type,
        issuingCountry: form.issuingCountry.toUpperCase(),
        ...(identity
          ? { documentNumber: form.documentNumber, expiryDate: form.expiryDate }
          : { issueDate: form.issueDate }),
        ...(identity && form.issueDate ? { issueDate: form.issueDate } : {}),
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        fileContent: await readFileAsBase64(file),
      });
      if (accepted) {
        setFile(null);
        setForm((f) => ({ ...f, documentNumber: '', issueDate: '', expiryDate: '' }));
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } finally {
      setUploading(false);
    }
  };

  const fieldError = (key: string) =>
    errors[key] ? (
      <p id={`doc-${key}-error`} className="text-xs text-red-600">
        {errors[key]}
      </p>
    ) : null;

  return (
    <div className="space-y-6">
      <section aria-labelledby="kyc-requirements" className="space-y-2">
        <h3 id="kyc-requirements" className="text-sm font-semibold">
          Required documents
        </h3>
        <ul className="space-y-1">
          {requirements.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              {r.satisfied ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />
              ) : (
                <Circle className="h-4 w-4 text-gray-400" aria-hidden="true" />
              )}
              <span>{r.label}</span>
              <span className="sr-only">{r.satisfied ? '(provided)' : '(missing)'}</span>
            </li>
          ))}
        </ul>
      </section>

      {documents.length > 0 && (
        <section aria-labelledby="kyc-uploaded" className="space-y-2">
          <h3 id="kyc-uploaded" className="text-sm font-semibold">
            Uploaded documents
          </h3>
          <ul className="divide-y rounded-lg border">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <FileText className="mt-0.5 h-4 w-4 text-gray-500" aria-hidden="true" />
                  <div>
                    <p className="font-medium">
                      {DOCUMENT_TYPE_LABELS[doc.type]}
                      {doc.documentNumberMasked ? ` · ${doc.documentNumberMasked}` : ''}
                    </p>
                    {doc.fileName && <p className="text-xs text-gray-500">{doc.fileName}</p>}
                    {doc.rejectionReasons?.map((reason) => (
                      <p key={reason} className="text-xs text-red-600">
                        {reason}
                      </p>
                    ))}
                    {doc.warnings?.map((warning) => (
                      <p key={warning} className="text-xs text-yellow-700">
                        {warning}
                      </p>
                    ))}
                  </div>
                </div>
                <KycStatusBadge status={doc.status} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <form onSubmit={handleUpload} noValidate className="space-y-4 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Add a document</h3>
        <fieldset disabled={disabled || uploading} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="doc-type">Document type</Label>
            <select
              id="doc-type"
              value={form.type}
              onChange={(e) => update({ type: e.target.value as KycDocumentType })}
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            >
              <optgroup label="Identity">
                {IDENTITY_DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DOCUMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Proof of address">
                {ADDRESS_DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DOCUMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="doc-issuingCountry">Issuing country (e.g. US)</Label>
            <Input
              id="doc-issuingCountry"
              maxLength={2}
              value={form.issuingCountry}
              aria-invalid={Boolean(errors.issuingCountry)}
              onChange={(e) => update({ issuingCountry: e.target.value })}
            />
            {fieldError('issuingCountry')}
          </div>

          {identity && (
            <>
              <div className="space-y-1">
                <Label htmlFor="doc-documentNumber">Document number</Label>
                <Input
                  id="doc-documentNumber"
                  autoComplete="off"
                  value={form.documentNumber}
                  aria-invalid={Boolean(errors.documentNumber)}
                  onChange={(e) => update({ documentNumber: e.target.value })}
                />
                {fieldError('documentNumber')}
              </div>
              <div className="space-y-1">
                <Label htmlFor="doc-expiryDate">Expiry date</Label>
                <Input
                  id="doc-expiryDate"
                  type="date"
                  value={form.expiryDate}
                  aria-invalid={Boolean(errors.expiryDate)}
                  onChange={(e) => update({ expiryDate: e.target.value })}
                />
                {fieldError('expiryDate')}
              </div>
            </>
          )}

          <div className="space-y-1">
            <Label htmlFor="doc-issueDate">{identity ? 'Issue date (optional)' : 'Issue date'}</Label>
            <Input
              id="doc-issueDate"
              type="date"
              value={form.issueDate}
              aria-invalid={Boolean(errors.issueDate)}
              onChange={(e) => update({ issueDate: e.target.value })}
            />
            {fieldError('issueDate')}
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="doc-file">File (JPEG, PNG, WebP or PDF, up to 10 MB)</Label>
            <Input
              id="doc-file"
              ref={fileInputRef}
              type="file"
              accept={KYC_ALLOWED_MIME_TYPES.join(',')}
              aria-invalid={Boolean(errors.file)}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {fieldError('file')}
          </div>
        </fieldset>

        <div className="flex justify-end">
          <Button type="submit" variant="outline" disabled={disabled || uploading}>
            {uploading ? 'Verifying...' : 'Upload and verify'}
          </Button>
        </div>
      </form>

      <div className="flex justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="button" onClick={onContinue} disabled={!allSatisfied}>
          Continue to review
        </Button>
      </div>
    </div>
  );
}
