/**
 * gateway-integration.ts — Issues #1162, #1160
 *
 * Enhanced gateway integration with error classification, circuit breaking,
 * request deduplication, and payout reliability improvements.
 */

import { quotaService } from './quota.js';

export type GatewayErrorType =
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'TRANSIENT'
  | 'PERMANENT'
  | 'INVALID_REQUEST'
  | 'AUTHENTICATION'
  | 'INSUFFICIENT_BALANCE';

export interface GatewayError {
  type: GatewayErrorType;
  message: string;
  statusCode?: number;
  retryable: boolean;
  retryAfterMs?: number;
}

export interface GatewayRequest {
  id: string;
  method: string;
  payload: Record<string, unknown>;
  providerId: string;
  createdAt: number;
  expiresAt: number;
}

export interface GatewayResponse<T> {
  success: boolean;
  data?: T;
  error?: GatewayError;
  requestId: string;
  statusCode: number;
}

export class GatewayIntegrationService {
  private requestCache: Map<string, GatewayResponse<unknown>> = new Map();
  private circuitBreakers: Map<string, { open: boolean; failureCount: number; lastFailureTime: number }> = new Map();
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private readonly CIRCUIT_BREAKER_RESET_MS = 60000;
  private readonly REQUEST_DEDUP_TIMEOUT_MS = 30000;

  constructor() {
    this.initializeCircuitBreakers();
  }

  private initializeCircuitBreakers(): void {
    const providers = ['stripe', 'stellar', 'solana'];
    for (const provider of providers) {
      this.circuitBreakers.set(provider, {
        open: false,
        failureCount: 0,
        lastFailureTime: 0,
      });
    }
  }

  classifyError(error: Error, statusCode?: number): GatewayError {
    const message = error.message.toLowerCase();

    if (statusCode === 429 || message.includes('rate limit')) {
      return {
        type: 'RATE_LIMIT',
        message: 'Rate limit exceeded. Please retry after delay.',
        statusCode,
        retryable: true,
        retryAfterMs: 30000,
      };
    }

    if (statusCode === 408 || message.includes('timeout')) {
      return {
        type: 'TIMEOUT',
        message: 'Request timeout. The operation may have partially succeeded.',
        statusCode,
        retryable: true,
        retryAfterMs: 5000,
      };
    }

    if (statusCode === 401 || message.includes('unauthorized') || message.includes('authentication')) {
      return {
        type: 'AUTHENTICATION',
        message: 'Authentication failed. Check credentials.',
        statusCode,
        retryable: false,
      };
    }

    if (statusCode === 400 || message.includes('invalid')) {
      return {
        type: 'INVALID_REQUEST',
        message: 'Invalid request parameters.',
        statusCode,
        retryable: false,
      };
    }

    if (statusCode === 402 || message.includes('insufficient')) {
      return {
        type: 'INSUFFICIENT_BALANCE',
        message: 'Insufficient balance or funds.',
        statusCode,
        retryable: true,
        retryAfterMs: 3600000,
      };
    }

    if (statusCode && statusCode >= 500) {
      return {
        type: 'TRANSIENT',
        message: 'Server error. Will retry automatically.',
        statusCode,
        retryable: true,
        retryAfterMs: 10000,
      };
    }

    return {
      type: 'PERMANENT',
      message: error.message,
      statusCode,
      retryable: false,
    };
  }

  isCircuitBreakerOpen(providerId: string): boolean {
    const breaker = this.circuitBreakers.get(providerId);
    if (!breaker) return false;

    if (!breaker.open) return false;

    const timeSinceLastFailure = Date.now() - breaker.lastFailureTime;
    if (timeSinceLastFailure > this.CIRCUIT_BREAKER_RESET_MS) {
      breaker.open = false;
      breaker.failureCount = 0;
      return false;
    }

    return true;
  }

  recordFailure(providerId: string): void {
    const breaker = this.circuitBreakers.get(providerId);
    if (!breaker) return;

    breaker.failureCount++;
    breaker.lastFailureTime = Date.now();

    if (breaker.failureCount >= this.CIRCUIT_BREAKER_THRESHOLD) {
      breaker.open = true;
    }
  }

