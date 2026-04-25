import { config } from '../config.js';
import { z } from 'zod';

const VAULT_STORAGE_KEY = 'vault_secrets';

const vaultConfigSchema = z.object({
  VAULT_ADDR: z.string().url().optional(),
  VAULT_TOKEN: z.string().optional(),
  VAULT_ROLE: z.string().optional(),
  VAULT_SECRET_PATH: z.string().default('secret/data/agenticpay'),
  VAULT_AUTH_METHOD: z.enum(['token', 'kubernetes', 'aws', 'gcp']).default('token'),
  VAULT_KUBERNETES_ROLE: z.string().optional(),
  VAULT_MAX_RETRIES: z.number().default(3),
  VAULT_RETRY_DELAY_MS: z.number().default(1000),
  VAULT_LEASE_TTL_SECONDS: z.number().default(3600),
  VAULT_RENEWAL_THRESHOLD_SECONDS: z.number().default(600),
});

interface VaultCredentials {
  address: string;
  token: string;
  role?: string;
  authMethod: 'token' | 'kubernetes' | 'aws' | 'gcp';
  kubernetesRole?: string;
}

interface SecretLease<T = unknown> {
  secret: T;
  leaseId: string;
  expiresAt: number;
  renewable: boolean;
}

interface VaultState {
  credentials: VaultCredentials | null;
  leases: Record<string, SecretLease>;
  auditLog: Array<{ action: string; timestamp: number; details: string }>;
}

let vaultState: VaultState = {
  credentials: null,
  leases: {},
  auditLog: [],
};

function auditLogAction(action: string, details: string): void {
  vaultState.auditLog.push({
    action,
    timestamp: Date.now(),
    details,
  });
  if (vaultState.auditLog.length > 1000) {
    vaultState.auditLog.shift();
  }
}

async function authenticateWithVault(): Promise<VaultCredentials | null> {
  const env = vaultConfigSchema.safeParse(process.env);

  if (!env.success || !env.data.VAULT_ADDR || !env.data.VAULT_TOKEN) {
    return null;
  }

  const credentials: VaultCredentials = {
    address: env.data.VAULT_ADDR,
    token: env.data.VAULT_TOKEN,
    role: env.data.VAULT_ROLE,
    authMethod: env.data.VAULT_AUTH_METHOD,
    kubernetesRole: env.data.VAULT_KUBERNETES_ROLE,
  };

  vaultState.credentials = credentials;
  auditLogAction('authenticate', `Vault authenticated at ${credentials.address}`);

  return credentials;
}

async function fetchSecret<T = Record<string, unknown>>(
  secretPath: string
): Promise<SecretLease<T> | null> {
  const credentials = vaultState.credentials || (await authenticateWithVault());
  if (!credentials) {
    return null;
  }

  const path = `${credentials.address}/v1/${secretPath}`;

  try {
    const response = await fetch(path, {
      headers: {
        Authorization: `Bearer ${credentials.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Vault fetch failed: ${response.status}`);
    }

    const data = await response.json() as {
      data?: { data?: T };
      lease_id?: string;
      lease_duration?: number;
      renewable?: boolean;
    };

    const secret = data.data?.data || (data.data as T);
    const leaseId = data.lease_id || `${secretPath}:${Date.now()}`;
    const ttl = data.lease_duration || 3600;

    const lease: SecretLease<T> = {
      secret,
      leaseId,
      expiresAt: Date.now() + ttl * 1000,
      renewable: data.renewable ?? true,
    };

    vaultState.leases[secretPath] = lease;
    auditLogAction('fetch_secret', `Fetched secret from ${secretPath}`);

    return lease;
  } catch (error) {
    auditLogAction('fetch_secret_error', `Failed to fetch secret: ${error}`);
    return null;
  }
}

async function renewLease(secretPath: string): Promise<boolean> {
  const credentials = vaultState.credentials;
  if (!credentials) {
    return false;
  }

  const lease = vaultState.leases[secretPath];
  if (!lease || !lease.renewable) {
    return false;
  }

  const path = `${credentials.address}/v1/sys/leases/renew`;

  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ lease_id: lease.leaseId }),
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json() as { data?: { lease_duration?: number } };
    const newTtl = data.data?.lease_duration || 3600;

    lease.expiresAt = Date.now() + newTtl * 1000;
    auditLogAction('renew_lease', `Renewed lease for ${secretPath}`);

    return true;
  } catch (error) {
    auditLogAction('renew_lease_error', `Failed to renew lease: ${error}`);
    return false;
  }
}

