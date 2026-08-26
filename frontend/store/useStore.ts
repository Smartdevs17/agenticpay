import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createAuthSlice, createPaymentSlice, createProjectSlice } from './slices';

type AuthSlice = ReturnType<typeof createAuthSlice>;
type PaymentSlice = ReturnType<typeof createPaymentSlice>;
type ProjectSlice = ReturnType<typeof createProjectSlice>;

interface AppStore extends AuthSlice, PaymentSlice, ProjectSlice {}

export const useStore = create<AppStore>()(
  persist(
    (...args) => ({
      ...createAuthSlice(),
      ...createPaymentSlice(),
      ...createProjectSlice(),
    }),
    {
      name: 'agenticpay-store',
      partialize: (state) => ({
        address: state.address,
        email: state.email,
        name: state.name,
        loginType: state.loginType,
        isAuthenticated: state.isAuthenticated,
        paymentType: state.paymentType,
        formData: state.formData,
      }),
    }
  )
);
