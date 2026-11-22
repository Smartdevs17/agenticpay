import type { SalesforceConfig, SalesforceRecord } from './types.js';
import { createHttpClient, type HttpClient, HttpError } from '../../lib/http-client.js';

interface SalesforceQueryResponse<T> {
  totalSize: number;
  done: boolean;
  records: T[];
}

interface SalesforceCreateResponse {
  id: string;
  success: boolean;
  errors: unknown[];
}

/**
 * Thin Salesforce REST API client.
 *
 * The caller is responsible for supplying a valid OAuth access token. Token
 * refresh is intentionally left to the surrounding credential manager.
 */
export class SalesforceClient {
  private readonly instanceUrl: string;
  private readonly accessToken: string;
  private readonly apiVersion: string;
  private readonly timeoutMs: number;
  private readonly client: HttpClient;

  constructor(config: SalesforceConfig) {
    if (!config.instanceUrl || !config.accessToken) {
      throw new Error('Salesforce instanceUrl and accessToken are required');
    }

    this.instanceUrl = config.instanceUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
    this.apiVersion = config.apiVersion ?? '59.0';
    this.timeoutMs = config.timeoutMs ?? 10_000;

    this.client = createHttpClient({
      baseUrl: `${this.instanceUrl}/services/data/v${this.apiVersion}`,
      auth: {
        type: 'bearer',
        token: this.accessToken,
      },
      defaultTimeoutMs: this.timeoutMs,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
  }

  private get baseUrl(): string {
    return `${this.instanceUrl}/services/data/v${this.apiVersion}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    try {
      return await this.client.request<T>(path, {
        method,
        body,
      });
    } catch (err: unknown) {
      if (err instanceof HttpError) {
        const errorText = typeof err.responseBody === 'string'
          ? err.responseBody
          : JSON.stringify(err.responseBody ?? '');
        throw new Error(
          `Salesforce API error ${err.status}: ${err.statusText} – ${errorText}`,
        );
      }
      throw err;
    }
  }

  async query<T = SalesforceRecord>(soql: string): Promise<T[]> {
    const result = await this.request<SalesforceQueryResponse<T>>(
      'GET',
      `/query?q=${encodeURIComponent(soql)}`,
    );
    return result.records;
  }

  async findOne(
    sobject: string,
    where: string,
    fields = 'Id',
  ): Promise<SalesforceRecord | null> {
    const records = await this.query<SalesforceRecord>(
      `SELECT ${fields} FROM ${sobject} WHERE ${where} LIMIT 1`,
    );
    return records[0] ?? null;
  }

  async create(
    sobject: string,
    record: Record<string, unknown>,
  ): Promise<string> {
    const result = await this.request<SalesforceCreateResponse>(
      'POST',
      `/sobjects/${sobject}`,
      record,
    );
    if (!result.success) {
      throw new Error(`Salesforce create failed: ${JSON.stringify(result.errors)}`);
    }
    return result.id;
  }

  async update(
    sobject: string,
    id: string,
    record: Record<string, unknown>,
  ): Promise<void> {
    await this.request<unknown>('PATCH', `/sobjects/${sobject}/${id}`, record);
  }

  /**
   * Escapes a value for safe interpolation into a SOQL string literal.
   */
  static escapeSoql(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }
}
