'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { KycStatusBadge } from '@/components/kyc/KycStatusBadge';
import { DOCUMENT_TYPE_LABELS, type KycOnboardingState } from '@/lib/kyc';

interface ReviewStepProps {
  state: KycOnboardingState;
  onSubmit: () => Promise<void>;
  onEditDocuments: () => void;
  onEditPersonalInfo: () => void;
}

const STATUS_MESSAGES = {
  pending: 'Check your details, then submit your application for verification.',
  under_review: 'Your application is being reviewed. This usually takes one business day.',
  approved: 'Your identity is verified. You have full access to AgenticPay.',
  rejected: 'Your application was not approved. Fix the issues below and resubmit.',
  expired: 'Your verification has expired. Upload current documents to verify again.',
} as const;

export function ReviewStep({ state, onSubmit, onEditDocuments, onEditPersonalInfo }: ReviewStepProps) {
  const { profile, canSubmit } = state;
  const [submitting, setSubmitting] = useState(false);
  const editable = profile.status !== 'under_review' && profile.status !== 'approved';
  const info = profile.personalInfo;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
        <div>
          <p className="text-sm font-semibold">Verification status</p>
          <p className="text-sm text-gray-600">{STATUS_MESSAGES[profile.status]}</p>
          {profile.status === 'approved' && profile.expiresAt && (
            <p className="mt-1 text-xs text-gray-500">
              Valid until {new Date(profile.expiresAt).toLocaleDateString()}
            </p>
          )}
        </div>
        <KycStatusBadge status={profile.status} />
      </div>

      {profile.rejectionReasons.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-medium">Reasons</p>
          <ul className="mt-1 list-disc pl-5">
            {profile.rejectionReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {info && (
        <section aria-labelledby="kyc-review-person" className="space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <h3 id="kyc-review-person" className="font-semibold">
              Personal information
            </h3>
            {editable && (
              <Button type="button" variant="link" size="sm" onClick={onEditPersonalInfo}>
                Edit
              </Button>
            )}
          </div>
          <p>
            {info.firstName} {info.lastName} · born {info.dateOfBirth}
          </p>
          <p>
            {info.address.line1}, {info.address.city} {info.address.postalCode}, {info.address.country}
          </p>
        </section>
      )}

      <section aria-labelledby="kyc-review-docs" className="space-y-1 text-sm">
        <div className="flex items-center justify-between">
          <h3 id="kyc-review-docs" className="font-semibold">
            Documents
          </h3>
          {editable && (
            <Button type="button" variant="link" size="sm" onClick={onEditDocuments}>
              Edit
            </Button>
          )}
        </div>
        <ul className="space-y-1">
          {profile.documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between">
              <span>
                {DOCUMENT_TYPE_LABELS[doc.type]}
                {doc.documentNumberMasked ? ` · ${doc.documentNumberMasked}` : ''}
              </span>
              <KycStatusBadge status={doc.status} />
            </li>
          ))}
        </ul>
      </section>

      {profile.status === 'pending' && (
        <div className="flex justify-end">
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit || submitting}>
            {submitting ? 'Submitting...' : 'Submit for verification'}
          </Button>
        </div>
      )}
    </div>
  );
}
