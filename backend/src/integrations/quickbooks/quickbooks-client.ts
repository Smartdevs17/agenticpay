import type { QuickBooksConfig } from './types.js';

interface QuickBooksQueryResponse<T> {
  QueryResponse: Record<string, T[] | number | undefined>;
}

/**
 * QuickBooks Online Accounting API v3 client.
 *
 * Each request is scoped to the configured company (`realmId`). OAuth access
 * tokens must be supplied by the caller.
 */
export class QuickBooksClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly minorVersion: string;
  private readonly timeoutMs: number;

  constructor(config: QuickBooksConfig) {
    if (!config.accessToken || !config.realmId) {
      throw new Error('QuickBooks accessToken and realmId are required');
    }

    this.accessToken = config.accessToken;
    this.baseUrl = (
      config.baseUrl ??
      `https://quickbooks.api.intuit.com/v3/company/${config.realmId}`
    ).replace(/\/+$/, '');
    this.minorVersion = config.minorVersion ?? '65';
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const separator = path.includes('?') ? '&' : '?';
    const response = await fetch(
      `${this.baseUrl}${path}${separator}minorversion=${this.minorVersion}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `QuickBooks API error ${response.status}: ${response.statusText} – ${errorText}`,
      );
    }

    if (response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  }

  async query<T>(query: string): Promise<T[]> {
    const result = await this.request<QuickBooksQueryResponse<T>>(
      'GET',
      `/query?query=${encodeURIComponent(query)}`,
    );
    const response = result.QueryResponse ?? {};
    const key = Object.keys(response).find((entry) => entry !== 'startPosition' && entry !== 'maxResults' && entry !== 'totalCount');
    if (!key) return [];
    const value = response[key];
    return Array.isArray(value) ? value : [];
  }

  async create<T>(entity: string, payload: Record<string, unknown>, requestId?: string): Promise<T> {
    const suffix = requestId ? `?requestid=${encodeURIComponent(requestId)}` : '';
    const result = await this.request<Record<string, T>>(
      'POST',
      `/${entity}${suffix}`,
      payload,
    );
    const created = result[entity];
    if (!created) {
      throw new Error(`QuickBooks did not return the created ${entity}`);
    }
    return created;
  }

  async getInvoice(id: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', `/invoice/${id}`);
  }

  /**
   * Escapes a value for safe interpolation into a QuickBooks query string.
   */
  static escapeQuery(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }
}
