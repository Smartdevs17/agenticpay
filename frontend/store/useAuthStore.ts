import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  address: string | null;
  email?: string;
  name?: string;
  profileImage?: string;
  timezone?: string;
  loginType: 'social' | 'wallet' | null;
  isAuthenticated: boolean;
  setAuth: (data: Partial<AuthState>) => void;
  setTimezone: (timezone: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
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
    }),
    {
      name: 'agenticpay-auth',
    }
  )
);

