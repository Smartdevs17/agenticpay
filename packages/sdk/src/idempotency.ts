export interface IdempotencyRetryContext {
  idempotencyKey: string;
  attempt: number;
}

export interface IdempotencyRetryOptions {
  idempotencyKey?: string;
  keyPrefix?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  shouldRetry?: (error: unknown, context: IdempotencyRetryContext) => boolean;
  sleep?: (delayMs: number) => Promise<void>;
}

export function createIdempotencyKey(prefix = 'ap'): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.randomUUID) {
    throw new Error('Web Crypto randomUUID is required to create an idempotency key');
  }
  return `${prefix}_${cryptoApi.randomUUID()}`;
}

/**
 * Retry a mutating operation while reusing one idempotency key for every attempt.
 * The operation owns transport-specific headers and must attach the provided key.
 */
export async function withIdempotencyRetry<T>(
  operation: (context: IdempotencyRetryContext) => Promise<T>,
  options: IdempotencyRetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 250;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError('maxRetries must be a non-negative integer');
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw new RangeError('baseDelayMs must be a non-negative number');
  }

  const idempotencyKey = options.idempotencyKey ?? createIdempotencyKey(options.keyPrefix);
  const sleep = options.sleep ?? ((delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const context = { idempotencyKey, attempt };
    try {
      return await operation(context);
    } catch (error) {
      const retry = options.shouldRetry?.(error, context) ?? true;
      if (!retry || attempt === maxRetries) throw error;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }

  throw new Error('Idempotency retry loop terminated unexpectedly');
}
