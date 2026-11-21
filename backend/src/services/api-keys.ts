import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { getAnalyticsSummary, type UserTier } from '../middleware/rate-limit.js';

export type ApiKeyStatus = 'active' | 'revoked' | 'expired';

export interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  tier: UserTier;
  status: ApiKeyStatus;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyUsageSummary {
  keyId: string;
  keyName: string;
  tier: UserTier;
  totalRequests: number;
  blockedRequests: number;
  allowRate: number;
  byEndpoint: Record<string, { total: number; blocked: number }>;
  lastUsedAt: string | null;
}

type CreateApiKeyInput = {
  userId: string;
  name: string;
  tier?: UserTier;
  scopes?: string[];
  expiresInDays?: number;
};

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

const apiKeys = new Map<string, ApiKeyRecord>();
const rawKeyMap = new Map<string, string>();

export class ApiKeyService {
  createApiKey(input: CreateApiKeyInput): { record: ApiKeyRecord; rawKey: string } {
    const rawKey = `ak_${randomBytes(32).toString('hex')}`;
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.slice(0, 8) + '...';
    const now = new Date().toISOString();

    const record: ApiKeyRecord = {
      id: randomUUID(),
      userId: input.userId,
      name: input.name,
      keyPrefix,
      keyHash,
      tier: input.tier ?? 'free',
      status: 'active',
      scopes: input.scopes ?? ['read', 'write'],
      expiresAt: input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
        : null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    apiKeys.set(record.id, record);
    rawKeyMap.set(keyHash, record.id);
    return { record, rawKey };
  }

  listApiKeys(userId: string): ApiKeyRecord[] {
    return [...apiKeys.values()]
      .filter((k) => k.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getApiKey(id: string): ApiKeyRecord | undefined {
    return apiKeys.get(id);
  }

  revokeApiKey(id: string, userId: string): ApiKeyRecord | undefined {
    const key = apiKeys.get(id);
    if (!key || key.userId !== userId) return undefined;
    key.status = 'revoked';
    key.updatedAt = new Date().toISOString();
    apiKeys.set(id, key);
    return key;
  }

  rotateApiKey(id: string, userId: string): { record: ApiKeyRecord; rawKey: string } | undefined {
    const existing = apiKeys.get(id);
    if (!existing || existing.userId !== userId) return undefined;

    this.revokeApiKey(id, userId);

    const result = this.createApiKey({
      userId,
      name: existing.name + ' (rotated)',
      tier: existing.tier,
      scopes: existing.scopes,
    });

    return result;
  }

  validateApiKey(rawKey: string): ApiKeyRecord | undefined {
    const keyHash = hashKey(rawKey);
    const keyId = rawKeyMap.get(keyHash);
    if (!keyId) return undefined;

    const record = apiKeys.get(keyId);
    if (!record || record.status !== 'active') return undefined;
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) return undefined;

    record.lastUsedAt = new Date().toISOString();
    apiKeys.set(keyId, record);
    return record;
  }

  getUsageSummary(userId: string, windowMs = 60_000): ApiKeyUsageSummary[] {
    const keys = this.listApiKeys(userId);
    const summary = getAnalyticsSummary(windowMs);

    return keys.map((key) => {
      const keyEvents = summary.byTier[key.tier] ?? { total: 0, blocked: 0 };
      return {
        keyId: key.id,
        keyName: key.name,
        tier: key.tier,
        totalRequests: keyEvents.total,
        blockedRequests: keyEvents.blocked,
        allowRate: keyEvents.total ? (keyEvents.total - keyEvents.blocked) / keyEvents.total : 1,
        byEndpoint: summary.byEndpoint,
        lastUsedAt: key.lastUsedAt,
      };
    });
  }

  deleteApiKey(id: string, userId: string): boolean {
    const key = apiKeys.get(id);
    if (!key || key.userId !== userId) return false;
    rawKeyMap.delete(key.keyHash);
    apiKeys.delete(id);
    return true;
  }
}

export const apiKeyService = new ApiKeyService();
