import { config } from '../config.js';

const RETRY_STORAGE_KEY = 'payment_retry_state';

interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

interface RetryState {
  attemptCounts: Record<string, number>;
  circuitBreakerFuse: Record<string, { failures: number; resetTime: number }>;
}

const defaultRetryConfig: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 5000,
  maxDelayMs: 300000,
  backoffMultiplier: 2,
  retryableErrors: [
    'TransactionFailed',
    'InsufficientBalanceFee',
    'BadSequence',
    'NoSourceAccount',
    'Trapped',
    'Connection',
    'Timeout',
    'Throttled',
  ],
};

let retryState: RetryState = {
  attemptCounts: {},
  circuitBreakerFuse: {},
};

const TRANSIENT_ERRORS = [
  'Connection',
  'Timeout',
  'Throttled',
  'TooManyRequests',
  'InternalError',
  'ServiceUnavailable',
];

function isTransientError(errorCode: string): boolean {
  return TRANSIENT_ERRORS.some((e) => errorCode.toLowerCase().includes(e.toLowerCase()));
}

function calculateBackoffDelay(attempt: number, config: RetryConfig): number {
  const delay = Math.min(
    config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt),
    config.maxDelayMs
  );
  const jitter = Math.random() * 0.3 * delay;
  return Math.floor(delay + jitter);
}

function getPaymentKey(paymentId: string, paymentType: string): string {
  return `${paymentType}:${paymentId}`;
}

async function checkCircuitBreaker(key: string, config: RetryConfig): Promise<boolean> {
  const fuse = retryState.circuitBreakerFuse[key];
  const now = Date.now();

  if (fuse && fuse.failures >= config.maxRetries && fuse.resetTime > now) {
    return false;
  }

  if (fuse && fuse.resetTime > now) {
    retryState.circuitBreakerFuse[key] = { failures: 0, resetTime: 0 };
  }

  return true;
}

function tripCircuitBreaker(key: string, resetTime: number): void {
  const current = retryState.circuitBreakerFuse[key] || { failures: 0, resetTime: 0 };
  retryState.circuitBreakerFuse[key] = {
    failures: current.failures + 1,
    resetTime,
  };
}

function resetCircuitBreaker(key: string): void {
  delete retryState.circuitBreakerFuse[key];
  delete retryState.attemptCounts[key];
}

export interface PaymentRetryOptions {
  paymentId: string;
  paymentType: string;
  executePayment: () => Promise<{ success: boolean; error?: string; txHash?: string }>;
  onRetry?: (attempt: number, error: string) => void;
  onFailure?: (error: string, txHash?: string) => void;
  retryConfig?: Partial<RetryConfig>;
}

export async function retryPayment({
  paymentId,
  paymentType,
  executePayment,
  onRetry,
  onFailure,
  retryConfig: customConfig,
}: PaymentRetryOptions): Promise<{ success: boolean; retries: number; txHash?: string; error?: string }> {
  const cfg = { ...defaultRetryConfig, ...customConfig };
  const key = getPaymentKey(paymentId, paymentType);

  if (!(await checkCircuitBreaker(key, cfg))) {
    return { success: false, retries: 0, error: 'Circuit breaker open' };
  }

  const currentAttempts = retryState.attemptCounts[key] || 0;

  if (currentAttempts >= cfg.maxRetries) {
    return { success: false, retries: currentAttempts, error: 'Max retries exceeded' };
  }

  for (let attempt = currentAttempts; attempt < cfg.maxRetries; attempt++) {
    try {
      const result = await executePayment();

      if (result.success) {
        resetCircuitBreaker(key);
        return { success: true, retries: attempt, txHash: result.txHash };
      }

      const errorIsRetryable =
        !result.error || cfg.retryableErrors.some((e) => result.error?.includes(e));

      if (!errorIsRetryable || !isTransientError(result.error || '')) {
        resetCircuitBreaker(key);
        if (onFailure) {
          onFailure(result.error || 'Unknown error', result.txHash);
        }
        return { success: false, retries: attempt, error: result.error };
      }

      retryState.attemptCounts[key] = attempt + 1;

      if (attempt < cfg.maxRetries - 1) {
        const delay = calculateBackoffDelay(attempt, cfg);
        
        if (onRetry) {
          onRetry(attempt + 1, result.error || 'Retryable error');
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (!isTransientError(errorMessage)) {
        resetCircuitBreaker(key);
        if (onFailure) {
          onFailure(errorMessage);
        }
        return { success: false, retries: attempt, error: errorMessage };
      }

      retryState.attemptCounts[key] = attempt + 1;

      if (attempt < cfg.maxRetries - 1) {
        const delay = calculateBackoffDelay(attempt, cfg);
        
        if (onRetry) {
          onRetry(attempt + 1, errorMessage);
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  tripCircuitBreaker(key, Date.now() + 300000);

  if (onFailure) {
    onFailure('Max retries exceeded');
  }

  return { success: false, retries: cfg.maxRetries, error: 'Max retries exceeded' };
}

export async function manualRetryPayment(
  paymentId: string,
  paymentType: string
): Promise<{ success: boolean; error?: string }> {
  const key = getPaymentKey(paymentId, paymentType);
  resetCircuitBreaker(key);

  const attempts = retryState.attemptCounts[key];
  if (attempts && attempts > 0) {
    return { success: true };
  }

  return { success: true };
}

export function getRetryAnalytics() {
  return {
    activeRetries: Object.keys(retryState.attemptCounts).length,
    circuitBreakersTripped: Object.values(retryState.circuitBreakerFuse).filter(
      (f) => f.failures >= defaultRetryConfig.maxRetries
    ).length,
    attemptsByPayment: { ...retryState.attemptCounts },
  };
}

export function resetRetryState(): void {
  retryState = {
    attemptCounts: {},
    circuitBreakerFuse: {},
  };
}