import { create } from 'zustand';

export interface AuthSlice {
  address: string | null;
  email?: string;
  name?: string;
  profileImage?: string;
  timezone?: string;
  loginType: 'social' | 'wallet' | null;
  isAuthenticated: boolean;
  setAuth: (data: Partial<AuthSlice>) => void;
  setTimezone: (timezone: string) => void;
  logout: () => void;
}

export const createAuthSlice = (): AuthSlice => ({
  address: null,
  email: undefined,
  name: undefined,
  profileImage: undefined,
  timezone: undefined,
  loginType: null,
  isAuthenticated: false,

  setAuth: (data) =>
    set({
      ...data,
      isAuthenticated: true,
    }),

  setTimezone: (timezone) =>
    set({
      timezone,
    }),

  logout: () =>
    set({
      address: null,
      email: undefined,
      name: undefined,
      profileImage: undefined,
      timezone: undefined,
      loginType: null,
      isAuthenticated: false,
    }),
});

export type PaymentSliceState = {
  paymentType: 'simple' | 'escrow' | 'subscription' | 'batch' | null;
  formData: Record<string, unknown>;
  isProcessing: boolean;
  errorMessage: string | null;
};

export type PaymentSliceActions = {
  setPaymentType: (type: 'simple' | 'escrow' | 'subscription' | 'batch') => void;
  updateFormData: (data: Record<string, unknown>) => void;
  setProcessing: (isProcessing: boolean) => void;
  setErrorMessage: (message: string | null) => void;
  resetPayment: () => void;
};

export type PaymentSlice = PaymentSliceState & PaymentSliceActions;

export const createPaymentSlice = (): PaymentSlice => ({
  paymentType: null,
  formData: {},
  isProcessing: false,
  errorMessage: null,

  setPaymentType: (type) => set({ paymentType: type }),
  updateFormData: (data) => set((state) => ({ formData: { ...state.formData, ...data } })),
  setProcessing: (isProcessing) => set({ isProcessing }),
  setErrorMessage: (message) => set({ errorMessage: message }),
  resetPayment: () => set({ paymentType: null, formData: {}, isProcessing: false, errorMessage: null }),
});

export type ProjectSliceState = {
  projects: Array<{ id: string; status: string }>;
  currentProjectId: string | null;
  isLoading: boolean;
};

export type ProjectSliceActions = {
  setProjects: (projects: Array<{ id: string; status: string }>) => void;
  setCurrentProject: (id: string) => void;
  setLoading: (isLoading: boolean) => void;
};

export type ProjectSlice = ProjectSliceState & ProjectSliceActions;

export const createProjectSlice = (): ProjectSlice => ({
  projects: [],
  currentProjectId: null,
  isLoading: false,

  setProjects: (projects) => set({ projects }),
  setCurrentProject: (id) => set({ currentProjectId: id }),
  setLoading: (isLoading) => set({ isLoading }),
});
