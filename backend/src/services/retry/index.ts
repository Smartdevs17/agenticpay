export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalTimeMs: number;
}

export interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half-open';
}

export interface RetryMetrics {
  totalAttempts: number;
  successfulRetries: number;
  failedRetries: number;
  averageAttempts: number;
  averageTimeMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: [
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'NETWORK_ERROR',
    'INSUFFICIENT_GAS',
    'GAS_PRICE_TOO_LOW',
    'TRANSACTION_UNDERPRICED',
  ],
};

const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,
  recoveryTimeoutMs: 60000,
  halfOpenAttempts: 3,
};

class CircuitBreaker {
  private state: CircuitBreakerState = {
    failures: 0,
    lastFailureTime: 0,
    state: 'closed',
  };
  private halfOpenSuccesses = 0;

  getState(): CircuitBreakerState {
    if (this.state.state === 'open') {
      const timeSinceLastFailure = Date.now() - this.state.lastFailureTime;
      if (timeSinceLastFailure >= CIRCUIT_BREAKER_CONFIG.recoveryTimeoutMs) {
        this.state.state = 'half-open';
        this.halfOpenSuccesses = 0;
      }
    }
    return this.state;
  }

  recordSuccess(): void {
    if (this.state.state === 'half-open') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= CIRCUIT_BREAKER_CONFIG.halfOpenAttempts) {
        this.state = { failures: 0, lastFailureTime: 0, state: 'closed' };
      }
    } else {
      this.state.failures = 0;
    }
  }

  recordFailure(): void {
    this.state.failures++;
    this.state.lastFailureTime = Date.now();
    
    if (this.state.state === 'half-open') {
      this.state.state = 'open';
    } else if (this.state.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
      this.state.state = 'open';
    }
  }

  isAvailable(): boolean {
    const currentState = this.getState();
    return currentState.state === 'closed' || currentState.state === 'half-open';
  }

  reset(): void {
    this.state = { failures: 0, lastFailureTime: 0, state: 'closed' };
    this.halfOpenSuccesses = 0;
  }
}

class RetryService {
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private metrics: Map<string, RetryMetrics> = new Map();
  private config: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  getCircuitBreaker(key: string): CircuitBreaker {
    if (!this.circuitBreakers.has(key)) {
      this.circuitBreakers.set(key, new CircuitBreaker());
    }
    return this.circuitBreakers.get(key)!;
  }

  getMetrics(key: string): RetryMetrics {
    if (!this.metrics.has(key)) {
      this.metrics.set(key, {
        totalAttempts: 0,
        successfulRetries: 0,
        failedRetries: 0,
        averageAttempts: 0,
        averageTimeMs: 0,
      });
    }
    return this.metrics.get(key)!;
  }

  private updateMetrics(key: string, success: boolean, attempts: number, timeMs: number): void {
    const m = this.getMetrics(key);
    m.totalAttempts++;
    if (success) {
      m.successfulRetries++;
    } else {
      m.failedRetries++;
    }
    m.averageAttempts = (m.averageAttempts * (m.totalAttempts - 1) + attempts) / m.totalAttempts;
    m.averageTimeMs = (m.averageTimeMs * (m.totalAttempts - 1) + timeMs) / m.totalAttempts;
  }

  isRetryableError(error: Error | string): boolean {
    const errorString = typeof error === 'string' ? error : error.message;
    return this.config.retryableErrors.some(e => errorString.includes(e));
  }

  async retry<T>(
    operation: () => Promise<T>,
    context: { type: string; id: string; priority?: number } = { type: 'default', id: 'default' },
    customConfig?: Partial<RetryConfig>
  ): Promise<RetryResult<T>> {
    const config = { ...this.config, ...customConfig };
    const circuitKey = `${context.type}:${context.id}`;
    const circuitBreaker = this.getCircuitBreaker(circuitKey);

    if (!circuitBreaker.isAvailable()) {
      return {
        success: false,
        error: new Error('Circuit breaker is open'),
        attempts: 0,
        totalTimeMs: 0,
      };
    }

    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
      try {
        const data = await operation();
        
        if (attempt > 1) {
          circuitBreaker.recordSuccess();
        }
        
        const totalTimeMs = Date.now() - startTime;
        this.updateMetrics(circuitKey, true, attempt, totalTimeMs);
        
        return {
          success: true,
          data,
          attempts: attempt,
          totalTimeMs,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (!this.isRetryableError(lastError) || attempt > config.maxRetries + 1) {
          circuitBreaker.recordFailure();
          
          const totalTimeMs = Date.now() - startTime;
          this.updateMetrics(circuitKey, false, attempt, totalTimeMs);
          
          return {
            success: false,
            error: lastError,
            attempts: attempt,
            totalTimeMs,
          };
        }

        if (attempt <= config.maxRetries + 1) {
          const delay = this.calculateBackoff(attempt, config);
          await this.sleep(delay);
        }
      }
    }

    circuitBreaker.recordFailure();
    const totalTimeMs = Date.now() - startTime;
    this.updateMetrics(circuitKey, false, config.maxRetries + 1, totalTimeMs);

    return {
      success: false,
      error: lastError,
      attempts: config.maxRetries + 1,
      totalTimeMs,
    };
  }

  private calculateBackoff(attempt: number, config: RetryConfig): number {
    const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
    const jitter = Math.random() * 0.3 * delay;
    return Math.min(Math.floor(delay + jitter), config.maxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getAllMetrics(): Map<string, RetryMetrics> {
    return new Map(this.metrics);
  }

  getCircuitBreakerStates(): Map<string, CircuitBreakerState> {
    const states = new Map<string, CircuitBreakerState>();
    for (const [key, cb] of this.circuitBreakers) {
      states.set(key, cb.getState());
    }
    return states;
  }

  resetCircuitBreaker(key: string): void {
    const circuitBreaker = this.circuitBreakers.get(key);
    if (circuitBreaker) {
      circuitBreaker.reset();
    }
  }

  resetAll(): void {
    for (const cb of this.circuitBreakers.values()) {
      cb.reset();
    }
    this.metrics.clear();
  }
}

export const retryService = new RetryService();

export function createRetryConfig(overrides: Partial<RetryConfig>): RetryConfig {
  return { ...DEFAULT_RETRY_CONFIG, ...overrides };
}