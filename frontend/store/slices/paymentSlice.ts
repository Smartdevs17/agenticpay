import { StateCreator } from 'zustand';
import type { AppStore } from '../useStore';

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

export const initialPaymentState: PaymentSliceState = {
  paymentType: null,
  formData: {},
  isProcessing: false,
  errorMessage: null,
};

export const createPaymentSlice: StateCreator<AppStore, [], [], PaymentSlice> = (set) => ({
  ...initialPaymentState,

  setPaymentType: (type) => set({ paymentType: type }),
  updateFormData: (data) => set((state) => ({ formData: { ...state.formData, ...data } })),
  setProcessing: (isProcessing) => set({ isProcessing }),
  setErrorMessage: (message) => set({ errorMessage: message }),
  resetPayment: () => set({ ...initialPaymentState }),
});

/* =====================================================
   Narrow Selectors
===================================================== */
export const selectPaymentState = (state: AppStore): PaymentSliceState => ({
  paymentType: state.paymentType,
  formData: state.formData,
  isProcessing: state.isProcessing,
  errorMessage: state.errorMessage,
});

export const selectPaymentType = (state: AppStore): 'simple' | 'escrow' | 'subscription' | 'batch' | null =>
  state.paymentType;

export const selectPaymentFormData = (state: AppStore): Record<string, unknown> =>
  state.formData;

export const selectIsPaymentProcessing = (state: AppStore): boolean =>
  state.isProcessing;

export const selectPaymentErrorMessage = (state: AppStore): string | null =>
  state.errorMessage;

export const selectPaymentActions = (state: AppStore): PaymentSliceActions => ({
  setPaymentType: state.setPaymentType,
  updateFormData: state.updateFormData,
  setProcessing: state.setProcessing,
  setErrorMessage: state.setErrorMessage,
  resetPayment: state.resetPayment,
});
