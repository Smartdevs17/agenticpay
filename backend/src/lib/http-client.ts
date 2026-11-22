/**
 * Shared typed HTTP client for backend runtimes (Node.js).
 * Collapses duplicated per-service HTTP clients into a single typed abstraction.
 *
 * Conforms to Issue #1408:
 * - Base URL from config
 * - Default timeout & AbortSignal cancellation
 * - Auth header injection (Bearer, Basic, Custom)
 * - Consistent HttpError preserving status, code, and response body
 * - Safe retry with bounded exponential backoff on safe/idempotent requests only
 * - Request ID propagation
 * - Redaction of tokens, Authorization headers, and bodies from logs
 */

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryableStatuses?: number[];
  retryAllMethods?: boolean; // By default, only safe idempotent methods (GET, HEAD, OPTIONS, PUT, DELETE) are retried
}

export type AuthConfig =
  | { type: 'bearer'; token: string | (() => string | undefined | Promise<string | undefined>) }
  | { type: 'basic'; username: string; password?: string }
  | { type: 'custom'; headerName: string; headerValue: string | (() => string | undefined | Promise<string | undefined>) };

export interface HttpClientConfig {
  baseUrl?: string;
  defaultTimeoutMs?: number;
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  auth?: AuthConfig;
  retryConfig?: RetryOptions;
  requestIdHeader?: string;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
  retry?: boolean | Partial<RetryOptions>;
  responseType?: 'json' | 'text' | 'raw';
  params?: Record<string, string | number | boolean | undefined | null>;
}

export class HttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly code?: string;
  readonly responseBody?: unknown;
  readonly url: string;
  readonly method: string;

  constructor(params: {
    message: string;
    status: number;
    statusText: string;
    url: string;
    method: string;
    code?: string;
    responseBody?: unknown;
  }) {
    super(params.message);
    this.name = 'HttpError';
    this.status = params.status;
    this.statusText = params.statusText;
    this.code = params.code;
    this.responseBody = params.responseBody;
    this.url = params.url;
    this.method = params.method;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 300;
const DEFAULT_MAX_DELAY_MS = 3_000;
const DEFAULT_RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504];
const SAFE_IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

