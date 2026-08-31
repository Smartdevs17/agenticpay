/**
 * Circuit breaker for external service calls.
 *
 * Resilience pattern modelled on the resilience4j design:
 *  - closed:       requests flow; a sliding window tracks outcomes.
 *  - open:         requests are rejected (fast-fail) for `waitDurationInOpenState`.
 *  - half_open:    a bounded number of trial calls is permitted after the wait
 *                  elapses; enough consecutive successes restore `closed`.
 *
 * The implementation is a pure, self-contained state machine with an injectable
 * clock so the whole lifecycle (open -> half_open -> closed) can be exercised in
 * deterministic unit tests without real sleeps. It is intentionally decoupled
 * from the Express middleware; see `middleware/circuit-breaker.ts` for the
 * backward-compatible facade used by existing callers (stripe, stellar, ...).
 */

export type CircuitBreakerState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  /** Number of most-recent call outcomes retained for the failure-rate window. */
  slidingWindowSize: number;
  /** Minimum number of calls within the window before the rate can trip the breaker. */
  minimumCallsToOpen: number;
  /** Failure rate (0-100) above which the breaker opens once the window is saturated. */
  failureRateThreshold: number;
  /** Consecutive-failure threshold; opens the breaker early regardless of window size. */
  failureThreshold: number;
  /** Consecutive-success threshold required in half_open before re-closing. */
  successThreshold: number;
  /** Time (ms) the breaker stays open before transitioning to half_open. */
  waitDurationInOpenState: number;
  /** Max calls admitted while in half_open. */
  permittedNumberOfCallsInHalfOpenState: number;
  /** Per-call timeout (ms). Overrides on a per-call basis via protect(..., timeoutMs). */
  requestTimeoutMs: number;
  /** When true and the breaker has no recorded history, requests are rejected by default. */
  failClosed: boolean;
  /** Error classes/functions whose thrown results count as failures (plus any error by default). */
  recordFailure?: (err: unknown) => boolean;
  /** Error classes/functions to skip (not counted as a success or failure). */
  ignoreFailures?: (err: unknown) => boolean;
}

export interface CircuitBreakerMetrics {
  calls: number;
  successfulCalls: number;
  failedCalls: number;
  timeoutCalls: number;
  rejectedCalls: number;
  halfOpenAttempts: number;
  openedAt?: number;
  state: CircuitBreakerState;
  failureRate: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
}

export interface CircuitBreakerSnapshot {
  name: string;
  state: CircuitBreakerState;
  failures: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  permittedCallsInHalfOpen: number;
  config: Readonly<CircuitBreakerConfig>;
  metrics: Readonly<CircuitBreakerMetrics>;
  wokenAt?: number;
  openedAt?: number;
}

/** Thrown when a call is short-circuited because the breaker is open. */
export class CircuitBreakerError extends Error {
  readonly serviceName: string;
  readonly isTimeout: boolean;

  constructor(serviceName: string, message: string, isTimeout = false) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.serviceName = serviceName;
    this.isTimeout = isTimeout;
  }
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  slidingWindowSize: 20,
  minimumCallsToOpen: 5,
  failureRateThreshold: 50,
  failureThreshold: 5,
  successThreshold: 2,
  waitDurationInOpenState: 60_000,
  permittedNumberOfCallsInHalfOpenState: 3,
  requestTimeoutMs: 10_000,
  failClosed: false,
};

/**
 * A single, isolated circuit. One instance guards one logical external service.
 * Create instances via a registry or directly; they share no state with each
 * other, which is a deliberate security boundary (a flapping service cannot
 * trip the breaker of an unrelated service).
 */
export class CircuitBreaker {
  readonly name: string;
  readonly config: CircuitBreakerConfig;
  /** Injectable time source so tests can advance the clock deterministically. */
  private now: () => number;

  private state: CircuitBreakerState = 'closed';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private permittedCallsInHalfOpen = 0;
  private reopenedAt?: number;
  private wokenAt?: number;
  private openedAt?: number;

  /** Sliding window of recent outcomes (true = success). */
  private outcomes: boolean[] = [];

  private metrics: CircuitBreakerMetrics = {
    calls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    timeoutCalls: 0,
    rejectedCalls: 0,
    halfOpenAttempts: 0,
    state: 'closed',
    failureRate: 0,
  };