  recordSuccess(providerId: string): void {
    const breaker = this.circuitBreakers.get(providerId);
    if (breaker) {
      breaker.failureCount = Math.max(0, breaker.failureCount - 1);
    }
  }

  getCacheKey(method: string, payload: Record<string, unknown>, providerId: string): string {
    const hash = JSON.stringify({ method, payload, providerId });
    return Buffer.from(hash).toString('base64');
  }

  getCachedRequest(method: string, payload: Record<string, unknown>, providerId: string): GatewayResponse<unknown> | undefined {
    const key = this.getCacheKey(method, payload, providerId);
    const cached = this.requestCache.get(key);

    if (cached && cached.success) {
      const age = Date.now() - (cached as any).cachedAt;
      if (age < this.REQUEST_DEDUP_TIMEOUT_MS) {
        return cached;
      }
    }

    return undefined;
  }

  cacheRequest(method: string, payload: Record<string, unknown>, providerId: string, response: GatewayResponse<unknown>): void {
    const key = this.getCacheKey(method, payload, providerId);
    (response as any).cachedAt = Date.now();
    this.requestCache.set(key, response);

    // Cleanup old cache entries after 5 minutes
    if (this.requestCache.size > 1000) {
      const now = Date.now();
      for (const [k, v] of this.requestCache.entries()) {
        if (now - (v as any).cachedAt > 300000) {
          this.requestCache.delete(k);
        }
      }
    }
  }

  async executeWithErrorHandling<T>(
    providerId: string,
    method: string,
    payload: Record<string, unknown>,
    operation: () => Promise<T>
  ): Promise<GatewayResponse<T>> {
    // Check circuit breaker
    if (this.isCircuitBreakerOpen(providerId)) {
      return {
        success: false,
        error: {
          type: 'TRANSIENT',
          message: `Circuit breaker open for ${providerId}. Provider temporarily unavailable.`,
          retryable: true,
          retryAfterMs: 30000,
        },
        requestId: '',
        statusCode: 503,
      };
    }

    // Check quota
    if (!quotaService.canMakeRequest(providerId)) {
      return {
        success: false,
        error: {
          type: 'RATE_LIMIT',
          message: `Quota exceeded for ${providerId}`,
          retryable: true,
          retryAfterMs: 60000,
        },
        requestId: '',
        statusCode: 429,
      };
    }

    // Check cache for idempotent operations
    const cached = this.getCachedRequest(method, payload, providerId);
    if (cached) {
      return cached as GatewayResponse<T>;
    }

    try {
      quotaService.recordRequest(providerId);
      const data = await operation();
      const response: GatewayResponse<T> = {
        success: true,
        data,
        requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        statusCode: 200,
      };

      this.cacheRequest(method, payload, providerId, response);
      this.recordSuccess(providerId);
      return response;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const statusCode = (err as any)?.statusCode;
      const gatewayError = this.classifyError(error, statusCode);

      if (!gatewayError.retryable) {
        this.recordFailure(providerId);
      }

      return {
        success: false,
        error: gatewayError,
        requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        statusCode: statusCode || 500,
      };
    }
  }

  getCircuitBreakerStatus(providerId?: string): Record<string, { open: boolean; failureCount: number }> {
    const result: Record<string, { open: boolean; failureCount: number }> = {};

    const providers = providerId ? [providerId] : Array.from(this.circuitBreakers.keys());
    for (const provider of providers) {
      const breaker = this.circuitBreakers.get(provider);
      if (breaker) {
        result[provider] = { open: breaker.open, failureCount: breaker.failureCount };
      }
    }

    return result;
  }

  resetCircuitBreaker(providerId: string): void {
    const breaker = this.circuitBreakers.get(providerId);
    if (breaker) {
      breaker.open = false;
      breaker.failureCount = 0;
    }
  }

  clearCache(): void {
    this.requestCache.clear();
  }
}

export const gatewayIntegrationService = new GatewayIntegrationService();
