import { describe, it, expect, beforeEach } from 'vitest';
import {
  useOnboardingStore,
  ROLE_STEP_PATHS,
  selectCurrentStep,
  selectProgress,
  selectIsLastStep,
  selectIsFirstStep,
  selectCompletionRate,
  selectVariant,
} from '../useOnboardingStore';

describe('useOnboardingStore', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
  });

  it('initializes wizard with role-specific step paths', () => {
    const store = useOnboardingStore.getState();

    store.initWizard('freelancer');
    expect(useOnboardingStore.getState().role).toBe('freelancer');
    expect(useOnboardingStore.getState().steps).toEqual(ROLE_STEP_PATHS.freelancer);
    expect(useOnboardingStore.getState().currentStepIndex).toBe(0);

    store.initWizard('merchant');
    expect(useOnboardingStore.getState().role).toBe('merchant');
    expect(useOnboardingStore.getState().steps).toEqual(ROLE_STEP_PATHS.merchant);
  });

  it('advances through steps with nextStep and tracks step start', () => {
    const store = useOnboardingStore.getState();
    store.initWizard('client');

    expect(useOnboardingStore.getState().currentStepIndex).toBe(0);
    expect(selectCurrentStep(useOnboardingStore.getState())).toBe('welcome');
    expect(selectIsFirstStep(useOnboardingStore.getState())).toBe(true);

    useOnboardingStore.getState().nextStep();
    expect(useOnboardingStore.getState().currentStepIndex).toBe(1);
    expect(selectCurrentStep(useOnboardingStore.getState())).toBe('business_info');
    expect(selectIsFirstStep(useOnboardingStore.getState())).toBe(false);

    // Prev step
    useOnboardingStore.getState().prevStep();
    expect(useOnboardingStore.getState().currentStepIndex).toBe(0);
  });

  it('allows skipping a step and records drop-off reason', () => {
    const store = useOnboardingStore.getState();
    store.initWizard('client');

    useOnboardingStore.getState().skipStep('not_relevant');
    const state = useOnboardingStore.getState();

    expect(state.currentStepIndex).toBe(1);
    expect(state.analytics.dropOffEvents).toHaveLength(1);
    expect(state.analytics.dropOffEvents[0].stepId).toBe('welcome');
    expect(state.analytics.dropOffEvents[0].reason).toBe('not_relevant');

    const skippedProgress = state.analytics.stepsProgress.find((s) => s.stepId === 'welcome');
    expect(skippedProgress?.status).toBe('skipped');
  });

  it('computes progress percentage accurately', () => {
    useOnboardingStore.getState().initWizard('client');
    const stepsCount = ROLE_STEP_PATHS.client.length;

    expect(selectProgress(useOnboardingStore.getState())).toBe(0);

    useOnboardingStore.getState().goToStep(stepsCount - 1);
    expect(selectProgress(useOnboardingStore.getState())).toBe(100);
    expect(selectIsLastStep(useOnboardingStore.getState())).toBe(true);
  });

  it('tracks step completion and calculates completion rate', () => {
    useOnboardingStore.getState().initWizard('client');
    const steps = ROLE_STEP_PATHS.client;

    useOnboardingStore.getState().trackStepComplete(steps[0]);
    let state = useOnboardingStore.getState();
    expect(selectCompletionRate(state)).toBeCloseTo((1 / steps.length) * 100);

    useOnboardingStore.getState().trackStepComplete(steps[1]);
    state = useOnboardingStore.getState();
    expect(selectCompletionRate(state)).toBeCloseTo((2 / steps.length) * 100);
  });

  it('filters and sorts recommendations by priority and role', () => {
    useOnboardingStore.getState().initWizard('freelancer');
    const recs = useOnboardingStore.getState().getRecommendations();

    expect(recs.length).toBeGreaterThan(0);
    // Should be sorted high -> medium -> low
    const priorities = recs.map((r) => r.priority);
    const highIdx = priorities.indexOf('high');
    const lowIdx = priorities.indexOf('low');
    if (highIdx !== -1 && lowIdx !== -1) {
      expect(highIdx).toBeLessThan(lowIdx);
    }
  });

  it('claims incentive and resets state', () => {
    expect(useOnboardingStore.getState().incentiveClaimed).toBe(false);
    useOnboardingStore.getState().claimIncentive();
    expect(useOnboardingStore.getState().incentiveClaimed).toBe(true);

    useOnboardingStore.getState().reset();
    expect(useOnboardingStore.getState().role).toBeNull();
    expect(useOnboardingStore.getState().incentiveClaimed).toBe(false);
  });

  it('assigns and selects A/B test variant', () => {
    const variant = selectVariant(useOnboardingStore.getState());
    expect(['A', 'B']).toContain(variant);
  });
});
