import { AgenticPayError } from './errors/base.js';
export { AgenticPayError } from './errors/base.js';

export class AuthenticationError extends AgenticPayError {
  constructor(message = 'Authentication failed', details?: unknown) {
    super(message, { status: 401, code: 'AUTHENTICATION_ERROR', details });
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends AgenticPayError {
  constructor(message = 'Not authorized', details?: unknown) {
    super(message, { status: 403, code: 'AUTHORIZATION_ERROR', details });
    this.name = 'AuthorizationError';
  }
}

export class ValidationError extends AgenticPayError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, { status: 400, code: 'VALIDATION_ERROR', details });
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends AgenticPayError {
  constructor(message = 'Rate limit exceeded', details?: unknown) {
    super(message, { status: 429, code: 'RATE_LIMIT_EXCEEDED', details });
    this.name = 'RateLimitError';
  }
}

export class NetworkError extends AgenticPayError {
  constructor(message = 'Network request failed', details?: unknown) {
    super(message, { code: 'NETWORK_ERROR', details });
    this.name = 'NetworkError';
  }
}

export * from './errors/generated.js';
