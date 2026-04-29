import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReqRes(overrides: Partial<IncomingMessage> = {}) {
  const req = Object.assign(
    Object.create(null) as IncomingMessage,
    {
      method: 'GET',
      url: '/health',
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
    },
    overrides,
  );

  const res = Object.assign(Object.create(null) as ServerResponse, {
    statusCode: 200,
    getHeader: vi.fn(),
    setHeader: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  });

  return { req, res };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('httpLogger middleware', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('attaches a UUID requestId to req and sets X-Request-Id response header', async () => {
    // Import lazily so NODE_ENV is set before pino initialises
    const { httpLogger } = await import('./logger.js');

    const { req, res } = makeReqRes();
    const next = vi.fn();

    httpLogger(req as any, res as any, next);

    // pino-http sets req.id
    expect((req as any).id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    // X-Request-Id header must be set on the response
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', (req as any).id);

    expect(next).toHaveBeenCalledOnce();
  });

  it('honours an existing X-Request-Id header from the caller', async () => {
    const { httpLogger } = await import('./logger.js');

    const existingId = '11111111-2222-4333-8444-555555555555';
    const { req, res } = makeReqRes({
      headers: { 'x-request-id': existingId },
    });
    const next = vi.fn();

    httpLogger(req as any, res as any, next);

    expect((req as any).id).toBe(existingId);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', existingId);
  });

  it('calls next()', async () => {
    const { httpLogger } = await import('./logger.js');

    const { req, res } = makeReqRes();
    const next = vi.fn();

    httpLogger(req as any, res as any, next);

    expect(next).toHaveBeenCalledOnce();
  });
});

describe('logger module', () => {
  it('exports a pino logger instance with an info method', async () => {
    const { logger } = await import('./logger.js');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
  });
});
