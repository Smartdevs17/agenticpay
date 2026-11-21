import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export const TRACE_ID_HEADER = 'x-trace-id';

export const traceStorage = new AsyncLocalStorage<string>();

export function traceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceId = (req.headers[TRACE_ID_HEADER] as string) || randomUUID();
  res.setHeader('X-Trace-Id', traceId);

  traceStorage.run(traceId, () => {
    next();
  });
}

export function getTraceId(): string | undefined {
  return traceStorage.getStore();
}
