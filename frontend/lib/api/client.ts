// frontend/lib/api/client.ts
import {
  OfflineActionQueuedError,
  isLikelyOfflineError,
  queueOfflineAction,
  shouldQueueRequest,
} from '@/lib/offline';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  'http://localhost:3001/api/v1';

/* =====================================================
   Retry Configuration
===================================================== */
export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  jitter: boolean;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  jitter: true,
};

/* =====================================================
   Custom API Error
===================================================== */
export class ApiError extends Error {
  status: number;
  response: Response;
  data?: unknown;

  constructor(message: string, status: number, response: Response, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.response = response;
    this.data = data;
  }
}

/** Type guard for UI handling */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/* =====================================================
   URL Resolver
===================================================== */
export function resolveApiUrl(endpoint: string) {
  return `${API_BASE_URL}${endpoint}`;
}

/* =====================================================
   Retry Helpers
===================================================== */
function shouldRetryStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function shouldRetryError(error: unknown): boolean {
  if (error instanceof ApiError) return shouldRetryStatus(error.status);

  // Abort should NOT retry
  if (error instanceof Error && error.name === 'AbortError') return false;

  // Network errors → retry
  return true;
}

function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelay * Math.pow(2, attempt);
  const delay = Math.min(exponentialDelay, config.maxDelay);
  return config.jitter ? delay * (0.5 + Math.random()) : delay;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* =====================================================
   Error Normalization
===================================================== */
function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;

  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof (error as any).message === 'string'
      ? (error as any).message
      : String(error);

  const normalized = new Error(message);

  if (typeof error === 'object' && error !== null && 'name' in error && typeof (error as any).name === 'string') {
    normalized.name = (error as any).name;
  }

  return normalized;
}

/* =====================================================
   Response Parsing
===================================================== */
async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';

  if (response.status === 204) return null;

  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return text.length > 0 ? text : null;
}

/* =====================================================
   Friendly Error Messages
===================================================== */
function getErrorMessage(status: number, statusText: string, data: unknown): string {
  if (data && typeof data === 'object' && 'message' in data && typeof (data as any).message === 'string') {
    return (data as any).message;
  }

  switch (status) {
    case 400:
      return 'Invalid request. Please check your input.';
    case 401:
      return 'You are not authenticated. Please login again.';
    case 403:
      return 'You do not have permission to perform this action.';
    case 404:
      return 'Requested resource was not found.';
    case 429:
      return 'Too many requests. Please try again shortly.';
    case 500:
      return 'Server error. Please try again later.';
    default:
      return `Request failed: ${statusText}`;
  }
}

/* =====================================================
   Main API Call
===================================================== */
export async function apiCall<T = unknown>(
  endpoint: string,
  options: RequestInit = {},
  retryConfig?: Partial<RetryConfig>
): Promise<T> {
  const config = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  let lastError: Error | undefined;
  const shouldQueue = shouldQueueRequest(options);

  // Queue immediately if offline
  if (shouldQueue && typeof navigator !== 'undefined' && navigator.onLine === false) {
    const action = queueOfflineAction(endpoint, options);
    throw new OfflineActionQueuedError(
      'You are offline. This action has been queued and will sync when the connection returns.',
      endpoint,
      action.id
    );
  }

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const response = await fetch(resolveApiUrl(endpoint), {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });

      const data = await parseResponseBody(response);

      if (response.ok) return data as T;

      throw new ApiError(getErrorMessage(response.status, response.statusText, data), response.status, response, data);
    } catch (error) {
      lastError = normalizeError(error);

      // Debug logging
      console.error('[API ERROR]', { endpoint, attempt, error: lastError });

      // Queue request if offline
      if (shouldQueue && isLikelyOfflineError(lastError)) {
        const action = queueOfflineAction(endpoint, options);
        throw new OfflineActionQueuedError(
          'Network unavailable. Request queued.',
          endpoint,
          action.id
        );
      }

      if (attempt === config.maxRetries || !shouldRetryError(error)) throw lastError;

      await delay(calculateDelay(attempt, config));
    }
  }

  throw lastError || new Error('API call failed after retries');
}