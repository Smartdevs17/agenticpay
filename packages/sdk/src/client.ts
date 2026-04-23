import {
  AgenticPayClientOptions,
  RequestContext,
  RequestInterceptor,
  ResponseContext,
  ResponseInterceptor,
} from './types.js';
import {
  AgenticPayError,
  AuthenticationError,
  AuthorizationError,
  NetworkError,
  RateLimitError,
  ValidationError,
} from './errors.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class AgenticPayClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly retryConfig: Required<NonNullable<AgenticPayClientOptions['retry']>>;
  private readonly requestInterceptors: RequestInterceptor[] = [];
  private readonly responseInterceptors: ResponseInterceptor[] = [];

  constructor(options: AgenticPayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.retryConfig = {
      attempts: options.retry?.attempts ?? 2,
      baseDelayMs: options.retry?.baseDelayMs ?? 250,
      retryableStatusCodes: options.retry?.retryableStatusCodes ?? [408, 429, 500, 502, 503, 504],
    };
  }

  addRequestInterceptor(interceptor: RequestInterceptor): void {
    this.requestInterceptors.push(interceptor);
  }

  addResponseInterceptor(interceptor: ResponseInterceptor): void {
    this.responseInterceptors.push(interceptor);
  }

  async get<T>(path: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', path, undefined, headers);
  }

  async post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('POST', path, body, headers);
  }

  async patch<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('PATCH', path, body, headers);
  }

  async delete<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('DELETE', path, body, headers);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ): Promise<T> {
    const mergedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
      ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
    };

    let context: RequestContext = { method, path, headers: mergedHeaders, body };
    for (const interceptor of this.requestInterceptors) {
      context = await interceptor(context);
    }

    let attempt = 0;
    while (attempt <= this.retryConfig.attempts) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}${context.path}`, {
          method: context.method,
          headers: context.headers,
          body: context.body !== undefined ? JSON.stringify(context.body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const data = await response.json().catch(() => null);
        let responseContext: ResponseContext<T> = {
          status: response.status,
          headers: response.headers,
          data: data as T,
        };
        for (const interceptor of this.responseInterceptors) {
          responseContext = await interceptor(responseContext);
        }

        if (!response.ok) {
          if (
            this.retryConfig.retryableStatusCodes.includes(response.status) &&
            attempt < this.retryConfig.attempts
          ) {
            await sleep(this.retryConfig.baseDelayMs * Math.pow(2, attempt));
            attempt += 1;
            continue;
          }
          throw this.toApiError(response.status, data);
        }

        return responseContext.data;
      } catch (error) {
        clearTimeout(timeout);
        if (error instanceof AgenticPayError) throw error;
        if (attempt >= this.retryConfig.attempts) {
          throw new NetworkError('Request failed after retries', error);
        }
        await sleep(this.retryConfig.baseDelayMs * Math.pow(2, attempt));
        attempt += 1;
      }
    }

    throw new NetworkError('Unexpected retry termination');
  }

  private toApiError(status: number, payload: any): AgenticPayError {
    const message = payload?.error?.message ?? payload?.message ?? 'Request failed';
    const code = payload?.error?.code ?? payload?.code;
    const details = payload?.error?.details ?? payload?.errors ?? payload;

    if (status === 400) return new ValidationError(message, details);
    if (status === 401) return new AuthenticationError(message, details);
    if (status === 403) return new AuthorizationError(message, details);
    if (status === 429) return new RateLimitError(message, details);
    return new AgenticPayError(message, { status, code, details });
  }
}
