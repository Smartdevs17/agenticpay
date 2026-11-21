/**
 * cors.integration.test.ts — End-to-end CORS tests over a real HTTP server.
 *
 * Proves the dynamic origin whitelist drives real preflights and simple
 * requests across the wire, including live policy mutations that take effect
 * on the next request without a redeploy.
 */

import express, { type Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createCorsMiddleware } from '../cors.js';
import { corsRouter } from '../../routes/cors.js';
import { addAllowedOrigin, getCorsMetrics, initCorsPolicy, resetCorsMetrics } from '../../services/cors.js';

let server: import('node:http').Server;
let base = '';

const APP_ORIGIN = 'https://app.example.com';
const TENANT_ORIGIN = 'https://team.tenant.example.com';
const DENIED_ORIGIN = 'https://evil.example.org';

async function request(
  path: string,
  options: {
    method?: string;
    origin?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (options.origin) headers.origin = options.origin;
  Object.assign(headers, options.headers);

  const res = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers,
  });
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body, headers: res.headers };
}

describe('CORS over HTTP', () => {
  beforeAll(async () => {
    initCorsPolicy({
      allowedOrigins: [APP_ORIGIN, 'https://*.tenant.example.com'],
      allowCredentials: true,
    });

    const app: Express = express();
    app.use(
      createCorsMiddleware({
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        maxAge: 86400,
      }),
    );

    let hits = 0;
    app.get('/data', (_req, res) => {
      hits += 1;
      res.json({ ok: true, hits, origin: _req.headers.origin ?? null });
    });

    app.post('/data', (_req, res) => {
      res.status(201).json({ created: true });
    });

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    resetCorsMetrics();
  });

  it('reflects an allowed origin on a simple GET', async () => {
    const res = await request('/data', { origin: APP_ORIGIN });

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(APP_ORIGIN);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('vary')).toContain('Origin');
  });

  it('matches a wildcard tenant pattern from the browser origin', async () => {
    const res = await request('/data', { origin: TENANT_ORIGIN });
    expect(res.headers.get('access-control-allow-origin')).toBe(TENANT_ORIGIN);
  });

  it('omits CORS header for a denied origin (browser blocks)', async () => {
    const res = await request('/data', { origin: DENIED_ORIGIN });

    expect(res.status).toBe(200);
    expect((res.body as { hits: number }).hits).toBeGreaterThanOrEqual(1);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('vary')).toContain('Origin');
  });

  it('answers an allowed preflight with negotiated headers', async () => {
    const res = await request('/data', {
      method: 'OPTIONS',
      origin: APP_ORIGIN,
      headers: {
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, authorization',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(APP_ORIGIN);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-methods')).toBe('POST');
    expect(res.headers.get('access-control-allow-headers')).toBe('content-type, authorization');
    expect(res.headers.get('access-control-max-age')).toBe('86400');
  });

  it('answers a denied preflight with 204 but no allow headers', async () => {
    const res = await request('/data', {
      method: 'OPTIONS',
      origin: DENIED_ORIGIN,
      headers: { 'access-control-request-method': 'POST' },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-methods')).toBeNull();
    expect(getCorsMetrics().preflightDenied).toBe(1);
  });

  it('serves a credentialed preflight for a POST with Authorization', async () => {
    const res = await request('/data', {
      method: 'OPTIONS',
      origin: APP_ORIGIN,
      headers: { 'access-control-request-method': 'POST' },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toBe('POST');

    const actual = await request('/data', {
      method: 'POST',
      origin: APP_ORIGIN,
      headers: { authorization: 'Bearer xyz', 'content-type': 'application/json' },
    });
    expect(actual.status).toBe(201);
    expect(actual.headers.get('access-control-allow-origin')).toBe(APP_ORIGIN);
  });

  it('applies origins added at runtime with no redeploy', async () => {
    const before = await request('/data', { origin: 'https://fresh.example.com' });
    expect(before.headers.get('access-control-allow-origin')).toBeNull();

    addAllowedOrigin('https://fresh.example.com');

    const after = await request('/data', { origin: 'https://fresh.example.com' });
    expect(after.headers.get('access-control-allow-origin')).toBe('https://fresh.example.com');
  });

  it('passes requests without an Origin through untouched', async () => {
    const res = await request('/data');
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('vary')).toContain('Origin');
  });
});

// ─── Management router ──────────────────────────────────────────────────────

let adminBase = '';
let adminServer: import('node:http').Server;

describe('CORS management router over HTTP', () => {
  beforeAll(async () => {
    initCorsPolicy({
      allowedOrigins: ['https://app.example.com'],
      allowCredentials: true,
      loader: async () => ['https://loaded.example.com', 'https://*.loaded.example.com'],
    });

    const app: Express = express();
    app.use(express.json());
    app.use('/api/v1/cors', corsRouter);

    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    adminBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/cors`;
    adminServer = server;
  });

  afterAll(async () => {
    await new Promise((resolve) => adminServer.close(resolve));
  });

  it('GET /config reports the current policy and metrics', async () => {
    const res = await fetch(`${adminBase}/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      allowCredentials: boolean;
      wildcard: boolean;
      origins: string[];
      version: number;
      metrics: { allowedRequests: number };
    };
    expect(body.allowCredentials).toBe(true);
    expect(body.wildcard).toBe(false);
    expect(body.origins).toEqual(['https://app.example.com']);
    expect(body.version).toBeGreaterThanOrEqual(0);
    expect(body.metrics).toHaveProperty('allowedRequests');
  });

  it('GET /origins lists the allowlist', async () => {
    const res = await fetch(`${adminBase}/origins`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { origins: string[] };
    expect(body.origins).toEqual(['https://app.example.com']);
  });

  it('POST /origins adds a single origin and DELETE /origins removes it', async () => {
    const add = await fetch(`${adminBase}/origins`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: 'https://temp.example.com' }),
    });
    expect(add.status).toBe(201);
    const added = (await add.json()) as { size: number };
    expect(added.size).toBe(2);

    const remove = await fetch(`${adminBase}/origins?origin=https://temp.example.com`, {
      method: 'DELETE',
    });
    expect(remove.status).toBe(200);
    const removed = (await remove.json()) as { removed: boolean };
    expect(removed.removed).toBe(true);

    const removeAgain = await fetch(`${adminBase}/origins?origin=https://temp.example.com`, {
      method: 'DELETE',
    });
    expect(((await removeAgain.json()) as { removed: boolean }).removed).toBe(false);
  });

  it('rejects invalid origins with 400 and keeps the allowlist intact', async () => {
    const bad = await fetch(`${adminBase}/origins`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: 'has space' }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('INVALID_CORS_ORIGIN');

    const missing = await fetch(`${adminBase}/origins`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);

    const config = await fetch(`${adminBase}/config`);
    const body = (await config.json()) as { origins: string[] };
    expect(body.origins).toEqual(['https://app.example.com']);
  });

  it('PUT /config replaces the allowlist and toggles credentials', async () => {
    const res = await fetch(`${adminBase}/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        allowedOrigins: ['https://next.example.com'],
        allowCredentials: false,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { origins: string[]; allowCredentials: boolean };
    expect(body.origins).toEqual(['https://next.example.com']);
    expect(body.allowCredentials).toBe(false);

    // Restore for the other tests.
    await fetch(`${adminBase}/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        allowedOrigins: ['https://app.example.com'],
        allowCredentials: true,
      }),
    });
  });

  it('PUT /config with a bad entry returns 400 and does not mutate', async () => {
    const res = await fetch(`${adminBase}/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ allowedOrigins: ['https://ok.example.com', 'not valid!'] }),
    });
    expect(res.status).toBe(400);

    const config = await fetch(`${adminBase}/config`);
    expect(((await config.json()) as { origins: string[] }).origins).toEqual(['https://app.example.com']);
  });

  it('PUT /config with a non-array returns a validation error', async () => {
    const res = await fetch(`${adminBase}/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ allowedOrigins: 'https://app.example.com' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('POST /refresh pulls the allowlist through the loader', async () => {
    const res = await fetch(`${adminBase}/refresh`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: string; origins: string[] };
    expect(body.origins).toEqual(['https://*.loaded.example.com', 'https://loaded.example.com']);
  });

  it('DELETE /origins without an origin param returns 400', async () => {
    const res = await fetch(`${adminBase}/origins`, { method: 'DELETE' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });
});