'use client';

/**
 * Onboarding wizard step page — Issue #591
 *
 * Multi-step wizard with:
 * - Role-based step paths
 * - Progress bar
 * - Skip functionality
 * - Completion incentive
 * - Analytics tracking
 * - Personalized recommendations on completion
 */

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  useOnboardingStore,
  selectCurrentStep,
  selectProgress,
  selectIsLastStep,
  selectIsFirstStep,
} from '@/store/useOnboardingStore';

// ─── Step content map ────────────────────────────────────────────────────────

interface StepConfig {
  title: string;
  description: string;
  icon: string;
  optional?: boolean;
  content?: React.ReactNode;
}

const STEP_CONFIGS: Record<string, StepConfig> = {
  welcome: { title: 'Welcome to AgenticPay', description: "Let's get you set up in a few quick steps.", icon: '👋' },
  profile_setup: { title: 'Set up your profile', description: 'Add your name, bio, and profile photo.', icon: '🧑' },
  skills_portfolio: { title: 'Skills & Portfolio', description: 'Add your skills and showcase previous work.', icon: '🎨', optional: true },
  payment_setup: { title: 'Payment Setup', description: 'Configure how you receive payments.', icon: '💳' },
  wallet_connect: { title: 'Connect Wallet', description: 'Link your Stellar or EVM wallet for crypto payments.', icon: '🔗', optional: true },
  first_project: { title: 'Find your first project', description: 'Browse and apply to available projects.', icon: '🚀', optional: true },
  business_info: { title: 'Business Information', description: 'Tell us about your business.', icon: '🏢' },
  payment_method: { title: 'Payment Method', description: 'Set up how you pay for projects.', icon: '💰' },
  create_project: { title: 'Create a project', description: 'Post your first project to find talent.', icon: '📋', optional: true },
  invite_team: { title: 'Invite your team', description: 'Add team members to collaborate.', icon: '👥', optional: true },
  kyc_verification: { title: 'Identity Verification', description: 'Complete KYC to unlock full platform access.', icon: '🔐' },
  bank_verification: { title: 'Bank Account', description: 'Link your bank account for fiat payouts.', icon: '🏦' },
  api_keys: { title: 'API Keys', description: 'Generate API keys to integrate AgenticPay.', icon: '🔑', optional: true },
  complete: { title: 'All set!', description: 'Your account is ready to use.', icon: '🎉' },
};

// ─── Step component ───────────────────────────────────────────────────────────

function StepContent({ stepId, variant }: { stepId: string; variant: 'A' | 'B' }) {
  const config = STEP_CONFIGS[stepId];
  if (!config) return null;

  const isComplete = stepId === 'complete';

  return (
    <div className="text-center">
      <div className="text-5xl mb-4" aria-hidden="true">{config.icon}</div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{config.title}</h2>
      <p className="text-gray-600 dark:text-gray-300 mb-6 max-w-sm mx-auto">{config.description}</p>

      {/* Variant-specific call-to-action for welcome step */}
      {stepId === 'welcome' && (
        <div className={`p-4 rounded-lg mb-4 ${variant === 'A' ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-indigo-50 dark:bg-indigo-900/20'}`}>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {variant === 'A'
              ? '✨ Most users complete setup in under 5 minutes.'
              : '🚀 You\'re 3 steps away from your first payment.'}
          </p>
        </div>
      )}

      {/* Completion screen */}
      {isComplete && (
        <div className="space-y-3">
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
            <p className="text-sm text-green-800 dark:text-green-200 font-medium">
              🎊 Onboarding complete! Your account is fully set up.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Recommendations component ────────────────────────────────────────────────

function RecommendationsList() {
  const getRecommendations = useOnboardingStore((s) => s.getRecommendations);
  const recs = getRecommendations();

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Recommended next steps</h3>
      <div className="space-y-2">
        {recs.slice(0, 3).map((rec) => (
          <a
            key={rec.id}
            href={rec.ctaHref}
            className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors group focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">
                {rec.title}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{rec.description}</p>
            </div>
            <span className="ml-3 text-xs text-blue-600 dark:text-blue-400 shrink-0 group-hover:translate-x-0.5 transition-transform">
              {rec.ctaLabel} →
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

// ─── Main wizard component ────────────────────────────────────────────────────

export default function OnboardingWizardPage() {
  const router = useRouter();

  const {
    steps,
    currentStepIndex,
    role,
    analytics,
    nextStep,
    prevStep,
    skipStep,
    trackStepStart,
    trackStepComplete,
    claimIncentive,
    incentiveClaimed,
  } = useOnboardingStore();

  const currentStep = useOnboardingStore(selectCurrentStep);
  const progress = useOnboardingStore(selectProgress);
  const isLastStep = useOnboardingStore(selectIsLastStep);
  const isFirstStep = useOnboardingStore(selectIsFirstStep);

  // Redirect to role selection if no role set
  useEffect(() => {
    if (!role) {
      router.replace('/onboarding');
    }
  }, [role, router]);

  // Track step start on mount/change
  useEffect(() => {
    if (currentStep) trackStepStart(currentStep);
  }, [currentStep, trackStepStart]);

  const stepConfig = STEP_CONFIGS[currentStep] ?? { title: currentStep, description: '', icon: '📄' };
  const isOptional = stepConfig.optional === true;

  const handleNext = () => {
    trackStepComplete(currentStep);
    if (isLastStep) {
      router.push('/dashboard');
    } else {
      nextStep();
    }
  };

  const handleSkip = () => {
    skipStep('user_skipped');
  };

  if (!role) return null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      {/* Top progress bar */}
      <div className="bg-white dark:bg-gray-800 shadow-sm px-4 py-3 flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">{role} setup</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Step {currentStepIndex + 1} of {steps.length}
            </span>
          </div>
          <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="max-w-md w-full">
          {/* Step indicator dots */}
          <div className="flex justify-center gap-1.5 mb-8" aria-label="Step progress">
            {steps.map((s, i) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  i < currentStepIndex
                    ? 'w-4 bg-blue-500'
                    : i === currentStepIndex
                    ? 'w-6 bg-blue-600'
                    : 'w-1.5 bg-gray-300 dark:bg-gray-600'
                }`}
                aria-current={i === currentStepIndex ? 'step' : undefined}
              />
            ))}
          </div>

          {/* Card */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
            <StepContent stepId={currentStep} variant={analytics.variant} />

            {/* Completion incentive */}
            {isLastStep && !incentiveClaimed && (
              <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-700">
                <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2">
                  🎁 <strong>Completion bonus:</strong> Get 10 XLM to try your first transaction!
                </p>
                <button
                  onClick={claimIncentive}
                  className="text-xs font-medium text-yellow-700 dark:text-yellow-300 underline hover:no-underline focus:outline-none"
                >
                  Claim reward
                </button>
              </div>
            )}

            {/* Recommendations on completion */}
            {isLastStep && <RecommendationsList />}
          </div>

          {/* Navigation buttons */}
          <div className="mt-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {!isFirstStep && (
                <button
                  onClick={prevStep}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  aria-label="Go to previous step"
                >
                  Back
                </button>
              )}
              {isOptional && !isLastStep && (
                <button
                  onClick={handleSkip}
                  className="px-4 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none focus:underline"
                  aria-label="Skip this optional step"
                >
                  Skip for now
                </button>
              )}
            </div>

            <button
              onClick={handleNext}
              className="px-6 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
              aria-label={isLastStep ? 'Go to dashboard' : 'Continue to next step'}
            >
              {isLastStep ? 'Go to Dashboard →' : 'Continue →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
