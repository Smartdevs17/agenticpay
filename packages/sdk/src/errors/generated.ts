import { ERROR_CODE_REGISTRY, type ErrorCode, type ErrorCodeDefinition } from '@agenticpay/error-codes';
import { AgenticPayError } from './base.js';

export class AgenticPayApiError extends AgenticPayError {
  readonly registryEntry: ErrorCodeDefinition;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    const entry = ERROR_CODE_REGISTRY[code];
    super(message ?? entry.message, { status: entry.httpStatus, code, details });
    this.name = `${code
      .replace(/^ERR_/, '')
      .toLowerCase()
      .replace(/(^|_)([a-z])/g, (_match, _prefix, char) => char.toUpperCase())}Error`;
    this.registryEntry = entry;
  }
}

export class AuthUnauthenticatedError extends AgenticPayApiError {
  constructor(message?: string, details?: unknown) {
    super('ERR_AUTH_UNAUTHENTICATED', message, details);
  }
}

export class AuthForbiddenError extends AgenticPayApiError {
  constructor(message?: string, details?: unknown) {
    super('ERR_AUTH_FORBIDDEN', message, details);
  }
}

export class RequestValidationError extends AgenticPayApiError {
  constructor(message?: string, details?: unknown) {
    super('ERR_VALIDATION_FAILED', message, details);
  }
}

export class ConfigInvalidValueError extends AgenticPayApiError {
  constructor(message?: string, details?: unknown) {
    super('ERR_CONFIG_INVALID_VALUE', message, details);
  }
}

export class ResourceNotFoundError extends AgenticPayApiError {
  constructor(message?: string, details?: unknown) {
    super('ERR_RESOURCE_NOT_FOUND', message, details);
  }
}

export class ConfigConflictError extends AgenticPayApiError {
  constructor(message?: string, details?: unknown) {
    super('ERR_CONFIG_CONFLICT', message, details);
  }
}

export class PaymentInsufficientFundsError extends AgenticPayApiError {
  constructor(message?: string, details?: unknown) {
    super('ERR_PAYMENT_INSUFFICIENT_FUNDS', message, details);
  }
}

export class BlockchainTransactionFailedError extends AgenticPayApiError {
  constructor(message?: string, details?: unknown) {
    super('ERR_BLOCKCHAIN_TRANSACTION_FAILED', message, details);
  }
}

export class ApiRateLimitError extends AgenticPayApiError {
  constructor(message?: string, details?: unknown) {
    super('ERR_RATE_LIMIT_EXCEEDED', message, details);
  }
}

export class InternalApiError extends AgenticPayApiError {
  constructor(message?: string, details?: unknown) {
    super('ERR_INTERNAL', message, details);
  }
}

const ERROR_CLASS_BY_CODE = {
  ERR_AUTH_UNAUTHENTICATED: AuthUnauthenticatedError,
  ERR_AUTH_FORBIDDEN: AuthForbiddenError,
  ERR_VALIDATION_FAILED: RequestValidationError,
  ERR_RESOURCE_NOT_FOUND: ResourceNotFoundError,
  ERR_CONFIG_INVALID_VALUE: ConfigInvalidValueError,
  ERR_CONFIG_CONFLICT: ConfigConflictError,
  ERR_PAYMENT_INSUFFICIENT_FUNDS: PaymentInsufficientFundsError,
  ERR_BLOCKCHAIN_TRANSACTION_FAILED: BlockchainTransactionFailedError,
  ERR_RATE_LIMIT_EXCEEDED: ApiRateLimitError,
  ERR_INTERNAL: InternalApiError,
} satisfies Record<ErrorCode, new (message?: string, details?: unknown) => AgenticPayApiError>;

export function createTypedApiError(code: string, message?: string, details?: unknown): AgenticPayApiError {
  const ErrorClass = ERROR_CLASS_BY_CODE[code as ErrorCode] ?? InternalApiError;
  return new ErrorClass(message, details);
}
