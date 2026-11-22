import { StateCreator } from 'zustand';
import type { AppStore } from '../useStore';

export interface AuthState {
  address: string | null;
  email?: string;
  name?: string;
  profileImage?: string;
  timezone?: string;
  loginType: 'social' | 'wallet' | null;
  isAuthenticated: boolean;
}

export interface AuthActions {
  setAuth: (data: Partial<AuthState>) => void;
  setTimezone: (timezone: string) => void;
  logout: () => void;
}

export type AuthSlice = AuthState & AuthActions;

export const initialAuthState: AuthState = {
  address: null,
  email: undefined,
  name: undefined,
  profileImage: undefined,
  timezone: undefined,
  loginType: null,
  isAuthenticated: false,
};

export const createAuthSlice: StateCreator<AppStore, [], [], AuthSlice> = (set) => ({
  ...initialAuthState,

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
      ...initialAuthState,
    }),
});

/* =====================================================
   Narrow Selectors
===================================================== */
export const selectAuth = (state: AppStore): AuthState => ({
  address: state.address,
  email: state.email,
  name: state.name,
  profileImage: state.profileImage,
  timezone: state.timezone,
  loginType: state.loginType,
  isAuthenticated: state.isAuthenticated,
});

export const selectIsAuthenticated = (state: AppStore): boolean => state.isAuthenticated;
export const selectUserAddress = (state: AppStore): string | null => state.address;
export const selectUserEmail = (state: AppStore): string | undefined => state.email;
export const selectUserName = (state: AppStore): string | undefined => state.name;
export const selectUserProfileImage = (state: AppStore): string | undefined => state.profileImage;
export const selectTimezone = (state: AppStore): string | undefined => state.timezone;
export const selectLoginType = (state: AppStore): 'social' | 'wallet' | null => state.loginType;

export const selectAuthActions = (state: AppStore): AuthActions => ({
  setAuth: state.setAuth,
  setTimezone: state.setTimezone,
  logout: state.logout,
});