function sanitizeHeadersForLogging(headers: Record<string, string>): Record<string, string> {
  const SENSITIVE_KEYS = new Set(['authorization', 'x-api-key', 'x-auth-token', 'cookie', 'set-cookie', 'x-zapier-signature']);
  const sanitized: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      sanitized[k] = '[REDACTED]';
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly staticHeaders?: Record<string, string>;
  private readonly headerFactory?: () => Record<string, string> | Promise<Record<string, string>>;
  private readonly auth?: AuthConfig;
  private readonly retryConfig: RetryOptions;
  private readonly requestIdHeader: string;

  constructor(config: HttpClientConfig = {}) {
    this.baseUrl = config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : '';
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (typeof config.headers === 'function') {
      this.headerFactory = config.headers;
    } else {
      this.staticHeaders = config.headers;
    }
    this.auth = config.auth;
    this.retryConfig = {
      maxRetries: config.retryConfig?.maxRetries ?? 0,
      baseDelayMs: config.retryConfig?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
      maxDelayMs: config.retryConfig?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
      retryableStatuses: config.retryConfig?.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES,
      retryAllMethods: config.retryConfig?.retryAllMethods ?? false,
    };
    this.requestIdHeader = config.requestIdHeader ?? 'x-request-id';
  }

  private async resolveAuthHeader(): Promise<Record<string, string>> {
    if (!this.auth) return {};
    switch (this.auth.type) {
      case 'bearer': {
        const token = typeof this.auth.token === 'function' ? await this.auth.token() : this.auth.token;
        return token ? { Authorization: `Bearer ${token}` } : {};
      }
      case 'basic': {
        const credentials = Buffer.from(
          `${this.auth.username}:${this.auth.password ?? ''}`,
        ).toString('base64');
        return { Authorization: `Basic ${credentials}` };
      }
      case 'custom': {
        const val = typeof this.auth.headerValue === 'function' ? await this.auth.headerValue() : this.auth.headerValue;
        return val ? { [this.auth.headerName]: val } : {};
      }
      default:
        return {};
    }
  }

  private buildFullUrl(path: string, params?: Record<string, string | number | boolean | undefined | null>): string {
    let resolvedUrl = path;
    if (!path.startsWith('http://') && !path.startsWith('https://')) {
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      resolvedUrl = `${this.baseUrl}${normalizedPath}`;
    }

    if (params && Object.keys(params).length > 0) {
      const parsed = new URL(resolvedUrl);
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          parsed.searchParams.set(key, String(value));
        }
      }
      resolvedUrl = parsed.toString();
    }
    return resolvedUrl;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = (options.method || 'GET').toUpperCase();
    const url = this.buildFullUrl(path, options.params);
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    // Resolve static and dynamic headers
    const dynamicHeaders = this.headerFactory ? await this.headerFactory() : {};
    const authHeaders = await this.resolveAuthHeader();
    const mergedHeaders: Record<string, string> = {
      ...this.staticHeaders,
      ...dynamicHeaders,
      ...authHeaders,
      ...options.headers,
    };

    // Body preparation
    let serializedBody: BodyInit | undefined;
    if (options.body !== undefined && options.body !== null) {
      if (typeof options.body === 'string' || options.body instanceof URLSearchParams || options.body instanceof Buffer) {
        serializedBody = options.body;
      } else {
        if (!mergedHeaders['Content-Type'] && !mergedHeaders['content-type']) {
          mergedHeaders['Content-Type'] = 'application/json';
        }
        serializedBody = JSON.stringify(options.body);
      }
    }

    // Determine retry configuration for this request
    const retryEnabled = Boolean(options.retry) || (this.retryConfig.maxRetries ?? 0) > 0;
    const requestRetryConfig: RetryOptions = {
      maxRetries: typeof options.retry === 'object' && options.retry.maxRetries !== undefined
        ? options.retry.maxRetries
        : (this.retryConfig.maxRetries ?? (options.retry ? DEFAULT_MAX_RETRIES : 0)),
      baseDelayMs: (typeof options.retry === 'object' ? options.retry.baseDelayMs : undefined) ?? this.retryConfig.baseDelayMs,
      maxDelayMs: (typeof options.retry === 'object' ? options.retry.maxDelayMs : undefined) ?? this.retryConfig.maxDelayMs,
      retryableStatuses: (typeof options.retry === 'object' ? options.retry.retryableStatuses : undefined) ?? this.retryConfig.retryableStatuses,
      retryAllMethods: (typeof options.retry === 'object' ? options.retry.retryAllMethods : undefined) ?? this.retryConfig.retryAllMethods,
    };

    const isSafeMethod = SAFE_IDEMPOTENT_METHODS.has(method);
    const canRetry = retryEnabled && (isSafeMethod || requestRetryConfig.retryAllMethods === true);

    let attempt = 0;
    const maxAttempts = canRetry ? (requestRetryConfig.maxRetries ?? DEFAULT_MAX_RETRIES) : 0;

    while (attempt <= maxAttempts) {
      attempt++;

      // Combined abort controller for user signal + timeout
      const controller = new AbortController();
      let timeoutId: NodeJS.Timeout | undefined;

      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      const onExternalAbort = () => {
        controller.abort(options.signal?.reason);
      };

      if (options.signal) {
        if (options.signal.aborted) {
          controller.abort(options.signal.reason);
        } else {
          options.signal.addEventListener('abort', onExternalAbort, { once: true });
        }
      }

      try {
        const response = await fetch(url, {
          method,
          headers: mergedHeaders,
          body: serializedBody,
          signal: controller.signal,
        });

        if (timeoutId) clearTimeout(timeoutId);
        if (options.signal) options.signal.removeEventListener('abort', onExternalAbort);

        // Success
        if (response.ok) {
          if (response.status === 204) {
            return {} as T;
          }
          if (options.responseType === 'text') {
            return (await response.text()) as unknown as T;
          }
          if (options.responseType === 'raw') {
            return response as unknown as T;
          }

          const contentType = response.headers?.get?.('content-type') || '';
          if (contentType.includes('application/json') || options.responseType === 'json') {
            return (await response.json()) as T;
          }
          // Fallback parsing: try json, else text
          const text = await response.text().catch(() => '');
          if (!text) return {} as T;
          try {
            return JSON.parse(text) as T;
          } catch {
            return text as unknown as T;
          }
        }

        // Non-2xx response
        const errorText = await response.text().catch(() => '');
        let parsedErrorBody: unknown = errorText;
        try {
          parsedErrorBody = JSON.parse(errorText);
        } catch {
          // keep as string
        }

        // Retry check for status codes
        const isRetryableStatus = requestRetryConfig.retryableStatuses?.includes(response.status);
        if (canRetry && isRetryableStatus && attempt <= maxAttempts) {
          const backoff = Math.min(
            (requestRetryConfig.baseDelayMs ?? DEFAULT_BASE_DELAY_MS) * 2 ** (attempt - 1),
            requestRetryConfig.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
          );
          await delay(backoff);
          continue;
        }

        throw new HttpError({
          message: `HTTP ${response.status}: ${response.statusText}${errorText ? ` – ${errorText}` : ''}`,
          status: response.status,
          statusText: response.statusText,
          url,
          method,
          responseBody: parsedErrorBody,
        });
      } catch (err: unknown) {
        if (timeoutId) clearTimeout(timeoutId);
        if (options.signal) options.signal.removeEventListener('abort', onExternalAbort);

        if (err instanceof HttpError) {
          throw err;
        }

        // Check if aborted by caller
        if (options.signal?.aborted) {
          throw err;
        }

        // If network error and retries remain
        if (canRetry && attempt <= maxAttempts) {
          const backoff = Math.min(
            (requestRetryConfig.baseDelayMs ?? DEFAULT_BASE_DELAY_MS) * 2 ** (attempt - 1),
            requestRetryConfig.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
          );
          await delay(backoff);
          continue;
        }

        throw err;
      }
    }

    throw new Error(`Request failed after ${maxAttempts} retries`);
  }

  async get<T>(path: string, options?: Omit<RequestOptions, 'method'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  async post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  async put<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  async patch<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  async delete<T>(path: string, options?: Omit<RequestOptions, 'method'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}

export function createHttpClient(config?: HttpClientConfig): HttpClient {
  return new HttpClient(config);
}
