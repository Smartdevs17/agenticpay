import type { NextFunction, Request, Response } from 'express';

type CircuitState = 'closed' | 'open' | 'half_open';

interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
  halfOpenMaxCalls: number;
}

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  halfOpenCalls: number;
  lastFailureAt?: number;
  openedAt?: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeoutMs: 60_000,
  halfOpenMaxCalls: 3,
};

const circuits = new Map<string, CircuitBreakerState>();

function getOrCreate(name: string): CircuitBreakerState {
  const existing = circuits.get(name);
  if (existing) return existing;
  const state: CircuitBreakerState = { state: 'closed', failures: 0, successes: 0, halfOpenCalls: 0 };
  circuits.set(name, state);
  return state;
}

function onSuccess(name: string, config: CircuitBreakerConfig): void {
  const cb = getOrCreate(name);
  if (cb.state === 'half_open') {
    cb.successes += 1;
    if (cb.successes >= config.successThreshold) {
      cb.state = 'closed';
      cb.failures = 0;
      cb.successes = 0;
      cb.halfOpenCalls = 0;
    }
  } else if (cb.state === 'closed') {
    cb.failures = Math.max(0, cb.failures - 1);
  }
  circuits.set(name, cb);
}

function onFailure(name: string, config: CircuitBreakerConfig): void {
  const cb = getOrCreate(name);
  cb.failures += 1;
  cb.lastFailureAt = Date.now();

  if (cb.state === 'half_open' || cb.failures >= config.failureThreshold) {
    cb.state = 'open';
    cb.openedAt = Date.now();
    cb.halfOpenCalls = 0;
    cb.successes = 0;
  }

  circuits.set(name, cb);
}

function shouldAllow(name: string, config: CircuitBreakerConfig): boolean {
  const cb = getOrCreate(name);

  if (cb.state === 'closed') return true;

  if (cb.state === 'open') {
    const elapsed = Date.now() - (cb.openedAt ?? 0);
    if (elapsed >= config.timeoutMs) {
      cb.state = 'half_open';
      cb.successes = 0;
      cb.halfOpenCalls = 0;
      circuits.set(name, cb);
      return true;
    }
    return false;
  }

  // half_open: allow limited calls
  if (cb.halfOpenCalls < config.halfOpenMaxCalls) {
    cb.halfOpenCalls += 1;
    circuits.set(name, cb);
    return true;
  }

  return false;
}

export function circuitBreaker(name: string, config: Partial<CircuitBreakerConfig> = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!shouldAllow(name, cfg)) {
      res.status(503).json({
        error: {
          code: 'CIRCUIT_OPEN',
          message: `Service ${name} is temporarily unavailable. Circuit breaker is open.`,
          status: 503,
        },
      });
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode >= 500) {
        onFailure(name, cfg);
      } else {
        onSuccess(name, cfg);
      }
      return originalJson(body);
    };

    next();
  };
}

export function getCircuitState(name: string): CircuitBreakerState & { name: string } {
  return { name, ...getOrCreate(name) };
}

export function getAllCircuits(): Array<CircuitBreakerState & { name: string }> {
  return Array.from(circuits.entries()).map(([name, state]) => ({ name, ...state }));
}

export function resetCircuit(name: string): void {
  circuits.set(name, { state: 'closed', failures: 0, successes: 0, halfOpenCalls: 0 });
}
