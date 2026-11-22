import { describe, it, expect, beforeEach } from 'vitest';
import {
  useOnboardingStore,
  ROLE_STEP_PATHS,
  ONBOARDING_PERSIST_VERSION,
  getResumeStepIndex,
  sanitizePersistedOnboarding,
  type StepProgress,
} from '../useOnboardingStore';

const STORAGE_KEY = 'agenticpay-onboarding';

function progress(steps: string[], done: Record<string, StepProgress['status']>): StepProgress[] {
  return steps.map((stepId) => ({ stepId, status: done[stepId] ?? 'not_started' }));
}

describe('useOnboardingStore persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    useOnboardingStore.getState().reset();
  });

  describe('getResumeStepIndex', () => {
    const steps = ROLE_STEP_PATHS.freelancer;

    it('returns the first step that is not completed or skipped', () => {
      const p = progress(steps, { welcome: 'completed', profile_setup: 'completed', skills_portfolio: 'skipped' });
      expect(getResumeStepIndex(steps, p)).toBe(3);
    });

    it('starts at the beginning with no progress', () => {
      expect(getResumeStepIndex(steps, [])).toBe(0);
    });

    it('stays on the last step when everything is done', () => {
      const p = steps.map((stepId) => ({ stepId, status: 'completed' as const }));
      expect(getResumeStepIndex(steps, p)).toBe(steps.length - 1);
    });
  });

  describe('sanitizePersistedOnboarding', () => {
    it('ignores non-object input', () => {
      expect(sanitizePersistedOnboarding(null)).toEqual({});
      expect(sanitizePersistedOnboarding('corrupt')).toEqual({});
    });

    it('drops an unknown role and resets the step index', () => {
      const result = sanitizePersistedOnboarding({ role: 'admin', currentStepIndex: 4 });
      expect(result.role).toBeNull();
      expect(result.currentStepIndex).toBe(0);
      expect(result.steps).toEqual(ROLE_STEP_PATHS.client);
    });

    it('clamps an out of range step index to the last step', () => {
      const result = sanitizePersistedOnboarding({ role: 'client', currentStepIndex: 99 });
      expect(result.currentStepIndex).toBe(ROLE_STEP_PATHS.client.length - 1);
    });

    it('rejects a non-integer step index', () => {
      expect(sanitizePersistedOnboarding({ role: 'client', currentStepIndex: 'two' }).currentStepIndex).toBe(0);
      expect(sanitizePersistedOnboarding({ role: 'client', currentStepIndex: -3 }).currentStepIndex).toBe(0);
    });

    it('always rebuilds the step list from the current role path', () => {
      const result = sanitizePersistedOnboarding({ role: 'merchant', steps: ['welcome', 'removed_step'] });
      expect(result.steps).toEqual(ROLE_STEP_PATHS.merchant);
    });

    it('keeps saved progress for known steps and discards the rest', () => {
      const result = sanitizePersistedOnboarding({
        role: 'client',
        currentStepIndex: 1,
        analytics: {
          variant: 'B',
          stepsProgress: [
            { stepId: 'welcome', status: 'completed' },
            { stepId: 'removed_step', status: 'completed' },
            { stepId: 'business_info', status: 'bogus' },
          ],
        },
      });

      expect(result.analytics?.variant).toBe('B');
      expect(result.analytics?.role).toBe('client');
      expect(result.analytics?.stepsProgress.map((s) => s.stepId)).toEqual(ROLE_STEP_PATHS.client);
      expect(result.analytics?.stepsProgress[0].status).toBe('completed');
      expect(result.analytics?.stepsProgress[1].status).toBe('not_started');
    });

    it('falls back to variant A for an unknown variant', () => {
      const result = sanitizePersistedOnboarding({ role: 'client', analytics: { variant: 'Z' } });
      expect(result.analytics?.variant).toBe('A');
    });
  });

  describe('storage round trip', () => {
    it('writes progress to localStorage with the persist version', () => {
      const store = useOnboardingStore.getState();
      store.initWizard('freelancer');
      store.trackStepComplete('welcome');
      store.nextStep();

      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
      expect(saved.version).toBe(ONBOARDING_PERSIST_VERSION);
      expect(saved.state.role).toBe('freelancer');
      expect(saved.state.currentStepIndex).toBe(1);
      expect(saved.state.isLoading).toBeUndefined();
    });

    it('restores sanitised state on rehydrate', async () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: ONBOARDING_PERSIST_VERSION,
          state: { role: 'merchant', currentStepIndex: 42, steps: ['old'], incentiveClaimed: true },
        }),
      );

      await useOnboardingStore.persist.rehydrate();
      const state = useOnboardingStore.getState();

      expect(state.role).toBe('merchant');
      expect(state.steps).toEqual(ROLE_STEP_PATHS.merchant);
      expect(state.currentStepIndex).toBe(ROLE_STEP_PATHS.merchant.length - 1);
      expect(state.incentiveClaimed).toBe(true);
    });

    it('migrates state saved before versioning', async () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 0, state: { role: 'client', currentStepIndex: -1 } }),
      );

      await useOnboardingStore.persist.rehydrate();
      const state = useOnboardingStore.getState();

      expect(state.role).toBe('client');
      expect(state.currentStepIndex).toBe(0);
    });
  });

  describe('resumeOrStart', () => {
    it('starts fresh when there is no saved progress', () => {
      useOnboardingStore.getState().resumeOrStart('merchant');
      const state = useOnboardingStore.getState();
      expect(state.role).toBe('merchant');
      expect(state.currentStepIndex).toBe(0);
      expect(state.analytics.stepsProgress).toHaveLength(ROLE_STEP_PATHS.merchant.length);
    });

    it('resumes at the first unfinished step for the same role', () => {
      const store = useOnboardingStore.getState();
      store.initWizard('client');
      store.trackStepComplete('welcome');
      store.nextStep();
      store.trackStepComplete('business_info');
      store.goToStep(0);

      useOnboardingStore.getState().resumeOrStart('client');
      expect(useOnboardingStore.getState().currentStepIndex).toBe(2);
      expect(useOnboardingStore.getState().analytics.stepsProgress[0].status).toBe('completed');
    });

    it('starts over when a different role is chosen', () => {
      const store = useOnboardingStore.getState();
      store.initWizard('client');
      store.trackStepComplete('welcome');

      useOnboardingStore.getState().resumeOrStart('freelancer');
      const state = useOnboardingStore.getState();
      expect(state.role).toBe('freelancer');
      expect(state.currentStepIndex).toBe(0);
      expect(state.analytics.stepsProgress.every((s) => s.status === 'not_started')).toBe(true);
    });
  });
});
