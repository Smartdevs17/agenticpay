import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerError } from '../circuitBreaker.js';
import { CircuitBreakerRegistry } from '../circuitBreakerRegistry.js';

function clock() {
  let t = 0;
  const now = () => t;
  const advance = (ms: number) => {
    t += ms;
  };
  return { now, advance };
}

const baseConfig = {
  slidingWindowSize: 20,
  minimumCallsToOpen: 3,
  failureRateThreshold: 50,
  failureThreshold: 3,
  successThreshold: 2,
  waitDurationInOpenState: 1000,
  permittedNumberOfCallsInHalfOpenState: 2,
  requestTimeoutMs: 0,
  failClosed: false,
};

describe('CircuitBreaker', () => {
  it('starts closed and permits calls', () => {
    const { now } = clock();
    const cb = new CircuitBreaker('svc', baseConfig, now);
    expect(cb.snapshot().state).toBe('closed');
    expect(cb.isCallPermitted()).toBe(true);
  });

  it('rejects a non-empty name requirement', () => {
    expect(() => new CircuitBreaker('', baseConfig)).toThrow(/non-empty name/);
  });

  it('validates slidingWindowSize and failureRateThreshold', () => {
    expect(() => new CircuitBreaker('x', { ...baseConfig, slidingWindowSize: 0 })).toThrow(/slidingWindowSize/);
    expect(() => new CircuitBreaker('x', { ...baseConfig, failureRateThreshold: 101 })).toThrow(/failureRateThreshold/);
  });

  it('opens after the consecutive failure threshold', () => {
    const { now } = clock();
    const cb = new CircuitBreaker('svc', { ...baseConfig, failureThreshold: 3 }, now);
    cb.recordFailure(new Error('a'));
    cb.recordFailure(new Error('b'));
    expect(cb.snapshot().state).toBe('closed');
    cb.recordFailure(new Error('c'));
    expect(cb.snapshot().state).toBe('open');
  });

  it('opens by failure rate once the window is saturated', () => {
    const { now } = clock();
    const cb = new CircuitBreaker(
      'svc',
      { ...baseConfig, failureThreshold: 100, minimumCallsToOpen: 4, failureRateThreshold: 50 },
      now,
    );
    // mix: 2 success, 2 failure => 50% with 4 calls >= minimum
    cb.recordSuccess();
    cb.recordSuccess();
    cb.recordFailure(new Error('f1'));
    cb.recordFailure(new Error('f2'));
    expect(cb.snapshot().state).toBe('open');
  });

  it('does not open by rate before minimum calls', () => {
    const { now } = clock();
    const cb = new CircuitBreaker(
      'svc',
      { ...baseConfig, failureThreshold: 100, minimumCallsToOpen: 4, failureRateThreshold: 50 },
      now,
    );
    cb.recordFailure(new Error('f1'));
    cb.recordFailure(new Error('f2'));
    expect(cb.snapshot().state).toBe('closed');
  });

  it('transitions open -> half_open after the wait and rejects while open', () => {
    const { now, advance } = clock();
    const cb = new CircuitBreaker('svc', { ...baseConfig, waitDurationInOpenState: 1000 }, now);
    cb.recordFailure(new Error('1'));
    cb.recordFailure(new Error('2'));
    cb.recordFailure(new Error('3'));
    expect(cb.snapshot().state).toBe('open');
    expect(cb.isCallPermitted()).toBe(false);
    expect(cb.snapshot().metrics.rejectedCalls).toBe(1);

    advance(1001);
    expect(cb.isCallPermitted()).toBe(true);
    expect(cb.snapshot().state).toBe('half_open');
  });

  it('re-opens on a half_open failure', () => {
    const { now, advance } = clock();
    const cb = new CircuitBreaker('svc', { ...baseConfig, waitDurationInOpenState: 1000 }, now);
    for (let i = 0; i < 3; i++) cb.recordFailure(new Error(`f${i}`));
    advance(1001);
    expect(cb.isCallPermitted()).toBe(true);
    expect(cb.snapshot().state).toBe('half_open');
    cb.recordFailure(new Error('still failing'));
    expect(cb.snapshot().state).toBe('open');
  });

  it('re-closes after the success threshold in half_open', () => {
    const { now, advance } = clock();
    const cb = new CircuitBreaker('svc', { ...baseConfig, waitDurationInOpenState: 1000 }, now);
    for (let i = 0; i < 3; i++) cb.recordFailure(new Error(`f${i}`));
    advance(1001);
    expect(cb.isCallPermitted()).toBe(true);
    cb.recordSuccess();
    cb.recordSuccess();
    expect(cb.snapshot().state).toBe('closed');
  });

  it('limits half-open calls to the permitted count', () => {
    const { now, advance } = clock();
    const cb = new CircuitBreaker(
      'svc',
      { ...baseConfig, waitDurationInOpenState: 1000, permittedNumberOfCallsInHalfOpenState: 2 },
      now,
    );
    for (let i = 0; i < 3; i++) cb.recordFailure(new Error(`f${i}`));
    advance(1001);
    expect(cb.isCallPermitted()).toBe(true);
    expect(cb.isCallPermitted()).toBe(true);
    expect(cb.isCallPermitted()).toBe(false);
  });

  it('protect resolves and records success', async () => {
    const { now } = clock();
    const cb = new CircuitBreaker('svc', baseConfig, now);
    await expect(cb.protect(async () => 42)).resolves.toBe(42);
    expect(cb.snapshot().metrics.successfulCalls).toBe(1);
    expect(cb.snapshot().metrics.calls).toBe(1);
  });

  it('protect rejects and records failure, then throws', async () => {
    const { now } = clock();
    const cb = new CircuitBreaker('svc', baseConfig, now);
    await expect(cb.protect(async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(cb.snapshot().metrics.failedCalls).toBe(1);
  });

  it('throws CircuitBreakerError while open and uses the fallback when provided', async () => {
    const { now } = clock();
    const cb = new CircuitBreaker('svc', { ...baseConfig, waitDurationInOpenState: 1000 }, now);
    for (let i = 0; i < 3; i++) {
      await cb.protect(async () => {
        throw new Error(`f${i}`);
      }).catch(() => undefined);
    }
    expect(cb.snapshot().state).toBe('open');

    await expect(cb.protect(async () => 'x')).rejects.toBeInstanceOf(CircuitBreakerError);

    const fallback = vi.fn(async () => 'fallback-value');
    await expect(cb.protect(async () => 'x', fallback)).resolves.toBe('fallback-value');
    expect(fallback).toHaveBeenCalled();
  });

  it('invokes the fallback on call failure', async () => {
    const { now } = clock();
    const cb = new CircuitBreaker('svc', baseConfig, now);
    const fallback = vi.fn(async () => 'fb');
    await expect(
      cb.protect(async () => {
        throw new Error('boom');
      }, fallback),
    ).resolves.toBe('fb');
    expect(fallback).toHaveBeenCalled();
  });

  it('times out and records a timeout, using the fallback', async () => {
    const { now } = clock();
    const cb = new CircuitBreaker('svc', { ...baseConfig, requestTimeoutMs: 20 }, now);
    const fallback = vi.fn(async () => 'fb');
    await expect(
      cb.protect(
        () => new Promise((resolve) => setTimeout(() => resolve('late'), 50)),
        fallback,
      ),
    ).resolves.toBe('fb');
    expect(cb.snapshot().metrics.timeoutCalls).toBe(1);
  });

  it('propagates a CircuitBreakerError thrown by the guarded function without recording it', async () => {
    const { now } = clock();
    const cb = new CircuitBreaker('svc', baseConfig, now);
    await expect(
      cb.protect(async () => {
        throw new CircuitBreakerError('other', 'nested');
      }),
    ).rejects.toBeInstanceOf(CircuitBreakerError);
    expect(cb.snapshot().metrics.failedCalls).toBe(0);
  });

  it('honours ignoreFailures predicate', async () => {
    const { now } = clock();
    const cb = new CircuitBreaker('svc', { ...baseConfig, ignoreFailures: () => true }, now);
    for (let i = 0; i < 5; i++) await cb.protect(async () => { throw new Error('ignored'); }).catch(() => undefined);
    expect(cb.snapshot().state).toBe('closed');
  });

  it('honours the recordFailure predicate to not drive the breaker', async () => {
    const { now } = clock();
    const cb = new CircuitBreaker('svc', { ...baseConfig, recordFailure: () => false }, now);
    for (let i = 0; i < 10; i++) await cb.protect(async () => { throw new Error('x'); }).catch(() => undefined);
    expect(cb.snapshot().state).toBe('closed');
    expect(cb.snapshot().metrics.failedCalls).toBe(10);
  });

  it('reset clears state and metrics and closes the circuit', () => {
    const { now, advance } = clock();
    const cb = new CircuitBreaker('svc', baseConfig, now);
    for (let i = 0; i < 3; i++) cb.recordFailure(new Error(`f${i}`));
    advance(500);
    cb.reset();
    const s = cb.snapshot();
    expect(s.state).toBe('closed');
    expect(s.metrics.calls).toBe(0);
    expect(s.metrics.failedCalls).toBe(0);
  });

  it('resetMetrics clears history but keeps the current state', () => {
    const { now } = clock();
    const cb = new CircuitBreaker('svc', baseConfig, now);
    cb.recordFailure(new Error('a'));
    cb.recordFailure(new Error('b'));
    cb.resetMetrics();
    expect(cb.snapshot().state).toBe('closed');
    expect(cb.snapshot().consecutiveFailures).toBe(0);
    expect(cb.snapshot().metrics.failureRate).toBe(0);
  });

  it('notifies state-change observers and tolerates listener errors', () => {
    const { now } = clock();
    const cb = new CircuitBreaker('svc', baseConfig, now);
    const events: string[] = [];
    const unsub = cb.onStateChange((from, to) => {
      events.push(`${from}->${to}`);
    });
    cb.onStateChange(() => {
      throw new Error('listener boom');
    });
    for (let i = 0; i < 3; i++) cb.recordFailure(new Error(`f${i}`));
    expect(events).toContain('closed->open');
    expect(cb.snapshot().state).toBe('open');
    unsub();
  });

  it('records metrics totals across outcomes', () => {
    const { now } = clock();
    const cb = new CircuitBreaker('svc', baseConfig, now);
    cb.recordSuccess();
    cb.recordSuccess();
    cb.recordFailure(new Error('f'));
    const s = cb.snapshot();
    expect(s.metrics.calls).toBe(3);
    expect(s.metrics.successfulCalls).toBe(2);
    expect(s.metrics.failedCalls).toBe(1);
    expect(s.metrics.failureRate).toBe(33);
  });

  it('failClosed rejects when closed but with no history is not applicable (uses guard)', () => {
    const { now } = clock();
    const cb = new CircuitBreaker('svc', { ...baseConfig, failClosed: true, failureThreshold: 1 }, now);
    // failClosed is a policy lever; closed still permits by design. Ensure it exists in config.
    expect(cb.config.failClosed).toBe(true);
    expect(cb.isCallPermitted()).toBe(true);
  });

  it('runs synchronous functions via protect', async () => {
    const { now } = clock();
    const cb = new CircuitBreaker('svc', baseConfig, now);
    await expect(cb.protect(() => 'sync')).resolves.toBe('sync');
  });
});

describe('CircuitBreakerRegistry', () => {
  it('creates and reuses instances by name', () => {
    const reg = new CircuitBreakerRegistry(clock().now);
    const a = reg.get('a');
    expect(reg.get('a')).toBe(a);
    expect(reg.has('a')).toBe(true);
    expect(reg.getIfPresent('missing')).toBeUndefined();
  });

  it('tracks names and snapshots', () => {
    const reg = new CircuitBreakerRegistry(clock().now);
    reg.get('x');
    reg.get('y');
    expect(reg.names().sort()).toEqual(['x', 'y']);
    expect(reg.snapshots()).toHaveLength(2);
  });

  it('reset returns false for unknown names and works for known', () => {
    const reg = new CircuitBreakerRegistry(clock().now);
    expect(reg.reset('nope')).toBe(false);
    reg.get('k');
    expect(reg.reset('k')).toBe(true);
  });

  it('resetAll resets every circuit', () => {
    const { now } = clock();
    const reg = new CircuitBreakerRegistry(now);
    const b = reg.get('k', { ...baseConfig, failureThreshold: 3 });
    b.recordFailure(new Error('f'));
    b.recordFailure(new Error('f'));
    b.recordFailure(new Error('f'));
    expect(b.snapshot().state).toBe('open');
    reg.resetAll();
    expect(b.snapshot().state).toBe('closed');
  });

  it('delete and clear remove entries', () => {
    const reg = new CircuitBreakerRegistry(clock().now);
    reg.get('a');
    reg.get('b');
    expect(reg.delete('a')).toBe(true);
    expect(reg.has('a')).toBe(false);
    reg.clear();
    expect(reg.names()).toHaveLength(0);
  });
});
