'use client';

/**
 * KYC onboarding flow — Issue #921
 *
 * Personal info → document upload (validated in the browser, verified by the
 * backend's document verification provider) → review and status.
 */

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DocumentUploadStep } from '@/components/kyc/DocumentUploadStep';
import { KycStatusBadge } from '@/components/kyc/KycStatusBadge';
import { PersonalInfoStep } from '@/components/kyc/PersonalInfoStep';
import { ReviewStep } from '@/components/kyc/ReviewStep';
import { cn } from '@/lib/utils';
import {
  KycApiError,
  kycApi,
  type KycDocumentUpload,
  type KycOnboardingState,
  type KycOnboardingStep,
  type KycPersonalInfo,
} from '@/lib/kyc';

type StepId = 'personal_info' | 'documents' | 'review';

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'personal_info', label: 'Personal info' },
  { id: 'documents', label: 'Documents' },
  { id: 'review', label: 'Review & status' },
];

function stepFor(onboardingStep: KycOnboardingStep): StepId {
  return onboardingStep === 'complete' ? 'review' : onboardingStep;
}

function describeError(error: unknown): { message: string; details: string[] } {
  if (error instanceof KycApiError) return { message: error.message, details: error.details };
  return { message: error instanceof Error ? error.message : 'Something went wrong', details: [] };
}

export function KycOnboardingFlow({ userId }: { userId: string }) {
  const [state, setState] = useState<KycOnboardingState | null>(null);
  const [step, setStep] = useState<StepId>('personal_info');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);

  const applyState = useCallback((next: KycOnboardingState) => {
    setState(next);
    setStep(stepFor(next.profile.onboardingStep));
  }, []);

  useEffect(() => {
    let cancelled = false;
    kycApi
      .getState(userId)
      .then((loaded) => {
        if (cancelled) return;
        if (loaded) applyState(loaded);
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, applyState]);

  const run = async (action: () => Promise<void>): Promise<boolean> => {
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(describeError(err));
      return false;
    }
  };

  const handlePersonalInfo = async (info: KycPersonalInfo) => {
    await run(async () => applyState(await kycApi.savePersonalInfo(userId, info)));
  };

  const handleUpload = (upload: KycDocumentUpload) =>
    run(async () => {
      const { state: next } = await kycApi.uploadDocument(userId, upload);
      setState(next);
    });

  const handleSubmit = async () => {
    await run(async () => applyState(await kycApi.submit(userId)));
  };

  if (loading) {
    return <p className="text-sm text-gray-500">Loading verification status...</p>;
  }

  const locked = state?.profile.status === 'under_review' || state?.profile.status === 'approved';
  const currentIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Identity verification</CardTitle>
          {state && <KycStatusBadge status={state.profile.status} />}
        </div>
        <ol className="flex gap-2" aria-label="Verification steps">
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              aria-current={s.id === step ? 'step' : undefined}
              className={cn(
                'flex-1 rounded-md border px-3 py-2 text-xs font-medium',
                i < currentIndex && 'border-blue-200 bg-blue-50 text-blue-700',
                i === currentIndex && 'border-blue-600 bg-blue-600 text-white',
                i > currentIndex && 'text-gray-500',
              )}
            >
              {i + 1}. {s.label}
            </li>
          ))}
        </ol>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <p>{error.message}</p>
            {error.details.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {error.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {step === 'personal_info' && (
          <PersonalInfoStep
            initial={state?.profile.personalInfo}
            disabled={locked}
            onSubmit={handlePersonalInfo}
          />
        )}

        {step === 'documents' && state && (
          <DocumentUploadStep
            documents={state.profile.documents}
            requirements={state.requirements}
            defaultCountry={state.profile.personalInfo?.countryOfResidence}
            disabled={locked}
            onUpload={handleUpload}
            onBack={() => setStep('personal_info')}
            onContinue={() => setStep('review')}
          />
        )}

        {step === 'review' && state && (
          <ReviewStep
            state={state}
            onSubmit={handleSubmit}
            onEditDocuments={() => setStep('documents')}
            onEditPersonalInfo={() => setStep('personal_info')}
          />
        )}
      </CardContent>
    </Card>
  );
}