async function revokeLease(secretPath: string): Promise<boolean> {
  const credentials = vaultState.credentials;
  if (!credentials) {
    return false;
  }

  const lease = vaultState.leases[secretPath];
  if (!lease) {
    return true;
  }

  const path = `${credentials.address}/v1/sys/leases/revoke`;

  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ lease_id: lease.leaseId }),
    });

    delete vaultState.leases[secretPath];
    auditLogAction('revoke_lease', `Revoked lease for ${secretPath}`);

    return response.ok;
  } catch (error) {
    auditLogAction('revoke_lease_error', `Failed to revoke lease: ${error}`);
    return false;
  }
}

async function rotateSecret<T = Record<string, unknown>>(
  secretPath: string
): Promise<SecretLease<T> | null> {
  await revokeLease(secretPath);
  return fetchSecret<T>(secretPath);
}

export interface VaultSecrets {
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    name: string;
  } | null;
  apiKeys: Record<string, string>;
  cryptoKeys: {
    publicKey: string;
    privateKey: string;
  } | null;
}

async function getDatabaseCredentials(): Promise<VaultSecrets['database'] | null> {
  const configEnv = vaultConfigSchema.parse(process.env);
  const secretPath = `${configEnv.VAULT_SECRET_PATH}/database`;

  const lease = await fetchSecret<{
    host: string;
    port: number;
    username: string;
    password: string;
    name: string;
  }>(secretPath);

  return lease?.secret || null;
}

async function getApiKey(apiKeyName: string): Promise<string | null> {
  const configEnv = vaultConfigSchema.parse(process.env);
  const secretPath = `${configEnv.VAULT_SECRET_PATH}/api-keys/${apiKeyName}`;

  const lease = await fetchSecret<{ key: string }>(secretPath);
  return lease?.secret.key || null;
}

async function getAllApiKeys(): Promise<Record<string, string>> {
  const configEnv = vaultConfigSchema.parse(process.env);
  const secretPath = `${configEnv.VAULT_SECRET_PATH}/api-keys`;

  const lease = await fetchSecret<Record<string, string>>(secretPath);
  return lease?.secret || {};
}

async function getCryptoKeys(): Promise<VaultSecrets['cryptoKeys'] | null> {
  const configEnv = vaultConfigSchema.parse(process.env);
  const secretPath = `${configEnv.VAULT_SECRET_PATH}/crypto`;

  const lease = await fetchSecret<{ publicKey: string; privateKey: string }>(secretPath);
  return lease?.secret || null;
}

async function injectSecret(
  secretName: string,
  value: string
): Promise<{ success: boolean; error?: string }> {
  const credentials = vaultState.credentials || (await authenticateWithVault());
  if (!credentials) {
    return { success: false, error: 'Vault not configured' };
  }

  const configEnv = vaultConfigSchema.parse(process.env);
  const secretPath = `${credentials.address}/v1/${configEnv.VAULT_SECRET_PATH}/${secretName}`;

  try {
    const response = await fetch(secretPath, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: { value } }),
    });

    if (!response.ok) {
      throw new Error(`Failed to inject secret: ${response.status}`);
    }

    auditLogAction('inject_secret', `Injected secret ${secretName}`);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    auditLogAction('inject_secret_error', `Failed to inject secret: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}

function getAuditLog(limit = 100): Array<{ action: string; timestamp: number; details: string }> {
  return vaultState.auditLog.slice(-limit);
}

function getVaultStatus() {
  return {
    configured: !!vaultState.credentials,
    activeLeases: Object.keys(vaultState.leases).length,
    auditLogCount: vaultState.auditLog.length,
  };
}

export const vault = {
  authenticate: authenticateWithVault,
  fetchSecret,
  renewLease,
  revokeLease,
  rotateSecret,
  getDatabaseCredentials,
  getApiKey,
  getAllApiKeys,
  getCryptoKeys,
  injectSecret,
  getAuditLog,
  getStatus: getVaultStatus,
};