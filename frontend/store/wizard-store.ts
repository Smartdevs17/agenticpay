import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PaymentType = 'simple' | 'escrow' | 'subscription' | 'batch';

export interface SimplePaymentData {
  amount: string;
  currency: string;
  recipient: string;
  description: string;
}

export interface EscrowPaymentData {
  amount: string;
  currency: string;
  recipient: string;
  milestoneDescription: string;
  releaseConditions: string;
  arbitrator: string;
}

export interface SubscriptionPaymentData {
  amount: string;
  currency: string;
  recipient: string;
  interval: 'daily' | 'weekly' | 'monthly';
  maxPayments: number;
}

export interface BatchPaymentEntry {
  recipient: string;
  amount: string;
}

export interface BatchPaymentData {
  entries: BatchPaymentEntry[];
  currency: string;
}

export type PaymentFormData =
  | SimplePaymentData
  | EscrowPaymentData
  | SubscriptionPaymentData
  | BatchPaymentData;

export interface WizardState {
  currentStep: number;
  paymentType: PaymentType | null;
  formData: Partial<PaymentFormData>;
  isProcessing: boolean;
  processingStatus: 'idle' | 'processing' | 'success' | 'error';
  transactionHash: string | null;
  errorMessage: string | null;
  draftTimestamp: number | null;

  nextStep: () => void;
  prevStep: () => void;
  goToStep: (step: number) => void;
  setPaymentType: (type: PaymentType) => void;
  updateFormData: (data: Partial<PaymentFormData>) => void;
  saveDraft: () => void;
  loadDraft: () => void;
  setProcessing: (isProcessing: boolean) => void;
  setProcessingStatus: (status: 'idle' | 'processing' | 'success' | 'error') => void;
  setTransactionHash: (hash: string) => void;
  setErrorMessage: (message: string) => void;
  reset: () => void;
}

export const useWizardStore = create<WizardState>()(
  persist(
    (set, get) => ({
      currentStep: 0,
      paymentType: null,
      formData: {},
      isProcessing: false,
      processingStatus: 'idle',
      transactionHash: null,
      errorMessage: null,
      draftTimestamp: null,

      nextStep: () =>
        set((state) => ({ currentStep: Math.min(state.currentStep + 1, 3) })),

      prevStep: () =>
        set((state) => ({ currentStep: Math.max(state.currentStep - 1, 0) })),

      goToStep: (step) => set({ currentStep: step }),

      setPaymentType: (type) => set({ paymentType: type }),

      updateFormData: (data) =>
        set((state) => ({
          formData: { ...state.formData, ...data },
        })),

      saveDraft: () => {
        const { currentStep, paymentType, formData } = get();
        const draft = {
          currentStep,
          paymentType,
          formData,
          draftTimestamp: Date.now(),
        };
        try {
          localStorage.setItem(
            'agenticpay-wizard-draft',
            JSON.stringify(draft),
          );
        } catch {
          /* storage full or unavailable */
        }
      },

      loadDraft: () => {
        try {
          const raw = localStorage.getItem('agenticpay-wizard-draft');
          if (!raw) return;
          const draft = JSON.parse(raw);
          set({
            currentStep: draft.currentStep ?? 0,
            paymentType: draft.paymentType ?? null,
            formData: draft.formData ?? {},
            draftTimestamp: draft.draftTimestamp ?? null,
          });
        } catch {
          /* ignore parse errors */
        }
      },

      setProcessing: (isProcessing) => set({ isProcessing }),

      setProcessingStatus: (status) => set({ processingStatus: status }),

      setTransactionHash: (hash) => set({ transactionHash: hash }),

      setErrorMessage: (message) => set({ errorMessage: message }),

      reset: () =>
        set({
          currentStep: 0,
          paymentType: null,
          formData: {},
          isProcessing: false,
          processingStatus: 'idle',
          transactionHash: null,
          errorMessage: null,
          draftTimestamp: null,
        }),
    }),
    {
      name: 'agenticpay-wizard',
      partialize: (state) => ({
        currentStep: state.currentStep,
        paymentType: state.paymentType,
        formData: state.formData,
        draftTimestamp: state.draftTimestamp,
      }),
    },
  ),
);
