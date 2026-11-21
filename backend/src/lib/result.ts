export type Result<T, E = ServiceError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface ServiceError {
  code: string;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E extends ServiceError>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}

export async function fromThrowable<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await operation());
  } catch (error) {
    return err(toServiceError(error));
  }
}

export function toServiceError(error: unknown): ServiceError {
  if (typeof error === 'object' && error !== null && 'statusCode' in error && 'code' in error && 'message' in error) {
    const typed = error as { statusCode: number; code: string; message: string; details?: Record<string, unknown> };
    return {
      code: typed.code,
      message: typed.message,
      statusCode: typed.statusCode,
      details: typed.details,
      cause: error,
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : 'Unexpected service error',
    statusCode: 500,
    cause: error,
  };
}
