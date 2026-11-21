/**
 * errors.test.ts — Issue #719
 *
 * Verifies every domain error extends AppError, so the central error
 * handler's `err instanceof AppError` check recognizes them and preserves
 * their statusCode/code/message/details instead of downgrading them to a
 * generic 500.
 */
import { describe, it, expect } from 'vitest';
import {
  AppError,
  PaymentError,
  AuthError,
  ProjectError,
  DisputeError,
  NotFoundError,
  ValidationError,
} from '../errors.js';

describe('domain error hierarchy', () => {
  it.each([
    ['PaymentError', PaymentError, 'PAYMENT_ERROR', 400],
    ['AuthError', AuthError, 'AUTH_ERROR', 401],
    ['ProjectError', ProjectError, 'PROJECT_ERROR', 400],
    ['DisputeError', DisputeError, 'DISPUTE_ERROR', 400],
    ['NotFoundError', NotFoundError, 'NOT_FOUND', 404],
    ['ValidationError', ValidationError, 'VALIDATION_ERROR', 422],
  ] as const)('%s is an AppError with the expected default code/statusCode', (_name, ErrorClass, defaultCode, defaultStatus) => {
    const err = new ErrorClass('something went wrong');

    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(defaultCode);
    expect(err.statusCode).toBe(defaultStatus);
    expect(err.message).toBe('something went wrong');
  });

  it('allows overriding code, statusCode, and metadata', () => {
    const err = new PaymentError('Insufficient funds', 'ERR_PAYMENT_INSUFFICIENT_FUNDS', 402, { available: 10 });

    expect(err.code).toBe('ERR_PAYMENT_INSUFFICIENT_FUNDS');
    expect(err.statusCode).toBe(402);
    expect(err.metadata).toEqual({ available: 10 });
  });
});
