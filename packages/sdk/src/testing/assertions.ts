/**
 * Assertion helpers for testing SDK error handling.
 */

import { AgenticPayError } from '../errors/base.js';
import { AgenticPayApiError } from '../errors/generated.js';

/**
 * Assert that an error is an AgenticPayError with an expected HTTP status.
 *
 * @example
 *   try { await sdk.payments.get('bad'); }
 *   catch (err) { expectApiError(err, 404); }
 */
export function expectApiError(error: unknown, expectedStatus?: number): AgenticPayError {
  if (!(error instanceof AgenticPayError)) {
    throw new Error(`Expected AgenticPayError, got ${typeof error}: ${String(error)}`);
  }
  if (expectedStatus !== undefined && error.status !== expectedStatus) {
    throw new Error(
      `Expected error with status ${expectedStatus}, got ${error.status} (code: ${error.code})`,
    );
  }
  return error;
}

/**
 * Assert that an error is an AgenticPayApiError with a specific error code.
 *
 * @example
 *   try { await sdk.verification.verifyWork({...}); }
 *   catch (err) { expectApiErrorWithCode(err, 'ERR_VALIDATION_FAILED'); }
 */
export function expectApiErrorWithCode(error: unknown, expectedCode: string): AgenticPayApiError {
  if (!(error instanceof AgenticPayApiError)) {
    throw new Error(
      `Expected AgenticPayApiError, got ${typeof error}: ${String(error)}`,
    );
  }
  if (error.code !== expectedCode) {
    throw new Error(`Expected error code '${expectedCode}', got '${error.code}'`);
  }
  return error;
}
