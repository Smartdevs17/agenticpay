'use client';

/**
 * useOnboardingStore.ts — Issue #591
 *
 * Onboarding state with:
 * - Multi-step wizard with role-based paths (freelancer vs client)
 * - Progress persistence across sessions (localStorage via Zustand persist)
 * - Personalized recommendations
 * - Skip functionality for experienced users
 * - Onboarding analytics (completion tracking, drop-off)
 * - A/B testing variant tracking
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MerchantOnboarding, OnboardingTask, TaskStatus } from '@/lib/types/onboarding';

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserRole = 'freelancer' | 'client' | 'merchant' | null;
export type OnboardingVariant = 'A' | 'B';

export interface StepProgress {
  stepId: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  skippedAt?: string;
  timeSpentMs?: number;
}

export interface DropOffEvent {
  stepId: string;
  timestamp: string;
  reason?: string;
}

export interface OnboardingAnalytics {
  sessionId: string;
  variant: OnboardingVariant;
  role: UserRole;
  stepsProgress: StepProgress[];
  dropOffEvents: DropOffEvent[];
  totalTimeMs: number;
  completionRate: number;
  startedAt: string;
  completedAt?: string;
  lastActiveAt: string;
}

export interface Recommendation {
  id: string;
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
  priority: 'high' | 'medium' | 'low';
  forRoles: UserRole[];
}

// ─── Role-based step paths ────────────────────────────────────────────────────

export const ROLE_STEP_PATHS: Record<NonNullable<UserRole>, string[]> = {
  freelancer: [
    'welcome',
    'profile_setup',
    'skills_portfolio',
    'payment_setup',
    'wallet_connect',
    'first_project',
    'complete',
  ],
  client: [
    'welcome',
    'business_info',
    'payment_method',
    'create_project',
    'invite_team',
    'complete',
  ],
  merchant: [
    'welcome',
    'business_info',
    'kyc_verification',
    'bank_verification',
    'payment_setup',
    'api_keys',
    'complete',
  ],
};

// ─── Recommendations by role ──────────────────────────────────────────────────

const RECOMMENDATIONS: Recommendation[] = [
  {
    id: 'rec_wallet_connect',
    title: 'Connect your Stellar wallet',
    description: 'Enable crypto payments and access DeFi features on Stellar.',
    ctaLabel: 'Connect Wallet',
    ctaHref: '/dashboard/wallet',
    priority: 'high',
    forRoles: ['freelancer', 'client', 'merchant'],
  },
  {
    id: 'rec_2fa',
    title: 'Enable Two-Factor Authentication',
    description: 'Protect your account with TOTP-based 2FA.',
    ctaLabel: 'Enable 2FA',
    ctaHref: '/dashboard/settings/security',
    priority: 'high',
    forRoles: ['freelancer', 'client', 'merchant'],
  },
  {
    id: 'rec_first_project_freelancer',
    title: 'Browse available projects',
    description: 'Find your first project and start earning.',
    ctaLabel: 'Browse Projects',
    ctaHref: '/dashboard/projects',
    priority: 'medium',
    forRoles: ['freelancer'],
  },
  {
    id: 'rec_create_project',
    title: 'Create your first project',
    description: 'Post a project and find talented freelancers.',
    ctaLabel: 'Create Project',
    ctaHref: '/dashboard/projects/new',
    priority: 'medium',
    forRoles: ['client'],
  },
  {
    id: 'rec_api_keys',
    title: 'Generate API keys',
    description: 'Integrate AgenticPay into your application.',
    ctaLabel: 'API Keys',
    ctaHref: '/dashboard/api-keys',
    priority: 'medium',
    forRoles: ['merchant'],
  },
  {
    id: 'rec_portfolio',
    title: 'Add portfolio samples',
    description: 'Showcase your work to attract better-paying projects.',
    ctaLabel: 'Add Portfolio',
    ctaHref: '/dashboard/profile',
    priority: 'low',
    forRoles: ['freelancer'],
  },
];

// ─── A/B variant assignment ───────────────────────────────────────────────────

function assignVariant(): OnboardingVariant {
  // 50/50 split — stable for the session
  return Math.random() < 0.5 ? 'A' : 'B';
}

function generateSessionId(): string {
  return `onb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ─── State / Actions ─────────────────────────────────────────────────────────

interface OnboardingState {
  // Wizard state
  onboarding: MerchantOnboarding | null;
  role: UserRole;
  currentStepIndex: number;
  steps: string[];
  isLoading: boolean;
  error: string | null;

  // Analytics & A/B
  analytics: OnboardingAnalytics;

  // Recommendations
  recommendations: Recommendation[];

  // Completion incentive flag
  incentiveClaimed: boolean;
}

interface OnboardingActions {
  // Setup
  initWizard: (role: UserRole) => void;
  setRole: (role: UserRole) => void;

  // Navigation
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (index: number) => void;
  skipStep: (reason?: string) => void;

  // Data
  fetchOnboarding: () => Promise<void>;
  updateTask: (taskId: string, status: TaskStatus, data?: Record<string, unknown>) => Promise<void>;
  submitForReview: () => Promise<void>;

  // Analytics
  trackStepStart: (stepId: string) => void;
  trackStepComplete: (stepId: string) => void;
  trackDropOff: (stepId: string, reason?: string) => void;

  // Misc
  claimIncentive: () => void;
  reset: () => void;

  // Recommendations
  getRecommendations: () => Recommendation[];
}

export type OnboardingStore = OnboardingState & OnboardingActions;

// ─── Initial analytics ────────────────────────────────────────────────────────

function createInitialAnalytics(): OnboardingAnalytics {
  return {
    sessionId: generateSessionId(),
    variant: assignVariant(),
    role: null,
    stepsProgress: [],
    dropOffEvents: [],
    totalTimeMs: 0,
    completionRate: 0,
    startedAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useOnboardingStore = create<OnboardingStore>()(
  persist(
    (set, get) => ({
      onboarding: null,
      role: null,
      currentStepIndex: 0,
      steps: ROLE_STEP_PATHS['client'],
      isLoading: false,
      error: null,
      analytics: createInitialAnalytics(),
      recommendations: RECOMMENDATIONS,
      incentiveClaimed: false,

      // ── Setup ────────────────────────────────────────────────────────────────

      initWizard: (role) => {
        const steps = role ? ROLE_STEP_PATHS[role] : ROLE_STEP_PATHS['client'];
        set((state) => ({
          role,
          steps,
          currentStepIndex: 0,
          analytics: {
            ...state.analytics,
            role,
            stepsProgress: steps.map((s) => ({
              stepId: s,
              status: 'not_started' as const,
            })),
            lastActiveAt: new Date().toISOString(),
          },
        }));
      },

      setRole: (role) => {
        const steps = role ? ROLE_STEP_PATHS[role] : ROLE_STEP_PATHS['client'];
        set({ role, steps, currentStepIndex: 0 });
      },

      // ── Navigation ───────────────────────────────────────────────────────────

      nextStep: () => {
        const { currentStepIndex, steps } = get();
        if (currentStepIndex < steps.length - 1) {
          const nextIndex = currentStepIndex + 1;
          get().trackStepStart(steps[nextIndex]);
          set({ currentStepIndex: nextIndex });
        }
      },

      prevStep: () => {
        const { currentStepIndex } = get();
        if (currentStepIndex > 0) {
          set({ currentStepIndex: currentStepIndex - 1 });
        }
      },

      goToStep: (index) => {
        const { steps } = get();
        if (index >= 0 && index < steps.length) {
          get().trackStepStart(steps[index]);
          set({ currentStepIndex: index });
        }
      },

      skipStep: (reason) => {
        const { currentStepIndex, steps } = get();
        const stepId = steps[currentStepIndex];
        get().trackDropOff(stepId, reason ?? 'user_skipped');

        const progress = get().analytics.stepsProgress.map((sp) =>
          sp.stepId === stepId
            ? { ...sp, status: 'skipped' as const, skippedAt: new Date().toISOString() }
            : sp,
        );

        set((state) => ({
          currentStepIndex: Math.min(currentStepIndex + 1, steps.length - 1),
          analytics: { ...state.analytics, stepsProgress: progress },
        }));
      },

      // ── Data ─────────────────────────────────────────────────────────────────

      fetchOnboarding: async () => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch('/api/v1/onboarding/merchant/current-merchant-id');
          if (!res.ok) throw new Error('Failed to fetch onboarding');
          const data = await res.json();
          set({ onboarding: data.data, isLoading: false });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to fetch onboarding',
            isLoading: false,
          });
        }
      },

      updateTask: async (taskId, status, data) => {
        const { onboarding } = get();
        if (!onboarding) return;
        set({ isLoading: true, error: null });
        try {
          const res = await fetch(`/api/v1/onboarding/${onboarding.id}/task`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId, status, data }),
          });
          if (!res.ok) throw new Error('Failed to update task');
          const result = await res.json();
          set({ onboarding: result.data, isLoading: false });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to update task',
            isLoading: false,
          });
        }
      },

      submitForReview: async () => {
        const { onboarding } = get();
        if (!onboarding) return;
        set({ isLoading: true, error: null });
        try {
          const res = await fetch(`/api/v1/onboarding/${onboarding.id}/submit`, { method: 'POST' });
          if (!res.ok) throw new Error('Failed to submit for review');
          const result = await res.json();
          set({ onboarding: result.data, isLoading: false });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to submit for review',
            isLoading: false,
          });
        }
      },

      // ── Analytics ────────────────────────────────────────────────────────────

      trackStepStart: (stepId) => {
        set((state) => {
          const stepsProgress = state.analytics.stepsProgress.map((sp) =>
            sp.stepId === stepId && sp.status === 'not_started'
              ? { ...sp, status: 'in_progress' as const, startedAt: new Date().toISOString() }
              : sp,
          );
          return {
            analytics: {
              ...state.analytics,
              stepsProgress,
              lastActiveAt: new Date().toISOString(),
            },
          };
        });
      },

      trackStepComplete: (stepId) => {
        set((state) => {
          const now = new Date().toISOString();
          const stepsProgress = state.analytics.stepsProgress.map((sp) => {
            if (sp.stepId !== stepId) return sp;
            const timeSpentMs = sp.startedAt
              ? Date.now() - new Date(sp.startedAt).getTime()
              : 0;
            return { ...sp, status: 'completed' as const, completedAt: now, timeSpentMs };
          });

          const completed = stepsProgress.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
          const completionRate = stepsProgress.length > 0 ? (completed / stepsProgress.length) * 100 : 0;
          const allDone = completed === stepsProgress.length;

          return {
            analytics: {
              ...state.analytics,
              stepsProgress,
              completionRate,
              lastActiveAt: now,
              ...(allDone ? { completedAt: now } : {}),
            },
          };
        });
      },

      trackDropOff: (stepId, reason) => {
        set((state) => ({
          analytics: {
            ...state.analytics,
            dropOffEvents: [
              ...state.analytics.dropOffEvents,
              { stepId, timestamp: new Date().toISOString(), reason },
            ],
            lastActiveAt: new Date().toISOString(),
          },
        }));
      },

      // ── Misc ─────────────────────────────────────────────────────────────────

      claimIncentive: () => set({ incentiveClaimed: true }),

      reset: () => {
        set({
          onboarding: null,
          role: null,
          currentStepIndex: 0,
          steps: ROLE_STEP_PATHS['client'],
          isLoading: false,
          error: null,
          analytics: createInitialAnalytics(),
          incentiveClaimed: false,
        });
      },

      // ── Recommendations ──────────────────────────────────────────────────────

      getRecommendations: () => {
        const { role } = get();
        return RECOMMENDATIONS.filter((r) => !role || r.forRoles.includes(role)).sort((a, b) => {
          const order = { high: 0, medium: 1, low: 2 };
          return order[a.priority] - order[b.priority];
        });
      },
    }),
    {
      name: 'agenticpay-onboarding',
      storage: createJSONStorage(() => (typeof localStorage !== 'undefined' ? localStorage : sessionStorage)),
      // Only persist the essential state
      partialize: (state) => ({
        role: state.role,
        currentStepIndex: state.currentStepIndex,
        steps: state.steps,
        analytics: state.analytics,
        incentiveClaimed: state.incentiveClaimed,
        onboarding: state.onboarding,
      }),
    },
  ),
);

// ─── Selectors ────────────────────────────────────────────────────────────────

export const selectCurrentStep = (s: OnboardingStore) => s.steps[s.currentStepIndex];
export const selectProgress = (s: OnboardingStore) =>
  s.steps.length > 1 ? Math.round((s.currentStepIndex / (s.steps.length - 1)) * 100) : 0;
export const selectIsLastStep = (s: OnboardingStore) => s.currentStepIndex === s.steps.length - 1;
export const selectIsFirstStep = (s: OnboardingStore) => s.currentStepIndex === 0;
export const selectCompletionRate = (s: OnboardingStore) => s.analytics.completionRate;
export const selectVariant = (s: OnboardingStore) => s.analytics.variant;
