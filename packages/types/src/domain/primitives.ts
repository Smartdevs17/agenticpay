export type ISO8601 = string;
export type UUID = string;
export type CurrencyCode = string;

export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export type Option<T> = T | null | undefined;

export interface AppError {
  code: string;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
}
