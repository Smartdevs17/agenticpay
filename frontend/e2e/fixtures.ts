import { test as base, expect, type Page } from '@playwright/test';
import {
  AUTH_STORAGE_KEY,
  buildAuthStorageValue,
  DEFAULT_TEST_USER,
  type SeededAuthUser,
} from './helpers/test-data';
import {
  cleanupTestState,
  mockOnboardingApi,
  mockSandboxPaymentsApi,
} from './helpers/api-mocks';

type Fixtures = {
  seedAuth: (user?: SeededAuthUser) => Promise<void>;
  authenticatedPage: Page;
  withOnboardingMocks: void;
  withPaymentMocks: void;
};

export const test = base.extend<Fixtures>({
  seedAuth: async ({ page, baseURL }, use) => {
    await use(async (user: SeededAuthUser = DEFAULT_TEST_USER) => {
      if (!baseURL) throw new Error('baseURL is required to seed auth');

      await page.addInitScript(
        ({ key, value }) => {
          try {
            window.localStorage.setItem(key, value);
          } catch {
            // swallow — some contexts (file://) reject storage writes
          }
        },
        { key: AUTH_STORAGE_KEY, value: buildAuthStorageValue(user) },
      );
    });
  },

  authenticatedPage: async ({ page, seedAuth }, use) => {
    await seedAuth();
    await use(page);
    await cleanupTestState(page);
  },

  withOnboardingMocks: async ({ page }, use) => {
    await mockOnboardingApi(page);
    await use();
  },

  withPaymentMocks: async ({ page }, use) => {
    await mockSandboxPaymentsApi(page);
    await use();
  },
});

export { expect };
