import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { getCircuitState, getAllCircuits, resetCircuit, resetAllCircuits } from '../circuit-breaker.js';

// Import the module namespace to reach the module-level singleton registry.
import * as cb from '../circuit-breaker.js';

function mockRes(statusCode = 200) {
  const res = new EventEmitter() as any;
  res.statusCode = statusCode;
  res.headersSent = typeof statusCode !== 'undefined';
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => res.body = body;
  return res;
}

describe('circuit-breaker middleware facade (backward-compatible API)', () => {
  beforeEach(() => {
    resetAllCircuits();
  });

  it('re-exports CircuitBreakerError and the registry singleton', () => {
    expect(cb.CircuitBreakerError).toBeTypeOf('function');
    expect(cb.circuitBreakerRegistry).toBeDefined();
  });

  it('withCircuitBreaker returns the resolved value on success', async () => {
    const val = await cb.withCircuitBreaker('svc-a', async () => 123);
    expect(val).toBe(123);
    expect(getCircuitState('svc-a')?.metrics.successfulCalls).toBe(1);
  });

  it('withCircuitBreaker throws when the circuit opens and the breaker rejects', async () => {
    const failer = async () => {
      throw new Error('down');
    };
    // Open the circuit via consecutive failures using a low threshold.
    for (let i = 0; i < 5; i++) {
      await cb.withCircuitBreaker('svc-b', failer, undefined, { failureThreshold: 2 }).catch(() => undefined);
    }
    expect(getCircuitState('svc-b')?.state).toBe('open');
    await expect(cb.withCircuitBreaker('svc-b', async () => 'ok')).rejects.toBeInstanceOf(cb.CircuitBreakerError);
  });

  it('withCircuitBreaker uses the fallback when the circuit is open', async () => {
    const failer = async () => {
      throw new Error('down');
    };
    const fallback = vi.fn(async () => 'fallback');
    for (let i = 0; i < 5; i++) {
      await cb.withCircuitBreaker('svc-c', failer, fallback, { failureThreshold: 2 }).catch(() => undefined);
    }
    const openResult = await cb.withCircuitBreaker('svc-c', async () => 'x', fallback);
    expect(openResult).toBe('fallback');
  });

  it('circuitBreaker middleware short-circuits an open circuit with 503', async () => {
    const breaker = cb.circuitBreakerRegistry.get('mw-1', { failureThreshold: 2 });
    for (let i = 0; i < 4; i++) breaker.recordFailure(new Error(`f${i}`));
    expect(breaker.snapshot().state).toBe('open');

    const mw = cb.circuitBreaker('mw-1');
    const req = {} as any;
    const res = mockRes();
    const next = vi.fn();
    mw(req, res, next);
    expect(res.statusCode).toBe(503);
    expect(res.body.error.code).toBe('CIRCUIT_OPEN');
    expect(next).not.toHaveBeenCalled();
  });

  it('circuitBreaker middleware runs next when the circuit is closed', () => {
    const mw = cb.circuitBreaker('mw-2');
    const next = vi.fn();
    mw({} as any, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('records success when the response finishes with 2xx', async () => {
    const mw = cb.circuitBreaker('mw-3');
    const res = mockRes(200);
    const next = vi.fn();
    mw({} as any, res, next);
    expect(next).toHaveBeenCalled();
    res.emit('finish');
    const st = getCircuitState('mw-3');
    expect(st?.metrics.successfulCalls).toBe(1);
    expect(st?.metrics.failedCalls).toBe(0);
  });

  it('records failure when the response finishes with 5xx', async () => {
    const mw = cb.circuitBreaker('mw-4', { failureThreshold: 2 });
    const res = mockRes(503);
    mw({} as any, res, vi.fn());
    res.emit('close');
    const st = getCircuitState('mw-4');
    expect(st?.metrics.failedCalls).toBe(1);
    expect(st?.metrics.successfulCalls).toBe(0);
  });

  it('getAllCircuits returns serialisable snapshots', () => {
    cb.withCircuitBreaker('svc-l1', async () => 1);
    cb.withCircuitBreaker('svc-l2', async () => 2);
    const all = getAllCircuits();
    expect(all.map((s) => s.name)).toContain('svc-l1');
    expect(all.map((s) => s.name)).toContain('svc-l2');
    // Snapshot is JSON-serialisable.
    expect(() => JSON.stringify(all)).not.toThrow();
  });

  it('getCircuitState returns null for unknown circuits', () => {
    expect(getCircuitState('does-not-exist')).toBeNull();
  });

  it('resetCircuit returns true for known and false for unknown', () => {
    cb.withCircuitBreaker('svc-r', async () => 1);
    expect(resetCircuit('svc-r')).toBe(true);
    expect(resetCircuit('nope')).toBe(false);
  });

  it('resetAllCircuits resets everything and getAllCircuits reflects it', async () => {
    const failer = async () => {
      throw new Error('down');
    };
    for (let i = 0; i < 5; i++) {
      await cb.withCircuitBreaker('svc-z', failer, undefined, { failureThreshold: 2 }).catch(() => undefined);
    }
    expect(getCircuitState('svc-z')?.state).toBe('open');
    resetAllCircuits();
    expect(getCircuitState('svc-z')?.state).toBe('closed');
  });

  it('circuitBroken wraps a handler and records its resolved outcome', async () => {
    const handler = (_req: any, res: any) => {
      res.statusCode = 200;
    };
    const wrapped = cb.circuitBroken('wrapped-1', handler as any);
    const res = mockRes(200);
    await wrapped({} as any, res, vi.fn());
    // resolution is recorded via the promise chain
    await new Promise((r) => setImmediate(r));
    expect(getCircuitState('wrapped-1')?.metrics.successfulCalls).toBe(1);
  });

  it('circuitBroken records a failure and forwards the error when the handler throws', async () => {
    const handler = () => {
      throw new Error('handler boom');
    };
    const wrapped = cb.circuitBroken('wrapped-2', handler as any);
    const next = vi.fn();
    await wrapped({} as any, mockRes(500), next);
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalled();
    expect(getCircuitState('wrapped-2')?.metrics.failedCalls).toBe(1);
  });
});
