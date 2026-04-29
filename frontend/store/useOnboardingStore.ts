import { create } from 'zustand';
import { MerchantOnboarding, OnboardingTask, TaskStatus } from '@/lib/types/onboarding';

interface OnboardingState {
  onboarding: MerchantOnboarding | null;
  currentStep: number;
  isLoading: boolean;
  error: string | null;
  fetchOnboarding: () => Promise<void>;
  updateTask: (taskId: string, status: TaskStatus, data?: any) => Promise<void>;
  submitForReview: () => Promise<void>;
  setCurrentStep: (step: number) => void;
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  onboarding: null,
  currentStep: 0,
  isLoading: false,
  error: null,

  fetchOnboarding: async () => {
    set({ isLoading: true, error: null });
    try {
      // TODO: Replace with actual API call
      const response = await fetch('/api/v1/onboarding/merchant/current-merchant-id');
      if (!response.ok) {
        throw new Error('Failed to fetch onboarding');
      }
      const data = await response.json();
      set({ onboarding: data.data, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch onboarding',
        isLoading: false
      });
    }
  },

  updateTask: async (taskId: string, status: TaskStatus, data?: any) => {
    const { onboarding } = get();
    if (!onboarding) return;

    set({ isLoading: true, error: null });
    try {
      const response = await fetch(`/api/v1/onboarding/${onboarding.id}/task`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          taskId,
          status,
          data,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update task');
      }

      const result = await response.json();
      set({ onboarding: result.data, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to update task',
        isLoading: false
      });
    }
  },

  submitForReview: async () => {
    const { onboarding } = get();
    if (!onboarding) return;

    set({ isLoading: true, error: null });
    try {
      const response = await fetch(`/api/v1/onboarding/${onboarding.id}/submit`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to submit for review');
      }

      const result = await response.json();
      set({ onboarding: result.data, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to submit for review',
        isLoading: false
      });
    }
  },

  setCurrentStep: (step: number) => {
    set({ currentStep: step });
  },
}));