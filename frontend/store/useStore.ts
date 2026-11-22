import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type AuthSlice,
  type PaymentSlice,
  type ProjectSlice,
  createAuthSlice,
  createPaymentSlice,
  createProjectSlice,
  selectIsAuthenticated,
  selectUserAddress,
  selectUserEmail,
  selectUserName,
  selectUserProfileImage,
  selectTimezone,
  selectLoginType,
  selectAuthActions,
  selectPaymentType,
  selectPaymentFormData,
  selectIsPaymentProcessing,
  selectPaymentErrorMessage,
  selectPaymentActions,
  selectProjects,
  selectCurrentProjectId,
  selectIsProjectsLoading,
  selectProjectActions,
} from './slices';

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

/* =====================================================
   Narrow Selector Hooks (Issue #1406)
   Components subscribe ONLY to the slice or field they need,
   avoiding unneeded re-renders on unrelated slice changes.
===================================================== */

/** Hook to select any custom slice/field with optional equality comparison */
export function useAppSelector<T>(
  selector: (state: AppStore) => T,
  equalityFn?: (a: T, b: T) => boolean
): T {
  return useStore((state) => selector(state));
}

// ── Auth Narrow Hooks ─────────────────────────────────
export const useIsAuthenticated = () => useStore(selectIsAuthenticated);
export const useUserAddress = () => useStore(selectUserAddress);
export const useUserEmail = () => useStore(selectUserEmail);
export const useUserName = () => useStore(selectUserName);
export const useUserProfileImage = () => useStore(selectUserProfileImage);
export const useTimezone = () => useStore(selectTimezone);
export const useLoginType = () => useStore(selectLoginType);
export const useAuthActions = () => useStore(selectAuthActions);

// ── Payment Narrow Hooks ──────────────────────────────
export const usePaymentType = () => useStore(selectPaymentType);
export const usePaymentFormData = () => useStore(selectPaymentFormData);
export const useIsPaymentProcessing = () => useStore(selectIsPaymentProcessing);
export const usePaymentErrorMessage = () => useStore(selectPaymentErrorMessage);
export const usePaymentActions = () => useStore(selectPaymentActions);

// ── Project Narrow Hooks ──────────────────────────────
export const useProjects = () => useStore(selectProjects);
export const useCurrentProjectId = () => useStore(selectCurrentProjectId);
export const useIsProjectsLoading = () => useStore(selectIsProjectsLoading);
export const useProjectActions = () => useStore(selectProjectActions);
