import { config } from '../config/env.js';

export interface VaultConfig {
  url: string;
  token: string;
  namespace?: string;
  mountPoint: string;
  sslVerify: boolean;
  timeout: number;
}

export interface SecretData {
  key: string;
  value: string;
  version: number;
  createdTime: Date;
  expirationTime?: Date;
}

export interface LeaseData {
  leaseId: string;
  leaseDuration: number;
  renewable: boolean;
  data: Record<string, string>;
}

export interface SecretMetadata {
  key: string;
  versions: number;
  createdTime: Date;
  deletionTime?: Date;
  destroyed: boolean;
}

const DEFAULT_VAULT_CONFIG: Partial<VaultConfig> = {
  mountPoint: 'secret',
  sslVerify: true,
  timeout: 30000,
};

class VaultService {
  private config: VaultConfig | null = null;
  private isConnected: boolean = false;
  private tokenRenewalTimer: NodeJS.Timeout | null = null;
  private cachedSecrets: Map<string, { data: SecretData; cachedAt: number }> = new Map();
  private cacheTimeout = 30000;

  initialize(config: Partial<VaultConfig>): void {
    this.config = {
      ...DEFAULT_VAULT_CONFIG,
      url: config.url || process.env.VAULT_ADDR || 'http://localhost:8200',
      token: config.token || process.env.VAULT_TOKEN || '',
      namespace: config.namespace || process.env.VAULT_NAMESPACE,
      mountPoint: config.mountPoint || 'secret',
      sslVerify: config.sslVerify !== undefined ? config.sslVerify : true,
      timeout: config.timeout || 30000,
    };

    if (this.config.token) {
      this.isConnected = true;
      this.scheduleTokenRenewal();
    }
  }

  private scheduleTokenRenewal(): void {
    if (this.tokenRenewalTimer) {
      clearInterval(this.tokenRenewalTimer);
    }
    
    this.tokenRenewalTimer = setInterval(async () => {
      try {
        await this.renewToken();
      } catch (error) {
        console.error('[Vault] Token renewal failed:', error);
      }
    }, 3600000);
  }

  async connect(): Promise<boolean> {
    if (!this.config?.url || !this.config?.token) {
      console.warn('[Vault] Not configured, using environment variables as fallback');
      return false;
    }

    try {
      const response = await this.makeRequest('GET', '/v1/sys/health');
      this.isConnected = response?.initialized ?? false;
      return this.isConnected;
    } catch (error) {
      console.error('[Vault] Connection failed:', error);
      this.isConnected = false;
      return false;
    }
  }

