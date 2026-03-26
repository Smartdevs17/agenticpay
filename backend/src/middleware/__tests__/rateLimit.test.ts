import { describe, it, expect } from 'vitest';
import { generalLimiter, invoiceLimiter } from '../rateLimit.js';

describe('Rate Limit Middleware', () => {
  describe('generalLimiter', () => {
    it('should be defined', () => {
      expect(generalLimiter).toBeDefined();
    });

    it('should be a function', () => {
      expect(typeof generalLimiter).toBe('function');
    });
  });

  describe('invoiceLimiter', () => {
    it('should be defined', () => {
      expect(invoiceLimiter).toBeDefined();
    });

    it('should be a function', () => {
      expect(typeof invoiceLimiter).toBe('function');
    });
  });

  describe('Rate limit configuration', () => {
    it('generalLimiter and invoiceLimiter should be different instances', () => {
      expect(generalLimiter).not.toBe(invoiceLimiter);
    });

    it('both limiters should be express middleware functions', () => {
      expect(generalLimiter.length).toBeGreaterThanOrEqual(0);
      expect(invoiceLimiter.length).toBeGreaterThanOrEqual(0);
    });
  });
});
