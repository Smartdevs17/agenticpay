import { AsyncLocalStorage } from 'node:async_hooks';

export interface LogContext {
  traceId: string;
  requestId?: string;
  module?: string;
}

export const logContextStorage = new AsyncLocalStorage<LogContext>();

export function getLogContext(): LogContext | undefined {
  return logContextStorage.getStore();
}

export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  return logContextStorage.run(ctx, fn);
}

export function mergeLogContext(partial: Partial<LogContext>): void {
  const store = logContextStorage.getStore();
  if (store) {
    Object.assign(store, partial);
  }
}
