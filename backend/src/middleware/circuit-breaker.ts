import type { NextFunction, Request, Response } from 'express';

type CircuitState = 'closed' | 'open' | 'half_open';

interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
  halfOpenMaxCalls: number;
  requestTimeoutMs: number;
}

interface CircuitBreakerMetrics {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  timeoutCalls: number;
  rejectedCalls: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  openedAt?: number;
  halfOpenAttempts: number;
}

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  halfOpenCalls: number;
  lastFailureAt?: number;
  openedAt?: number;
  metrics: CircuitBreakerMetrics;
}

interface CircuitBreakerEntry {
  config: CircuitBreakerConfig;
  state: CircuitBreakerState;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeoutMs: 60_000,
  halfOpenMaxCalls: 3,
  requestTimeoutMs: 10_000,
};

const circuits = new Map<string, CircuitBreakerEntry>();

function getOrCreate(name: string, configOverride?: Partial<CircuitBreakerConfig>): CircuitBreakerEntry {
  const existing = circuits.get(name);
  if (existing) return existing;
  const config = { ...DEFAULT_CONFIG, ...configOverride };
  const state: CircuitBreakerState = {
    state: 'closed',
    failures: 0,
    successes: 0,
    halfOpenCalls: 0,
    metrics: {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      timeoutCalls: 0,
      rejectedCalls: 0,
      halfOpenAttempts: 0,
    },
  };
  const entry: CircuitBreakerEntry = { config, state };
  circuits.set(name, entry);
  return entry;
}

function onSuccess(name: string): void {
  const entry = circuits.get(name);
  if (!entry) return;
  const { state, config } = entry;

  state.metrics.totalCalls++;
  state.metrics.successfulCalls++;
  state.metrics.lastSuccessAt = Date.now();

  if (state.state === 'half_open') {
    state.successes += 1;
    if (state.successes >= config.successThreshold) {
      state.state = 'closed';
      state.failures = 0;
      state.successes = 0;
      state.halfOpenCalls = 0;
    }
  } else if (state.state === 'closed') {
    state.failures = Math.max(0, state.failures - 1);
  }
}

function onFailure(name: string): void {
  const entry = circuits.get(name);
  if (!entry) return;
  const { state, config } = entry;

  state.failures += 1;
  state.lastFailureAt = Date.now();
  state.metrics.totalCalls++;
  state.metrics.failedCalls++;

  if (state.state === 'half_open' || state.failures >= config.failureThreshold) {
    state.state = 'open';
    state.openedAt = Date.now();
    state.metrics.openedAt = Date.now();
    state.halfOpenCalls = 0;
    state.successes = 0;
  }
}

function onTimeout(name: string): void {
  const entry = circuits.get(name);
  if (!entry) return;
  entry.state.metrics.timeoutCalls++;
  onFailure(name);
}

function shouldAllow(name: string): boolean {
  const entry = circuits.get(name);
  if (!entry) return true;
  const { state, config } = entry;

  if (state.state === 'closed') return true;

  if (state.state === 'open') {
    const elapsed = Date.now() - (state.openedAt ?? 0);
    if (elapsed >= config.timeoutMs) {
      state.state = 'half_open';
      state.successes = 0;
      state.halfOpenCalls = 0;
      state.metrics.halfOpenAttempts++;
      return true;
    }
    state.metrics.rejectedCalls++;
    return false;
  }

  if (state.halfOpenCalls < config.halfOpenMaxCalls) {
    state.halfOpenCalls += 1;
    return true;
  }

  state.metrics.rejectedCalls++;
  return false;
}

export function circuitBreaker(name: string, config: Partial<CircuitBreakerConfig> = {}) {
  getOrCreate(name, config);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!shouldAllow(name)) {
      res.status(503).json({
        error: {
          code: 'CIRCUIT_OPEN',
          message: `Service ${name} is temporarily unavailable. Circuit breaker is open.`,
          status: 503,
          retryAfterMs: getRetryAfterMs(name),
        },
      });
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode >= 500) {
        onFailure(name);
      } else {
        onSuccess(name);
      }
      return originalJson(body);
    };

    next();
  };
}

function getRetryAfterMs(name: string): number {
  const entry = circuits.get(name);
  if (!entry || !entry.state.openedAt) return entry?.config.timeoutMs ?? DEFAULT_CONFIG.timeoutMs;
  const elapsed = Date.now() - entry.state.openedAt;
  return Math.max(0, entry.config.timeoutMs - elapsed);
}

export function getCircuitState(name: string) {
  const entry = circuits.get(name);
  if (!entry) return null;
  return {
    name,
    state: entry.state.state,
    failures: entry.state.failures,
    successes: entry.state.successes,
    halfOpenCalls: entry.state.halfOpenCalls,
    lastFailureAt: entry.state.lastFailureAt,
    openedAt: entry.state.openedAt,
    config: entry.config,
    metrics: entry.state.metrics,
  };
}

export function getAllCircuits() {
  return Array.from(circuits.entries()).map(([name, entry]) => ({
    name,
    state: entry.state.state,
    failures: entry.state.failures,
    successes: entry.state.successes,
    halfOpenCalls: entry.state.halfOpenCalls,
    lastFailureAt: entry.state.lastFailureAt,
    openedAt: entry.state.openedAt,
    config: entry.config,
    metrics: entry.state.metrics,
  }));
}

export function resetCircuit(name: string): boolean {
  const entry = circuits.get(name);
  if (!entry) return false;
  entry.state = {
    state: 'closed',
    failures: 0,
    successes: 0,
    halfOpenCalls: 0,
    metrics: {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      timeoutCalls: 0,
      rejectedCalls: 0,
      halfOpenAttempts: 0,
    },
  };
  return true;
}

export async function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  fallback?: () => Promise<T>,
  configOverride?: Partial<CircuitBreakerConfig>,
): Promise<T> {
  const entry = getOrCreate(name, configOverride);
  const { state, config } = entry;

  if (!shouldAllow(name)) {
    if (fallback) {
      return fallback();
    }
    throw new CircuitBreakerError(name, `Circuit breaker is open for ${name}`);
  }

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      onTimeout(name);
      reject(new CircuitBreakerError(name, `Request to ${name} timed out after ${config.requestTimeoutMs}ms`, true));
    }, config.requestTimeoutMs);
  });

  try {
    const result = await Promise.race([fn(), timeoutPromise]);
    onSuccess(name);
    return result;
  } catch (error) {
    if (error instanceof CircuitBreakerError) throw error;
    onFailure(name);
    if (fallback) {
      return fallback();
    }
    throw error;
  }
}

export class CircuitBreakerError extends Error {
  serviceName: string;
  isTimeout: boolean;

  constructor(serviceName: string, message: string, isTimeout = false) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.serviceName = serviceName;
    this.isTimeout = isTimeout;
  }
}
