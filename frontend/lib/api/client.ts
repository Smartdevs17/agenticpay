import {
  OfflineActionQueuedError,
  isLikelyOfflineError,
  queueOfflineAction,
  shouldQueueRequest,
} from '@/lib/offline';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001/api/v1';

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  jitter: true,
};

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  jitter: boolean;
}

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

export function resolveApiUrl(endpoint: string) {
  return `${API_BASE_URL}${endpoint}`;
}

function shouldRetryStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function shouldRetryError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return shouldRetryStatus(error.status);
  }

  if (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'AbortError')
  ) {
    return false;
  }

  return true;
}

function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelay * Math.pow(2, attempt);
  const delay = Math.min(exponentialDelay, config.maxDelay);
  return config.jitter ? delay * (0.5 + Math.random()) : delay;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  const message =
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
      ? error.message
      : String(error);

  const normalized = new Error(message);

  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof error.name === 'string'
  ) {
    normalized.name = error.name;
  }

  return normalized;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';

  if (response.status === 204) {
    return null;
  }

  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return text.length > 0 ? text : null;
}

function getErrorMessage(statusText: string, data: unknown): string {
  if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
    return data.message;
  }

  if (typeof data === 'string' && data.trim().length > 0) {
    return data;
  }

  return `API Error: ${statusText}`;
}

export async function apiCall<T = unknown>(
  endpoint: string,
  options: RequestInit = {},
  retryConfig?: Partial<RetryConfig>
): Promise<T> {
  const config = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  let lastError: Error | undefined;
  const shouldQueue = shouldQueueRequest(options);

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
          ...options.headers,
        },
      });

      const data = await parseResponseBody(response);

      if (response.ok) {
        return data as T;
      }

      throw new ApiError(
        getErrorMessage(response.statusText, data),
        response.status,
        response,
        data
      );
    } catch (error) {
      lastError = normalizeError(error);

      if (shouldQueue && isLikelyOfflineError(lastError)) {
        const action = queueOfflineAction(endpoint, options);
        throw new OfflineActionQueuedError(
          'The request was queued because the network is unavailable.',
          endpoint,
          action.id
        );
      }

      if (attempt === config.maxRetries || !shouldRetryError(error)) {
        throw lastError;
      }

      await delay(calculateDelay(attempt, config));
    }
  }

  throw lastError || new Error('API call failed after retries');
}