  private onStateChangeListeners: Array<(from: CircuitBreakerState, to: CircuitBreakerState) => void> = [];

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}, now: () => number = Date.now) {
    if (!name || !name.trim()) throw new Error('CircuitBreaker requires a non-empty name');
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.now = now;

    if (this.config.slidingWindowSize < 1) throw new Error('slidingWindowSize must be >= 1');
    if (this.config.failureRateThreshold < 0 || this.config.failureRateThreshold > 100) {
      throw new Error('failureRateThreshold must be between 0 and 100');
    }
  }

  /** Determine whether a call is permitted right now. */
  isCallPermitted(): boolean {
    switch (this.state) {
      case 'closed':
        return true;
      case 'open': {
        const opened = this.openedAt ?? this.now();
        if (this.now() - opened >= this.config.waitDurationInOpenState) {
          this.transitionToHalfOpen();
          return this.permitHalfOpenCall();
        }
        this.metrics.rejectedCalls++;
        return false;
      }
      case 'half_open':
        return this.permitHalfOpenCall();
    }
  }

  private permitHalfOpenCall(): boolean {
    if (this.permittedCallsInHalfOpen < this.config.permittedNumberOfCallsInHalfOpenState) {
      this.permittedCallsInHalfOpen++;
      this.metrics.halfOpenAttempts++;
      return true;
    }
    this.metrics.rejectedCalls++;
    return false;
  }

  private transitionToHalfOpen(): void {
    if (this.state !== 'half_open') {
      this.setState('half_open');
    }
    this.wokenAt = this.now();
    this.permittedCallsInHalfOpen = 0;
    this.consecutiveSuccesses = 0;
  }

  private transitionToOpen(): void {
    if (this.state !== 'open') {
      this.setState('open');
    }
    this.openedAt = this.now();
    this.reopenedAt = this.now();
    this.metrics.openedAt = this.now();
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.permittedCallsInHalfOpen = 0;
  }

  private transitionToClosed(): void {
    if (this.state !== 'closed') {
      this.setState('closed');
    }
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.permittedCallsInHalfOpen = 0;
    this.openedAt = undefined;
    this.wokenAt = undefined;
    this.outcomes = [];
  }

  private setState(next: CircuitBreakerState): void {
    if (this.state === next) return;
    const previous = this.state;
    this.state = next;
    this.metrics.state = next;
    for (const listener of this.onStateChangeListeners) {
      try {
        listener(previous, next);
      } catch {
        // Listener failures must never break the breaker.
      }
    }
  }

  /** Register a state-change observer (for logging, metrics, alerts). */
  onStateChange(listener: (from: CircuitBreakerState, to: CircuitBreakerState) => void): () => void {
    this.onStateChangeListeners.push(listener);
    return () => {
      const i = this.onStateChangeListeners.indexOf(listener);
      if (i >= 0) this.onStateChangeListeners.splice(i, 1);
    };
  }

  /** Record a successful call outcome. */
  recordSuccess(): void {
    this.metrics.calls++;
    this.metrics.successfulCalls++;
    this.metrics.lastSuccessAt = this.now();
    this.recordOutcome(true);

    if (this.state === 'half_open') {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.transitionToClosed();
      }
    } else if (this.state === 'closed') {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
    }
  }

  /**
   * Record a failure. `err` is used to honor `ignoreFailures` / `recordFailure`;
   * when the error is a timeout it is also tagged in the metrics.
   */
  recordFailure(err: unknown, isTimeout = false): void {
    if (this.config.ignoreFailures?.(err)) {
      return;
    }
    if (this.config.recordFailure && !this.config.recordFailure(err)) {
      // Caller opted to not count this as a short-circuit driver, but it is
      // still an observable call for metrics.
      this.metrics.calls++;
      this.metrics.failedCalls++;
      this.metrics.lastFailureAt = this.now();
      return;
    }

    this.metrics.calls++;
    this.metrics.failedCalls++;
    this.metrics.lastFailureAt = this.now();
    if (isTimeout) this.metrics.timeoutCalls++;
    this.recordOutcome(false);

    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;

    if (this.state === 'half_open') {
      this.transitionToOpen();
      return;
    }
    if (this.state === 'closed') {
      if (this.consecutiveFailures >= this.config.failureThreshold) {
        this.transitionToOpen();
        return;
      }
      if (this.shouldTripByFailureRate()) {
        this.transitionToOpen();
      }
    }
  }

  private recordOutcome(success: boolean): void {
    this.outcomes.push(success);
    if (this.outcomes.length > this.config.slidingWindowSize) {
      this.outcomes.shift();
    }
    this.recomputeFailureRate();
  }

  private shouldTripByFailureRate(): boolean {
    const window = this.outcomes;
    if (window.length < this.config.minimumCallsToOpen) return false;
    const failed = window.filter((o) => !o).length;
    return (failed / window.length) * 100 >= this.config.failureRateThreshold;
  }

  private recomputeFailureRate(): void {
    if (this.outcomes.length === 0) {
      this.metrics.failureRate = 0;
      return;
    }
    const failed = this.outcomes.filter((o) => !o).length;
    this.metrics.failureRate = Math.round((failed / this.outcomes.length) * 100);
  }

  /**
   * Execute `fn` guarded by the breaker. When the breaker is open and `fallback`
   * is provided, the fallback is invoked instead of throwing. Otherwise a
   * `CircuitBreakerError` is thrown while the breaker is open.
   */
  async protect<T>(fn: () => Promise<T> | T, fallback?: () => Promise<T> | T, requestTimeoutMs?: number): Promise<T> {
    if (!this.isCallPermitted()) {
      if (fallback) return fallback();
      throw new CircuitBreakerError(this.name, `Circuit ${this.name} is open`);
    }

    const timeoutMs = requestTimeoutMs ?? this.config.requestTimeoutMs;
    if (timeoutMs <= 0) {
      return this.runCall<T>(fn, fallback);
    }

    let timedOut = false;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        timedOut = true;
        reject(new CircuitBreakerError(this.name, `Call to ${this.name} timed out after ${timeoutMs}ms`, true));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([Promise.resolve().then(() => fn()), timeoutPromise]);
      this.recordSuccess();
      return result;
    } catch (error) {
      if (error instanceof CircuitBreakerError && (error as CircuitBreakerError).isTimeout && timedOut) {
        this.recordFailure(error, true);
        if (fallback) return fallback();
        throw error;
      }
      if (error instanceof CircuitBreakerError) {
        // User thrown CircuitBreakerError was not a real timeout (e.g. from fallback path) — rethrow.
        throw error;
      }
      this.recordFailure(error, false);
      if (fallback) return fallback();
      throw error;
    }
  }

  private async runCall<T>(fn: () => Promise<T> | T, fallback?: () => Promise<T> | T): Promise<T> {
    try {
      const result = await Promise.resolve().then(() => fn());
      this.recordSuccess();
      return result;
    } catch (error) {
      if (error instanceof CircuitBreakerError) {
        // A nested/foreign breaker's rejection is not this circuit's failure.
        throw error;
      }
      this.recordFailure(error, false);
      if (fallback) return fallback();
      throw error;
    }
  }

  /** Force the breaker back to a closed state and clear history/metrics. */
  reset(): void {
    this.outcomes = [];
    this.transitionToClosed();
    this.metrics.calls = 0;
    this.metrics.successfulCalls = 0;
    this.metrics.failedCalls = 0;
    this.metrics.timeoutCalls = 0;
    this.metrics.rejectedCalls = 0;
    this.metrics.halfOpenAttempts = 0;
    this.metrics.openedAt = undefined;
    this.metrics.lastFailureAt = undefined;
    this.metrics.lastSuccessAt = undefined;
    this.metrics.failureRate = 0;
  }

  /** Reset outcome history + metrics but keep the current state. */
  resetMetrics(): void {
    this.outcomes = [];
    this.recomputeFailureRate();
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
  }

  /** Serialisable snapshot for observability and the management API. */
  snapshot(): CircuitBreakerSnapshot {
    return {
      name: this.name,
      state: this.state,
      failures: this.consecutiveFailures,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      permittedCallsInHalfOpen: this.config.permittedNumberOfCallsInHalfOpenState - this.permittedCallsInHalfOpen,
      config: { ...this.config },
      metrics: { ...this.metrics },
      openedAt: this.openedAt,
      wokenAt: this.wokenAt,
    };
  }
}

export { DEFAULT_CONFIG };
