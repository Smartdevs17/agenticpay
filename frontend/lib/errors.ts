export interface AppError {
  code: string;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
  timestamp?: string;
  requestId?: string;
  userId?: string;
}

export type ErrorDomain = 'payment' | 'auth' | 'project' | 'dispute' | 'validation' | 'not_found' | 'internal';

export interface DomainErrorConfig {
  domain: ErrorDomain;
  defaultCode: string;
  defaultStatus: number;
}

export const DOMAIN_ERROR_CONFIG: Record<ErrorDomain, DomainErrorConfig> = {
  payment: { domain: 'payment', defaultCode: 'PAYMENT_ERROR', defaultStatus: 400 },
  auth: { domain: 'auth', defaultCode: 'AUTH_ERROR', defaultStatus: 401 },
  project: { domain: 'project', defaultCode: 'PROJECT_ERROR', defaultStatus: 400 },
  dispute: { domain: 'dispute', defaultCode: 'DISPUTE_ERROR', defaultStatus: 400 },
  validation: { domain: 'validation', defaultCode: 'VALIDATION_ERROR', defaultStatus: 422 },
  not_found: { domain: 'not_found', defaultCode: 'NOT_FOUND', defaultStatus: 404 },
  internal: { domain: 'internal', defaultCode: 'INTERNAL_SERVER_ERROR', defaultStatus: 500 },
};

export function createError(
  domain: ErrorDomain,
  message: string,
  statusCode?: number,
  details?: Record<string, unknown>,
): AppError {
  const config = DOMAIN_ERROR_CONFIG[domain];
  return {
    code: config.defaultCode,
    message,
    statusCode: statusCode ?? config.defaultStatus,
    details,
    timestamp: new Date().toISOString(),
  };
}

export function isAppError(error: unknown): error is AppError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    'statusCode' in error
  );
}

export function getErrorMessage(error: unknown): string {
  if (isAppError(error)) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected error occurred';
}

export function getErrorCode(error: unknown): string {
  if (isAppError(error)) {
    return error.code;
  }
  return 'UNKNOWN_ERROR';
}
