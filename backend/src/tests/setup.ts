import { beforeAll, afterAll, vi } from 'vitest';

beforeAll(() => {
  vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
});

afterAll(() => {
  vi.restoreAllMocks();
});

export const testTimeout = 30000;