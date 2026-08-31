import type { NextFunction, Request, Response, RequestHandler } from 'express';
import type { CircuitBreakerConfig, CircuitBreakerSnapshot } from '../services/circuitBreaker.js';
import { CircuitBreakerRegistry } from '../services/circuitBreakerRegistry.js';

export { CircuitBreakerError } from '../services/circuitBreaker.js';
export type { CircuitBreakerConfig, CircuitBreakerState, CircuitBreakerSnapshot } from '../services/circuitBreaker.js';

/**
 * The registry that backs the module-level name-based API (`withCircuitBreaker`,
 * `circuitBreaker`, `getCircuitState`, ...). Existing callers reference circuits
 * by a stable name and expect this singleton to hold them. Use the exported
 * `circuitBreakerRegistry` object to introspect or reset from elsewhere.
 */
export const circuitBreakerRegistry = new CircuitBreakerRegistry();

export function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  fallback?: () => Promise<T>,
  configOverride?: Partial<CircuitBreakerConfig>,
): Promise<T> {
  const breaker = circuitBreakerRegistry.get(name, configOverride);
  return breaker.protect(fn, fallback);
}

/**
 * Express middleware guarding a route by a named circuit.
 *
 * When the circuit is open the request is short-circuited with a 503 and the
 * management-friendly `retryAfterMs` hint. Otherwise the upstream handler runs
 * and its outcome is recorded as a success/failure based on the response status
 * after the response finishes. This avoids the fragile `res.json` monkey-patch
 * approach and propagates the outcome even for handlers that stream or never
 * call `res.json`.
 */
export function circuitBreaker(name: string, config: Partial<CircuitBreakerConfig> = {}): RequestHandler {
  const breaker = circuitBreakerRegistry.get(name, config);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!breaker.isCallPermitted()) {
      const snapshot = breaker.snapshot();
      res.status(503).json({
        error: {
          code: 'CIRCUIT_OPEN',
          message: `Service ${name} is temporarily unavailable. Circuit breaker is open.`,
          status: 503,
          retryAfterMs: retryAfterMs(snapshot),
        },
      });
      return;
    }

    let recorded = false;
    const trackOutcome = () => {
      if (recorded) return;
      recorded = true;
      if (res.statusCode >= 500) {
        breaker.recordFailure(new Error(`HTTP ${res.statusCode} from ${name}`));
      } else {
        breaker.recordSuccess();
      }
    };

    res.once('finish', trackOutcome);
    res.once('close', trackOutcome);
    next();
  };
}

function retryAfterMs(snapshot: CircuitBreakerSnapshot): number {
  if (typeof snapshot.openedAt !== 'number') return snapshot.config.waitDurationInOpenState;
  const elapsed = Date.now() - snapshot.openedAt;
  return Math.max(0, snapshot.config.waitDurationInOpenState - elapsed);
}

/**
 * Wrap a RouteHandler so it runs inside the breaker and its resolved/rejected
 * outcome is recorded. Useful when a circuit should guard a single async handler
 * rather than the whole downstream chain.
 */
export function circuitBroken(
  name: string,
  handler: RequestHandler,
  config: Partial<CircuitBreakerConfig> = {},
): RequestHandler {
  const breaker = circuitBreakerRegistry.get(name, config);
  return (req: Request, res: Response, next: NextFunction): void => {
    const run = () => Promise.resolve().then(() => handler(req, res, next));
    breaker.protect(run).catch(next);
  };
}

/**
 * Return a serialisable snapshot for a named circuit (the same shape consumed by
 * the management routes via `res.json`), or `null` when no such circuit exists.
 */
export function getCircuitState(name: string): CircuitBreakerSnapshot | null {
  const breaker = circuitBreakerRegistry.getIfPresent(name);
  if (!breaker) return null;
  return breaker.snapshot();
}

/** Return serialisable snapshots for every registered circuit. */
export function getAllCircuits(): CircuitBreakerSnapshot[] {
  return circuitBreakerRegistry.snapshots();
}

export function resetCircuit(name: string): boolean {
  return circuitBreakerRegistry.reset(name);
}

export function resetAllCircuits(): void {
  circuitBreakerRegistry.resetAll();
}

export type { Request, Response, NextFunction };
