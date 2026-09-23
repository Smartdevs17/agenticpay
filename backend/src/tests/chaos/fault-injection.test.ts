import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../../services/circuitBreaker.js';

const breakerConfig = {
  slidingWindowSize: 10,
  minimumCallsToOpen: 3,
  failureRateThreshold: 50,
  failureThreshold: 3,
  successThreshold: 1,
  waitDurationInOpenState: 1000,
  permittedNumberOfCallsInHalfOpenState: 1,
  requestTimeoutMs: 0,
  failClosed: false,
};

describe('dependency fault injection', () => {
  it.each(['database', 'cache', 'stellar-rpc'])('%s outage uses fallback and stops repeated calls', async (dependency) => {
    let now = 0;
    let failuresRemaining = 3;
    let dependencyCalls = 0;
    const breaker = new CircuitBreaker(dependency, breakerConfig, () => now);
    const query = async () => {
      dependencyCalls++;
      if (failuresRemaining > 0) {
        failuresRemaining--;
        throw new Error(`${dependency} unavailable`);
      }
      return 'primary';
    };
    const fallback = async () => 'degraded';

    for (let i = 0; i < 3; i++) {
      await expect(breaker.protect(query, fallback)).resolves.toBe('degraded');
    }
    await expect(breaker.protect(query, fallback)).resolves.toBe('degraded');
    expect(dependencyCalls).toBe(3);
    expect(breaker.snapshot().state).toBe('open');

    now += 1001;
    await expect(breaker.protect(query, fallback)).resolves.toBe('primary');
    expect(breaker.snapshot().state).toBe('closed');
  });
});
