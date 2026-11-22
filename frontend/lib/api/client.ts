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
  retryAllMethods?: boolean;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  jitter: true,
  retryAllMethods: false,
};

/* =====================================================
   Custom API Error
===================================================== */
export class ApiError extends Error {
  status: number;
  response: Response;
  data?: unknown;
  code?: string;

  constructor(message: string, status: number, response: Response, data?: unknown, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.response = response;
    this.data = data;
    this.code = code;
  }
}

export function resolveApiUrl(endpoint: string) {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  return `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
}

function shouldRetryStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function shouldRetryError(error: unknown): boolean {
  if (error instanceof ApiError) return shouldRetryStatus(error.status);

  const err = normalizeError(error);
  if (err.name === 'AbortError' || err.message.includes('aborted')) {
    return false;
  }

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
    typeof error === 'object' && error !== null && 'message' in error && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message?: string }).message
      : String(error);

  const normalized = new Error(message);

  if (typeof error === 'object' && error !== null && 'name' in error && typeof (error as { name?: unknown }).name === 'string') {
    normalized.name = (error as { name?: string }).name!;
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
  if (
    data &&
    typeof data === 'object' &&
    'message' in data &&
    typeof (data as { message?: unknown }).message === 'string'
  ) {
    return (data as { message: string }).message;
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
   Browser HTTP Client Class
===================================================== */
export interface BrowserHttpClientConfig {
  baseUrl?: string;
  defaultTimeoutMs?: number;
  getAuthToken?: () => string | null | undefined | Promise<string | null | undefined>;
  retryConfig?: Partial<RetryConfig>;
}

export interface BrowserRequestOptions extends RequestInit {
  timeoutMs?: number;
  retryConfig?: Partial<RetryConfig>;
  params?: Record<string, string | number | boolean | undefined | null>;
}

export class BrowserHttpClient {
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly getAuthToken?: () => string | null | undefined | Promise<string | null | undefined>;
  private readonly retryConfig: RetryConfig;

  constructor(config: BrowserHttpClientConfig = {}) {
    this.baseUrl = config.baseUrl || API_BASE_URL;
    this.defaultTimeoutMs = config.defaultTimeoutMs || 15_000;
    this.getAuthToken = config.getAuthToken;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config.retryConfig };
  }

  private resolveUrl(endpoint: string, params?: Record<string, string | number | boolean | undefined | null>): string {
    let url = endpoint.startsWith('http://') || endpoint.startsWith('https://')
      ? endpoint
      : `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

    if (params && Object.keys(params).length > 0) {
      const parsed = new URL(url);
      for (const [key, val] of Object.entries(params)) {
        if (val !== undefined && val !== null) {
          parsed.searchParams.set(key, String(val));
        }
      }
      url = parsed.toString();
    }
    return url;
  }

  async request<T = unknown>(
    endpoint: string,
    options: BrowserRequestOptions = {}
  ): Promise<T> {
    const config = { ...this.retryConfig, ...options.retryConfig };
    const method = (options.method || 'GET').toUpperCase();
    const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(method);
    const allowRetry = isSafeMethod || Boolean(config.retryAllMethods);
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

    const maxRetries = allowRetry ? config.maxRetries : 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(options.headers as Record<string, string> || {}),
        };

        if (this.getAuthToken && !headers['Authorization'] && !headers['authorization']) {
          const token = await this.getAuthToken();
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }
        }

        const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
        const controller = new AbortController();
        let timeoutId: NodeJS.Timeout | undefined;

        if (timeoutMs > 0 && typeof setTimeout !== 'undefined') {
          timeoutId = setTimeout(() => {
            controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }

        const onExternalAbort = () => controller.abort(options.signal?.reason);
        if (options.signal) {
          if (options.signal.aborted) {
            controller.abort(options.signal.reason);
          } else {
            options.signal.addEventListener('abort', onExternalAbort, { once: true });
          }
        }

        let response: Response;
        try {
          response = await fetch(this.resolveUrl(endpoint, options.params), {
            ...options,
            headers,
            signal: controller.signal,
          });
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
          if (options.signal) options.signal.removeEventListener('abort', onExternalAbort);
        }

        const data = await parseResponseBody(response);

        if (response.ok) return data as T;

        const code = data && typeof data === 'object' && 'code' in data ? String((data as { code: unknown }).code) : undefined;
        throw new ApiError(getErrorMessage(response.status, response.statusText, data), response.status, response, data, code);
      } catch (error: unknown) {
        lastError = normalizeError(error);

        if (shouldQueue && isLikelyOfflineError(lastError)) {
          const action = queueOfflineAction(endpoint, options);
          throw new OfflineActionQueuedError(
            'The request was queued because the network is unavailable.',
            endpoint,
            action.id
          );
        }

        if (attempt === maxRetries || !shouldRetryError(error) || !allowRetry) {
          throw lastError;
        }

        await delay(calculateDelay(attempt, config));
      }
    }

    throw lastError || new Error('API call failed after retries');
  }

  async get<T = unknown>(endpoint: string, options?: Omit<BrowserRequestOptions, 'method'>): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  async post<T = unknown>(endpoint: string, body?: unknown, options?: Omit<BrowserRequestOptions, 'method' | 'body'>): Promise<T> {
    const serializedBody = body !== undefined && typeof body !== 'string' ? JSON.stringify(body) : body as BodyInit;
    return this.request<T>(endpoint, { ...options, method: 'POST', body: serializedBody });
  }

  async put<T = unknown>(endpoint: string, body?: unknown, options?: Omit<BrowserRequestOptions, 'method' | 'body'>): Promise<T> {
    const serializedBody = body !== undefined && typeof body !== 'string' ? JSON.stringify(body) : body as BodyInit;
    return this.request<T>(endpoint, { ...options, method: 'PUT', body: serializedBody });
  }

  async patch<T = unknown>(endpoint: string, body?: unknown, options?: Omit<BrowserRequestOptions, 'method' | 'body'>): Promise<T> {
    const serializedBody = body !== undefined && typeof body !== 'string' ? JSON.stringify(body) : body as BodyInit;
    return this.request<T>(endpoint, { ...options, method: 'PATCH', body: serializedBody });
  }

  async delete<T = unknown>(endpoint: string, options?: Omit<BrowserRequestOptions, 'method'>): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const browserHttpClient = new BrowserHttpClient({
  retryConfig: { retryAllMethods: true }, // Keep backward compatible retry behavior for existing callers
});

/* =====================================================
   Main API Call (Preserved public API)
===================================================== */
export async function apiCall<T = unknown>(
  endpoint: string,
  options: RequestInit = {},
  retryConfig?: Partial<RetryConfig>
): Promise<T> {
  return browserHttpClient.request<T>(endpoint, {
    ...options,
    retryConfig: { retryAllMethods: true, ...retryConfig },
  });
}
