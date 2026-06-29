export type ErrorCategory =
  | 'auth'
  | 'validation'
  | 'payment'
  | 'blockchain'
  | 'rate_limit'
  | 'configuration'
  | 'internal';

export interface ErrorCodeDefinition {
  code: `ERR_${string}`;
  category: ErrorCategory;
  httpStatus: number;
  message: string;
  description: string;
  resolution: string;
  deprecated?: boolean;
  sunsetAt?: string;
  replacedBy?: `ERR_${string}`;
}

export const ERROR_CODE_REGISTRY = {
  ERR_AUTH_UNAUTHENTICATED: {
    code: 'ERR_AUTH_UNAUTHENTICATED',
    category: 'auth',
    httpStatus: 401,
    message: 'Authentication required',
    description: 'The request did not include valid authentication credentials.',
    resolution: 'Send a valid bearer token or API key and retry.',
  },
  ERR_AUTH_FORBIDDEN: {
    code: 'ERR_AUTH_FORBIDDEN',
    category: 'auth',
    httpStatus: 403,
    message: 'Not authorized',
    description: 'The authenticated principal is not allowed to perform this action.',
    resolution: 'Check account permissions, tenant access, and API key scopes.',
  },
  ERR_VALIDATION_FAILED: {
    code: 'ERR_VALIDATION_FAILED',
    category: 'validation',
    httpStatus: 400,
    message: 'Request validation failed',
    description: 'The request body, query string, path params, or response payload violated the API schema.',
    resolution: 'Inspect the details array and send values matching the documented OpenAPI schema.',
  },
  ERR_RESOURCE_NOT_FOUND: {
    code: 'ERR_RESOURCE_NOT_FOUND',
    category: 'validation',
    httpStatus: 404,
    message: 'Resource not found',
    description: 'The requested route or resource does not exist.',
    resolution: 'Verify the URL, API version, path parameters, and resource identifier.',
  },
  ERR_CONFIG_INVALID_VALUE: {
    code: 'ERR_CONFIG_INVALID_VALUE',
    category: 'configuration',
    httpStatus: 400,
    message: 'Invalid configuration value',
    description: 'A configuration update did not match the registered schema.',
    resolution: 'Use the configuration schema endpoint to confirm the expected type and constraints.',
  },
  ERR_CONFIG_CONFLICT: {
    code: 'ERR_CONFIG_CONFLICT',
    category: 'configuration',
    httpStatus: 409,
    message: 'Configuration update conflict',
    description: 'The configuration version changed before the update could be applied.',
    resolution: 'Reload the latest configuration and retry with the current version.',
  },
  ERR_PAYMENT_INSUFFICIENT_FUNDS: {
    code: 'ERR_PAYMENT_INSUFFICIENT_FUNDS',
    category: 'payment',
    httpStatus: 402,
    message: 'Insufficient funds',
    description: 'The payer does not have enough available balance to complete the payment.',
    resolution: 'Ask the payer to add funds or choose a smaller amount.',
  },
  ERR_BLOCKCHAIN_TRANSACTION_FAILED: {
    code: 'ERR_BLOCKCHAIN_TRANSACTION_FAILED',
    category: 'blockchain',
    httpStatus: 502,
    message: 'Blockchain transaction failed',
    description: 'A blockchain provider rejected or failed to finalize the transaction.',
    resolution: 'Review provider details, transaction hash, network health, and retry if appropriate.',
  },
  ERR_RATE_LIMIT_EXCEEDED: {
    code: 'ERR_RATE_LIMIT_EXCEEDED',
    category: 'rate_limit',
    httpStatus: 429,
    message: 'Rate limit exceeded',
    description: 'The caller exceeded the configured request allowance.',
    resolution: 'Back off until the reset time or request a higher tier.',
  },
  ERR_INTERNAL: {
    code: 'ERR_INTERNAL',
    category: 'internal',
    httpStatus: 500,
    message: 'Internal server error',
    description: 'An unexpected server-side error occurred.',
    resolution: 'Retry later. Contact support with the request ID if the problem persists.',
  },
} as const satisfies Record<string, ErrorCodeDefinition>;

export type ErrorCode = keyof typeof ERROR_CODE_REGISTRY;

const LEGACY_CODE_MAP: Record<string, ErrorCode> = {
  AUTHENTICATION_ERROR: 'ERR_AUTH_UNAUTHENTICATED',
  AUTHORIZATION_ERROR: 'ERR_AUTH_FORBIDDEN',
  FORBIDDEN: 'ERR_AUTH_FORBIDDEN',
  UNAUTHORIZED: 'ERR_AUTH_UNAUTHENTICATED',
  VALIDATION_ERROR: 'ERR_VALIDATION_FAILED',
  VALIDATION_FAILED: 'ERR_VALIDATION_FAILED',
  RATE_LIMIT_EXCEEDED: 'ERR_RATE_LIMIT_EXCEEDED',
  NOT_FOUND: 'ERR_RESOURCE_NOT_FOUND',
  INTERNAL_SERVER_ERROR: 'ERR_INTERNAL',
  UNSUPPORTED_API_VERSION: 'ERR_RESOURCE_NOT_FOUND',
};

export function isErrorCode(code: string): code is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CODE_REGISTRY, code);
}

export function resolveErrorCode(code?: string, status?: number): ErrorCode {
  if (code && isErrorCode(code)) return code;
  if (code && LEGACY_CODE_MAP[code]) return LEGACY_CODE_MAP[code];
  if (status === 401) return 'ERR_AUTH_UNAUTHENTICATED';
  if (status === 403) return 'ERR_AUTH_FORBIDDEN';
  if (status === 400) return 'ERR_VALIDATION_FAILED';
  if (status === 404) return 'ERR_RESOURCE_NOT_FOUND';
  if (status === 409) return 'ERR_CONFIG_CONFLICT';
  if (status === 429) return 'ERR_RATE_LIMIT_EXCEEDED';
  return 'ERR_INTERNAL';
}

export function listErrorCodes(): ErrorCodeDefinition[] {
  return Object.values(ERROR_CODE_REGISTRY);
}
