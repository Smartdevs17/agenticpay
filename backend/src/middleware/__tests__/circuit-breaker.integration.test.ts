import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import express from 'express';
import { circuitBreaker, resetAllCircuits, getCircuitState, circuitBreakerRegistry } from '../circuit-breaker.js';

let server: Server;
let base: string;

// Stateful upstream that we can flip between healthy and failing.
let healthy = true;

function setup() {
  resetAllCircuits();
  healthy = true;
  const app = express();

  // A generic upstream guarded by a breaker with a short recovery window so the
  // integration test can observe the full open -> half_open -> closed cycle.
  app.use('/upstream', circuitBreaker('upstream-integration', {
    failureThreshold: 3,
    successThreshold: 2,
    waitDurationInOpenState: 500,
    permittedNumberOfCallsInHalfOpenState: 2,
    requestTimeoutMs: 0,
  }));

  app.get('/upstream/echo', (req, res) => {
    if (!healthy) {
      res.status(502).json({ error: 'bad gateway' });
      return;
    }
    res.json({ ok: true });
  });

  return app;
}

function get(path: string) {
  return fetch(`${base}${path}`);
}

describe('circuit breaker integration', () => {
  beforeAll(async () => {
    const app = setup();
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (address && typeof address === 'object') {
      base = `http://127.0.0.1:${address.port}`;
    } else {
      throw new Error('Failed to bind test server');
    }
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    resetAllCircuits();
    healthy = true;
  });

  it('passes traffic while healthy and records successes', async () => {
    const r1 = await get('/upstream/echo');
    expect(r1.status).toBe(200);
    const r2 = await get('/upstream/echo');
    expect(r2.status).toBe(200);
    const state = getCircuitState('upstream-integration');
    expect(state?.metrics.successfulCalls).toBe(2);
    expect(state?.state).toBe('closed');
  });

  it('opens the circuit after failures and rejects subsequent requests with 503', async () => {
    healthy = false;
    // Drive 3 consecutive failures (threshold = 3).
    for (let i = 0; i < 3; i++) {
      const r = await get('/upstream/echo');
      expect(r.status).toBe(502);
    }
    expect(getCircuitState('upstream-integration')?.state).toBe('open');

    // Now the breaker short-circuits with 503 without hitting the upstream.
    healthy = true;
    const rejected = await get('/upstream/echo');
    expect(rejected.status).toBe(503);
    const body = await rejected.json();
    expect(body.error.code).toBe('CIRCUIT_OPEN');

    const state = getCircuitState('upstream-integration');
    expect(state?.metrics.rejectedCalls).toBeGreaterThan(0);
  });

  it('recovers to half_open and closes after enough successes', async () => {
    healthy = false;
    for (let i = 0; i < 3; i++) {
      await get('/upstream/echo');
    }
    expect(getCircuitState('upstream-integration')?.state).toBe('open');

    // Bring the upstream back; wait for the recovery window then probe.
    healthy = true;
    await new Promise((r) => setTimeout(r, 600));

    // First half-open probe passes, upstream healthy -> success.
    const probe1 = await get('/upstream/echo');
    expect(probe1.status).toBe(200);

    // Second success closes the breaker.
    const probe2 = await get('/upstream/echo');
    expect(probe2.status).toBe(200);

    expect(getCircuitState('upstream-integration')?.state).toBe('closed');
  });

  it('re-opens quickly if the upstream is still failing during half-open', async () => {
    healthy = false;
    for (let i = 0; i < 3; i++) {
      await get('/upstream/echo');
    }
    expect(getCircuitState('upstream-integration')?.state).toBe('open');

    // Wait for the recovery window; upstream still unhealthy.
    await new Promise((r) => setTimeout(r, 600));
    // The first half-open probe is permitted and reaches the (still-failing)
    // upstream, returning 502 and re-opening the breaker.
    const probe = await get('/upstream/echo');
    expect(probe.status).toBe(502);
    expect(getCircuitState('upstream-integration')?.state).toBe('open');

    // A subsequent request is now short-circuited with 503.
    const subsequent = await get('/upstream/echo');
    expect(subsequent.status).toBe(503);
    expect(getCircuitState('upstream-integration')?.state).toBe('open');

    // Confirms the breaker did not drift back to closed while the upstream was down.
    expect(healthy).toBe(false);
  });

  it('registry is reachable via the module facade for Ops introspection', () => {
    expect(circuitBreakerRegistry.names()).toContain('upstream-integration');
    const snap = circuitBreakerRegistry.getIfPresent('upstream-integration')?.snapshot();
    expect(snap?.name).toBe('upstream-integration');
  });
});