  private async makeRequest(
    method: string,
    path: string,
    body?: any,
    retry = true
  ): Promise<any> {
    if (!this.config) {
      throw new Error('Vault not initialized');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Vault-Token': this.config.token,
    };

    if (this.config.namespace) {
      headers['X-Vault-Namespace'] = this.config.namespace;
    }

    const url = `${this.config.url}${path}`;
    
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        if (response.status === 403 && retry) {
          await this.renewToken();
          return this.makeRequest(method, path, body, false);
        }
        throw new Error(`Vault request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data?.data || data;
    } catch (error) {
      console.error(`[Vault] Request failed: ${method} ${path}`, error);
      throw error;
    }
  }

  async getSecret(key: string): Promise<SecretData | null> {
    const cached = this.cachedSecrets.get(key);
    if (cached && Date.now() - cached.cachedAt < this.cacheTimeout) {
      return cached.data;
    }

    if (!this.isConnected) {
      return this.getEnvFallback(key);
    }

    try {
      const data = await this.makeRequest(
        'GET',
        `/v1/${this.config!.mountPoint}/data/${key}`
      );

      const secretData: SecretData = {
        key,
        value: data.data?.value || JSON.stringify(data.data),
        version: data.version || 1,
        createdTime: new Date(data.created_time || Date.now()),
      };

      this.cachedSecrets.set(key, { data: secretData, cachedAt: Date.now() });
      return secretData;
    } catch (error) {
      console.error(`[Vault] Failed to get secret ${key}:`, error);
      return this.getEnvFallback(key);
    }
  }

  async setSecret(key: string, value: string, options?: { version?: number; maxVersion?: number }): Promise<SecretData> {
    if (!this.isConnected) {
      throw new Error('Vault not connected');
    }

    const data = await this.makeRequest(
      'POST',
      `/v1/${this.config!.mountPoint}/data/${key}`,
      { data: { value, ...options } }
    );

    const secretData: SecretData = {
      key,
      value,
      version: data.version || 1,
      createdTime: new Date(),
    };

    this.cachedSecrets.set(key, { data: secretData, cachedAt: Date.now() });
    return secretData;
  }

  async deleteSecret(key: string, options?: { versions?: number[] }): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Vault not connected');
    }

    if (options?.versions?.length) {
      await this.makeRequest(
        'POST',
        `/v1/${this.config!.mountPoint}/delete/${key}`,
        { versions: options.versions }
      );
    } else {
      await this.makeRequest(
        'DELETE',
        `/v1/${this.config!.mountPoint}/data/${key}`
      );
    }

    this.cachedSecrets.delete(key);
  }

  async listSecrets(path: string = ''): Promise<string[]> {
    if (!this.isConnected) {
      return [];
    }

    try {
      const data = await this.makeRequest(
        'LIST',
        `/v1/${this.config!.mountPoint}/metadata/${path}`
      );
      return data.keys || [];
    } catch (error) {
      console.error('[Vault] Failed to list secrets:', error);
      return [];
    }
  }

  async getSecretMetadata(key: string): Promise<SecretMetadata | null> {
    if (!this.isConnected) {
      return null;
    }

    try {
      const data = await this.makeRequest(
        'GET',
        `/v1/${this.config!.mountPoint}/metadata/${key}`
      );
      return {
        key,
        versions: data.versions ? Object.keys(data.versions).length : 1,
        createdTime: new Date(data.created_time || Date.now()),
        deletionTime: data.deletion_time ? new Date(data.deletion_time) : undefined,
        destroyed: data.destroyed || false,
      };
    } catch (error) {
      console.error(`[Vault] Failed to get metadata for ${key}:`, error);
      return null;
    }
  }

  async getDatabaseCredentials(role: string): Promise<LeaseData> {
    if (!this.isConnected) {
      throw new Error('Vault not connected');
    }

    const data = await this.makeRequest(
      'GET',
      `/v1/database/creds/${role}`
    );

    return {
      leaseId: data.lease_id,
      leaseDuration: data.lease_duration,
      renewable: data.renewable,
      data: {
        username: data.data.username,
        password: data.data.password,
      },
    };
  }

  async renewLease(leaseId: string): Promise<LeaseData> {
    if (!this.isConnected) {
      throw new Error('Vault not connected');
    }

    const data = await this.makeRequest(
      'POST',
      '/v1/sys/leases/renew',
      { lease_id: leaseId }
    );

    return {
      leaseId: data.lease_id,
      leaseDuration: data.lease_duration,
      renewable: data.renewable,
      data: {},
    };
  }

  async revokeLease(leaseId: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Vault not connected');
    }

    await this.makeRequest(
      'POST',
      '/v1/sys/leases/revoke',
      { lease_id: leaseId }
    );
  }

  private async renewToken(): Promise<void> {
    if (!this.config?.token) return;
    
    try {
      const response = await this.makeRequest('POST', '/v1/auth/token/renew-self');
      if (response?.auth?.client_token) {
        this.config.token = response.auth.client_token;
      }
    } catch (error) {
      console.error('[Vault] Token renewal error:', error);
    }
  }

  private getEnvFallback(key: string): SecretData | null {
    const envKey = key.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const value = process.env[envKey];
    
    if (value !== undefined) {
      return {
        key,
        value,
        version: 1,
        createdTime: new Date(),
      };
    }
    return null;
  }

  getStatus(): { connected: boolean; config: Partial<VaultConfig> | null; cachedSecrets: number } {
    return {
      connected: this.isConnected,
      config: this.config ? {
        url: this.config.url,
        namespace: this.config.namespace,
        mountPoint: this.config.mountPoint,
      } : null,
      cachedSecrets: this.cachedSecrets.size,
    };
  }

  clearCache(): void {
    this.cachedSecrets.clear();
  }

  async disconnect(): Promise<void> {
    if (this.tokenRenewalTimer) {
      clearInterval(this.tokenRenewalTimer);
      this.tokenRenewalTimer = null;
    }
    this.isConnected = false;
    this.clearCache();
  }
}

export const vaultService = new VaultService();

vaultService.initialize({});