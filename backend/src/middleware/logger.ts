import pino from 'pino';
import pinoHttp from 'pino-http';
import { randomUUID } from 'crypto';
import type { Request } from 'express';

// ---------------------------------------------------------------------------
// Base logger
// ---------------------------------------------------------------------------

/**
 * Pino logger instance.
 * - In development: pretty-print to stdout for human readability.
 * - In production: raw JSON for ingestion by log aggregators.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(process.env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    },
  }),
});

// ---------------------------------------------------------------------------
// HTTP middleware
// ---------------------------------------------------------------------------

/**
 * pino-http middleware.
 *
 * Logs every request with:
 *   - req.id      – UUID v4 correlation ID (forwarded to res as X-Request-Id)
 *   - method      – HTTP verb
 *   - url         – path + query string
 *   - statusCode  – HTTP status code
 *   - responseTime – wall-clock time in milliseconds
 *
 * Sensitive headers (Authorization) are redacted before the log is written.
 */
export const httpLogger = pinoHttp({
  logger,

  // ── Request-ID generation ────────────────────────────────────────────────
  genReqId(req: Request, res) {
    const existingId = req.headers['x-request-id'] as string | undefined;
    const id = existingId ?? randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },

  // ── Sensitive header redaction ───────────────────────────────────────────
  // These paths are redacted in the serialised log output.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'req.headers.cookie',
    ],
    censor: '[Redacted]',
  },

  // ── Custom serialisers ───────────────────────────────────────────────────
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
        // Include remoteAddress for audit trails
        remoteAddress: req.remoteAddress,
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode,
      };
    },
  },

  // Log 5xx errors at 'error' level, 4xx at 'warn', everything else at 'info'
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
