import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AuthSlice, PaymentSlice, ProjectSlice, createAuthSlice, createPaymentSlice, createProjectSlice } from './slices';

export interface AppStore extends AuthSlice, PaymentSlice, ProjectSlice {}

export const useStore = create<AppStore>()(
  persist(
    (...args) => ({
      ...createAuthSlice(...args),
      ...createPaymentSlice(...args),
      ...createProjectSlice(...args),
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
