'use client';

/**
 * useOnboardingStore.ts — Issue #591
 *
 * Onboarding state with:
 * - Multi-step wizard with role-based paths (freelancer vs client)
 * - Progress persistence across sessions (localStorage via Zustand persist),
 *   versioned and sanitised on rehydrate so stale or tampered state can't
 *   strand the wizard on a step that no longer exists (#1372)
 * - Resume at the first unfinished step when the same role comes back
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
  /** Resume saved progress for this role, or start fresh if there is none. */
  resumeOrStart: (role: NonNullable<UserRole>) => void;
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

// ─── Persistence helpers ──────────────────────────────────────────────────────

export const ONBOARDING_PERSIST_VERSION = 1;

const ROLES = Object.keys(ROLE_STEP_PATHS) as NonNullable<UserRole>[];
const STEP_STATUSES: StepProgress['status'][] = ['not_started', 'in_progress', 'completed', 'skipped'];

type PersistedOnboarding = Pick<
  OnboardingState,
  'role' | 'currentStepIndex' | 'steps' | 'analytics' | 'incentiveClaimed' | 'onboarding'
>;

/** Index of the first step that is neither completed nor skipped. */
export function getResumeStepIndex(steps: string[], progress: StepProgress[]): number {
  const done = new Set(
    progress.filter((p) => p.status === 'completed' || p.status === 'skipped').map((p) => p.stepId),
  );
  const index = steps.findIndex((step) => !done.has(step));
  return index === -1 ? Math.max(steps.length - 1, 0) : index;
}

/**
 * Rebuild persisted onboarding state against the current step paths. Unknown
 * roles are dropped, the step list always comes from ROLE_STEP_PATHS, progress
 * for steps that no longer exist is discarded and the step index is clamped.
 */
export function sanitizePersistedOnboarding(persisted: unknown): Partial<PersistedOnboarding> {
  if (!persisted || typeof persisted !== 'object') return {};
  const raw = persisted as Partial<PersistedOnboarding>;

  const role = ROLES.includes(raw.role as NonNullable<UserRole>) ? (raw.role as NonNullable<UserRole>) : null;
  const steps = ROLE_STEP_PATHS[role ?? 'client'];

  const rawIndex = Number(raw.currentStepIndex);
  const currentStepIndex = Number.isInteger(rawIndex)
    ? Math.min(Math.max(rawIndex, 0), steps.length - 1)
    : 0;

  const result: Partial<PersistedOnboarding> = {
    role,
    steps,
    currentStepIndex: role ? currentStepIndex : 0,
    incentiveClaimed: raw.incentiveClaimed === true,
    onboarding: raw.onboarding ?? null,
  };

  const analytics = raw.analytics;
  if (analytics && typeof analytics === 'object') {
    const saved = new Map(
      (Array.isArray(analytics.stepsProgress) ? analytics.stepsProgress : [])
        .filter((sp) => sp && steps.includes(sp.stepId) && STEP_STATUSES.includes(sp.status))
        .map((sp) => [sp.stepId, sp] as const),
    );
    result.analytics = {
      ...createInitialAnalytics(),
      ...analytics,
      variant: analytics.variant === 'B' ? 'B' : 'A',
      role,
      stepsProgress: role ? steps.map((stepId) => saved.get(stepId) ?? { stepId, status: 'not_started' }) : [],
      dropOffEvents: Array.isArray(analytics.dropOffEvents) ? analytics.dropOffEvents : [],
    };
  }

  return result;
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

      resumeOrStart: (role) => {
        const { role: savedRole, analytics } = get();
        const hasProgress = analytics.stepsProgress.some((sp) => sp.status !== 'not_started');
        if (savedRole !== role || !hasProgress) {
          get().initWizard(role);
          return;
        }
        const steps = ROLE_STEP_PATHS[role];
        set({ steps, currentStepIndex: getResumeStepIndex(steps, analytics.stepsProgress) });
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
      version: ONBOARDING_PERSIST_VERSION,
      migrate: (persisted) => sanitizePersistedOnboarding(persisted) as OnboardingStore,
      merge: (persisted, current) => ({ ...current, ...sanitizePersistedOnboarding(persisted) }),
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
