export type AuthLoginType = 'social' | 'wallet';

export interface SeededAuthUser {
  address: string;
  email?: string;
  name?: string;
  profileImage?: string;
  timezone?: string;
  loginType: AuthLoginType;
  isAuthenticated: boolean;
}

export const DEFAULT_TEST_USER: SeededAuthUser = {
  address: '0x000000000000000000000000000000000000beef',
  email: 'e2e-tester@agenticpay.test',
  name: 'E2E Tester',
  profileImage: '',
  timezone: 'UTC',
  loginType: 'social',
  isAuthenticated: true,
};

export const AUTH_STORAGE_KEY = 'agenticpay-auth';

export function buildAuthStorageValue(user: SeededAuthUser = DEFAULT_TEST_USER) {
  return JSON.stringify({
    state: {
      address: user.address,
      email: user.email,
      name: user.name,
      profileImage: user.profileImage,
      timezone: user.timezone,
      loginType: user.loginType,
      isAuthenticated: user.isAuthenticated,
    },
    version: 0,
  });
}
