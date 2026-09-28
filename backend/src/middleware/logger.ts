import pino from 'pino';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getLogContext, logContextStorage, mergeLogContext, runWithLogContext } from '../logging/context.js';
import { redactPii } from '../logging/redact.js';
import { REQUEST_ID_HEADER } from './requestId.js';

const MODULE_LEVELS: Record<string, string> = {};
const DEFAULT_LEVEL = process.env.LOG_LEVEL ?? 'info';

function resolveLevel(module?: string): string {
  if (module && MODULE_LEVELS[module]) {
    return MODULE_LEVELS[module];
  }
  return DEFAULT_LEVEL;
}

/** Parse LOG_LEVELS=webhooks:debug,prisma:warn */
export function parseModuleLogLevels(spec?: string): void {
  if (!spec) return;
  for (const part of spec.split(',')) {
    const [mod, level] = part.trim().split(':');
    if (mod && level) MODULE_LEVELS[mod] = level;
  }
}

parseModuleLogLevels(process.env.LOG_LEVELS);

export const logger = pino({
  level: DEFAULT_LEVEL,
  base: { service: 'agenticpay-backend' },
  formatters: {
    level(label) {
      return { level: label };
    },
    log(object) {
      const ctx = getLogContext();
      return redactPii({
        ...object,
        ...(ctx?.traceId ? { traceId: ctx.traceId } : {}),
        ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
        ...(ctx?.module ? { module: ctx.module } : {}),
      }) as Record<string, unknown>;
    },
  },
  ...(process.env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    },
  }),
});

export function createModuleLogger(module: string) {
  const child = logger.child({ module }, { level: resolveLevel(module) });
  return child;
}

export const httpLogger = pinoHttp({
  logger,
  genReqId(req: Request, res: Response) {
    const existing =
      (req.headers[REQUEST_ID_HEADER] as string | undefined) ??
      (req.headers['x-request-id'] as string | undefined);
    const id = existing ?? randomUUID();
    res.setHeader(REQUEST_ID_HEADER, id);
    req.requestId = id;
    return id;
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'req.headers.cookie',
      'req.headers["stripe-signature"]',
    ],
    censor: '[Redacted]',
  },
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customProps(req: Request) {
    const traceId = (req.headers['x-trace-id'] as string) || undefined;
    return { traceId, requestId: req.requestId ?? req.id };
  },
});

/** Bind trace + request IDs for async boundaries (jobs, webhooks). */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceId = (req.headers['x-trace-id'] as string) || randomUUID();
  const requestId = req.requestId ?? (req.headers[REQUEST_ID_HEADER] as string) || randomUUID();
  res.setHeader('X-Trace-Id', traceId);

  runWithLogContext({ traceId, requestId }, () => {
    mergeLogContext({ traceId, requestId });
    next();
  });
}

export function bindAsyncContext<T>(fn: () => Promise<T>, partial?: Partial<{ traceId: string; requestId: string; module: string }>): Promise<T> {
  const parent = getLogContext();
  const ctx = {
    traceId: partial?.traceId ?? parent?.traceId ?? randomUUID(),
    requestId: partial?.requestId ?? parent?.requestId,
    module: partial?.module ?? parent?.module,
  };
  return logContextStorage.run(ctx, fn);
}
