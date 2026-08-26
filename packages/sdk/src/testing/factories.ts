/**
 * Factory functions for creating test clients and SDK instances.
 */

import { AgenticPaySDK } from '../index.js';
import { AgenticPayClient } from '../client.js';
import type { AgenticPayClientOptions } from '../types.js';

export type TestClientOptions = Partial<AgenticPayClientOptions> & {
  baseUrl?: string;
  apiKey?: string;
};

/**
 * Create a test client pointed at a mock server.
 */
export function createTestClient(options: TestClientOptions = {}): AgenticPayClient {
  return new AgenticPayClient({
    baseUrl: options.baseUrl ?? 'http://127.0.0.1:0/api/v1',
    apiKey: options.apiKey ?? 'test_api_key',
    timeoutMs: options.timeoutMs ?? 5000,
    retry: options.retry ?? { attempts: 0, baseDelayMs: 0 },
  });
}

/**
 * Create a test SDK instance pointed at a mock server.
 */
export function createTestSDK(options: TestClientOptions = {}): AgenticPaySDK {
  return new AgenticPaySDK({
    baseUrl: options.baseUrl ?? 'http://127.0.0.1:0/api/v1',
    apiKey: options.apiKey ?? 'test_api_key',
    timeoutMs: options.timeoutMs ?? 5000,
    retry: options.retry ?? { attempts: 0, baseDelayMs: 0 },
  });
}
