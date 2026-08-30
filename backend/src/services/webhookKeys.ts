import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_KEY_SCHEME = 'v1';
export const DEFAULT_TOLERANCE_SECONDS = 300;
export const DEFAULT_OVERLAP_SECONDS = 72 * 60 * 60;
export const DEFAULT_RETENTION_SECONDS = 7 * 24 * 60 * 60;
export const MIN_WEBHOOK_KEY_SECRET_LENGTH = 32;

export type WebhookKeyStatus = 'active' | 'retiring' | 'revoked';

export interface WebhookKeyRecord {
  keyId: string;
  provider: string;
  secret: string;
  algorithm: 'sha256';
  status: WebhookKeyStatus;
  createdAt: number;
  retiredAt?: number;
  revokedAt?: number;
  expiresAt?: number;
  lastUsedAt?: number;
  label?: string;
}

export interface WebhookKeyGenerationInput {
  provider?: string;
  secret?: string;
  keyId?: string;
  label?: string;
  expiresAt?: number;
}

export interface SignWebhookPayloadInput {
  provider?: string;
  keyId?: string;
  body: string | Buffer;
  timestamp?: number;
}

export interface SignWebhookResult {
  signature: string;
  version: string;
  timestamp: string;
  keyId: string;
}

export interface VerifyWebhookSignatureInput {
  signature: string;
  timestamp: string | number;
  body: string | Buffer;
  provider?: string;
  keyId?: string;
  toleranceSeconds?: number;
}

export type WebhookRejectionReason =
  | 'missing_signature'
  | 'missing_timestamp'
  | 'invalid_signature_format'
  | 'timestamp_out_of_tolerance'
  | 'no_keys'
  | 'unknown_key'
  | 'key_revoked'
  | 'key_expired'
  | 'signature_mismatch';

export interface VerifyWebhookSignatureResult {
  isValid: boolean;
  provider?: string;
  keyId?: string;
  timestamp: number;
  ageMs: number;
  error?: string;
  reason?: WebhookRejectionReason;
}

export interface WebhookKeyRegistryConfig {
  now?: () => number;
  overlapSeconds?: number;
  retentionSeconds?: number;
  toleranceSeconds?: number;
  keys?: WebhookKeyGenerationInput[];
}

export interface WebhookKeyMetrics {
  registered: number;
  rotated: number;
  revoked: number;
  purged: number;
  signs: number;
  signErrors: number;
  verifications: number;
  verified: number;
  rejected: number;
  rejectionsByReason: Partial<Record<WebhookRejectionReason, number>>;
}

export class WebhookKeyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WebhookKeyError';
  }
}

const DIGEST_PREFIXES = ['v1=', 'sha256=', 'sig-sha256=', 'sha256-'];
const ALL_HEX_DIGEST = /^[a-f0-9]{64}$/i;

function formatId(provider: string | undefined, prefix: string): string {
  const providerPart = provider ? `${provider}_` : '';
  const rand = randomBytes(5).toString('hex');
  return `${prefix}${providerPart}${Date.now().toString(36)}_${rand}`;
}

export function generateWebhookKeySecret(): string {
  return randomBytes(32).toString('base64url');
}

export function buildWebhookDigest(body: string | Buffer, secret: string, timestampSeconds: number): string {
  const raw = Buffer.isBuffer(body) ? body.toString('utf8') : body;
  return createHmac('sha256', secret)
    .update(`${timestampSeconds}.${raw}`)
    .digest('hex');
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function parseWebhookSignature(signature: string): { keyId?: string; digest: string } | null {
  let value = signature.trim();
  for (const prefix of DIGEST_PREFIXES) {
    if (value.startsWith(prefix)) {
      value = value.slice(prefix.length);
      break;
    }
  }
  if (ALL_HEX_DIGEST.test(value)) {
    return { digest: value.toLowerCase() };
  }
  const dot = value.lastIndexOf('.');
  if (dot > 0 && dot < value.length - 1) {
    const keyId = value.slice(0, dot);
    const digest = value.slice(dot + 1);
    if (ALL_HEX_DIGEST.test(digest)) {
      return { keyId, digest: digest.toLowerCase() };
    }
  }
  return null;
}

export function normalizeWebhookTimestamp(timestamp: string | number): number | null {
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    return timestamp <= 1e11 ? timestamp * 1000 : timestamp;
  }
  if (typeof timestamp === 'string') {
    const trimmed = timestamp.trim();
    if (trimmed === '') return null;
    if (/^-?\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return numeric <= 1e11 ? numeric * 1000 : numeric;
      }
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export class WebhookKeyRegistry {
  readonly overlapSeconds: number;
  readonly retentionSeconds: number;
  readonly toleranceSeconds: number;

  private readonly now: () => number;
  private readonly keys = new Map<string, WebhookKeyRecord>();
  private mRegistered = 0;
  private mRotated = 0;
  private mRevoked = 0;
  private mPurged = 0;
  private mSigns = 0;
  private mSignErrors = 0;
  private mVerifications = 0;
  private mVerified = 0;
  private mRejected = 0;
  private readonly mRejections: Partial<Record<WebhookRejectionReason, number>> = {};

  constructor(config: WebhookKeyRegistryConfig = {}) {
    this.now = config.now ?? (() => Date.now());
    this.overlapSeconds = config.overlapSeconds ?? DEFAULT_OVERLAP_SECONDS;
    this.retentionSeconds = config.retentionSeconds ?? DEFAULT_RETENTION_SECONDS;
    this.toleranceSeconds = config.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
    for (const key of config.keys ?? []) {
      this.register(key);
    }
  }

  get nowMs(): number {
    return this.now();
  }

  get size(): number {
    return this.keys.size;
  }

  register(input: WebhookKeyGenerationInput = {}): WebhookKeyRecord {
    const provider = input.provider ?? '';
    const secret = input.secret ?? generateWebhookKeySecret();
    if (secret.length < MIN_WEBHOOK_KEY_SECRET_LENGTH) {
      throw new WebhookKeyError('WEBHOOK_KEY_SECRET_TOO_SHORT', `Secret must be at least ${MIN_WEBHOOK_KEY_SECRET_LENGTH} characters`);
    }
    const keyId = input.keyId ?? formatId(provider || undefined, 'wvk_');
    if (this.keys.has(keyId)) {
      throw new WebhookKeyError('WEBHOOK_KEY_ID_COLLISION', `Key ${keyId} already exists`);
    }
    const record: WebhookKeyRecord = {
      keyId,
      provider,
      secret,
      algorithm: 'sha256',
      status: 'active',
      createdAt: this.nowMs,
      expiresAt: input.expiresAt,
      label: input.label,
    };
    this.keys.set(keyId, record);
    this.mRegistered += 1;
    return record;
  }

  rotate(input: { provider?: string; secret?: string; keyId?: string; label?: string; overlapSeconds?: number } = {}): {
    retired?: WebhookKeyRecord;
    active: WebhookKeyRecord;
  } {
    const provider = input.provider ?? '';
    const overlapMs = (input.overlapSeconds ?? this.overlapSeconds) * 1000;
    const current = this.activeKeysFor(provider)[0];
    if (current) {
      current.status = 'retiring';
      current.retiredAt = this.nowMs;
      current.expiresAt = this.nowMs + overlapMs;
      this.keys.set(current.keyId, current);
    }
    const active = this.register({
      provider,
      secret: input.secret,
      keyId: input.keyId,
      label: input.label,
    });
    this.mRotated += 1;
    return { retired: current, active };
  }

  revoke(keyId: string): boolean {
    const record = this.keys.get(keyId);
    if (!record) return false;
    if (record.status === 'active' && this.activeKeysFor(record.provider).length === 1) {
      throw new WebhookKeyError(
        'WEBHOOK_KEY_LAST_ACTIVE',
        `Cannot revoke the only active key for provider "${record.provider}"; rotate first`,
      );
    }
    record.status = 'revoked';
    record.revokedAt = this.nowMs;
    this.keys.set(keyId, record);
    this.mRevoked += 1;
    return true;
  }

  sign(input: SignWebhookPayloadInput): SignWebhookResult {
    let record: WebhookKeyRecord | undefined;
    if (input.keyId) {
      record = this.keys.get(input.keyId);
      if (!record) {
        this.mSignErrors += 1;
        throw new WebhookKeyError('WEBHOOK_KEY_NOT_FOUND', `Signing key ${input.keyId} does not exist`);
      }
    } else {
      record = this.activeKeysFor(input.provider)[0];
      if (!record) {
        this.mSignErrors += 1;
        throw new WebhookKeyError('WEBHOOK_KEY_NO_ACTIVE', `No active key for provider "${input.provider ?? ''}"`);
      }
    }
    if (record.status !== 'active') {
      this.mSignErrors += 1;
      throw new WebhookKeyError('WEBHOOK_KEY_NOT_ACTIVE', `Key ${record.keyId} is not active (${record.status})`);
    }
    const timestampSeconds = input.timestamp ?? Math.floor(this.nowMs / 1000);
    const digest = buildWebhookDigest(input.body, record.secret, timestampSeconds);
    const signature = input.keyId ? `v1=${record.keyId}.${digest}` : `v1=${digest}`;
    this.mSigns += 1;
    record.lastUsedAt = this.nowMs;
    this.keys.set(record.keyId, record);
    return {
      signature,
      version: WEBHOOK_KEY_SCHEME,
      timestamp: String(timestampSeconds),
      keyId: record.keyId,
    };
  }

  verify(input: VerifyWebhookSignatureInput): VerifyWebhookSignatureResult {
    this.mVerifications += 1;
    const reject = (reason: WebhookRejectionReason, error: string | undefined, timestamp = 0, ageMs = 0): VerifyWebhookSignatureResult => {
      this.mRejected += 1;
      this.mRejections[reason] = (this.mRejections[reason] ?? 0) + 1;
      return {
        isValid: false,
        provider: input.provider,
        timestamp,
        ageMs,
        error: error ?? '',
        reason,
      };
    };

    if (!input.signature) {
      return reject('missing_signature', 'Missing webhook signature');
    }
    const parsedSignature = parseWebhookSignature(input.signature);
    if (!parsedSignature) {
      return reject('invalid_signature_format', 'Signature is not in a recognized format');
    }
    const timestampMs = normalizeWebhookTimestamp(input.timestamp);
    if (timestampMs === null) {
      return reject('missing_timestamp', 'Missing or unparseable webhook timestamp');
    }

    const now = this.nowMs;
    const ageMs = Math.abs(now - timestampMs);
    const toleranceMs = (input.toleranceSeconds ?? this.toleranceSeconds) * 1000;
    if (ageMs > toleranceMs) {
      return reject(
        'timestamp_out_of_tolerance',
        `Timestamp outside tolerance window (${ageMs}ms > ${toleranceMs}ms)`,
        timestampMs,
        ageMs,
      );
    }

    const candidates = this.resolveCandidates(
      input.keyId ?? parsedSignature.keyId,
      input.provider,
      this.nowMs,
    );
    if (candidates.reason) {
      return reject(candidates.reason, candidates.error, timestampMs, ageMs);
    }
    if (candidates.keys.length === 0) {
      return reject('no_keys', `No usable key for provider "${input.provider ?? ''}"`, timestampMs, ageMs);
    }

    const timestampSeconds = Math.floor(timestampMs / 1000);
    for (const record of candidates.keys) {
      if (constantTimeEqualHex(parsedSignature.digest, buildWebhookDigest(input.body, record.secret, timestampSeconds))) {
        record.lastUsedAt = now;
        this.keys.set(record.keyId, record);
        this.mVerified += 1;
        return {
          isValid: true,
          provider: input.provider ?? record.provider,
          keyId: record.keyId,
          timestamp: timestampMs,
          ageMs,
        };
      }
    }

    return reject('signature_mismatch', 'Signature verification failed', timestampMs, ageMs);
  }

  private resolveCandidates(
    keyId: string | undefined,
    provider: string | undefined,
    now: number,
  ): { keys: WebhookKeyRecord[]; reason?: WebhookRejectionReason; error?: string } {
    if (keyId) {
      const record = this.keys.get(keyId);
      if (!record) {
        return { keys: [], reason: 'unknown_key', error: `Key ${keyId} does not exist` };
      }
      if (provider && record.provider !== provider) {
        return { keys: [], reason: 'unknown_key', error: `Key ${keyId} does not belong to provider "${provider}"` };
      }
      if (record.status === 'revoked') {
        return { keys: [], reason: 'key_revoked', error: `Key ${keyId} has been revoked` };
      }
      if (record.expiresAt !== undefined && record.expiresAt <= now) {
        return { keys: [], reason: 'key_expired', error: `Key ${keyId} has expired` };
      }
      return { keys: [record] };
    }

    const keys = Array.from(this.keys.values())
      .filter((record) => {
        if (provider && record.provider !== provider) return false;
        if (record.status === 'revoked') return false;
        if (record.expiresAt !== undefined && record.expiresAt <= now) return false;
        return record.status === 'active' || record.status === 'retiring';
      })
      .sort((a, b) => {
        if (a.status === 'active' && b.status !== 'active') return -1;
        if (b.status === 'active' && a.status !== 'active') return 1;
        return b.createdAt - a.createdAt;
      });
    return { keys };
  }

  getKey(keyId: string): WebhookKeyRecord | undefined {
    return this.keys.get(keyId);
  }

  getActiveKey(provider?: string): WebhookKeyRecord | undefined {
    return this.activeKeysFor(provider)[0];
  }

  activeKeysFor(provider?: string): WebhookKeyRecord[] {
    return Array.from(this.keys.values())
      .filter((record) => record.status === 'active')
      .filter((record) => !provider || record.provider === provider)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  hasKeysForProvider(provider?: string): boolean {
    return Array.from(this.keys.values()).some((record) => {
      if (provider && record.provider !== provider) return false;
      return record.status === 'active' || record.status === 'retiring';
    });
  }

  listKeys(input: { provider?: string; status?: WebhookKeyStatus; includeRevoked?: boolean } = {}): WebhookKeyRecord[] {
    return Array.from(this.keys.values())
      .filter((record) => !input.provider || record.provider === input.provider)
      .filter((record) => !input.status || record.status === input.status)
      .filter((record) => input.includeRevoked || record.status !== 'revoked')
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  purgeExpired(): number {
    const now = this.nowMs;
    this.purgeEntirelyExpired(now);
    let purged = 0;
    for (const [keyId, record] of this.keys) {
      if (record.status === 'active') continue;
      const reference = record.retiredAt ?? record.revokedAt ?? record.expiresAt;
      if (reference !== undefined && now - reference >= this.retentionSeconds * 1000) {
        this.keys.delete(keyId);
        purged += 1;
      }
    }
    this.mPurged += purged;
    return purged;
  }

  private purgeEntirelyExpired(now: number): void {
    for (const [keyId, record] of this.keys) {
      if (record.expiresAt !== undefined && record.expiresAt <= now && now - record.expiresAt >= this.retentionSeconds * 1000) {
        this.keys.delete(keyId);
        this.mPurged += 1;
      }
    }
  }

  metrics(): WebhookKeyMetrics {
    return {
      registered: this.mRegistered,
      rotated: this.mRotated,
      revoked: this.mRevoked,
      purged: this.mPurged,
      signs: this.mSigns,
      signErrors: this.mSignErrors,
      verifications: this.mVerifications,
      verified: this.mVerified,
      rejected: this.mRejected,
      rejectionsByReason: { ...this.mRejections },
    };
  }

  resetMetrics(): void {
    this.mRegistered = 0;
    this.mRotated = 0;
    this.mRevoked = 0;
    this.mPurged = 0;
    this.mSigns = 0;
    this.mSignErrors = 0;
    this.mVerifications = 0;
    this.mVerified = 0;
    this.mRejected = 0;
    for (const reason of Object.keys(this.mRejections) as WebhookRejectionReason[]) {
      delete this.mRejections[reason];
    }
  }

  clear(): void {
    this.keys.clear();
  }
}

let sharedRegistry: WebhookKeyRegistry | undefined;

export function getWebhookKeyRegistry(): WebhookKeyRegistry {
  if (!sharedRegistry) {
    sharedRegistry = new WebhookKeyRegistry();
  }
  return sharedRegistry;
}

export function initWebhookKeyRegistry(config: WebhookKeyRegistryConfig = {}): WebhookKeyRegistry {
  sharedRegistry = new WebhookKeyRegistry(config);
  return sharedRegistry;
}

export function resetWebhookKeyRegistry(): void {
  sharedRegistry = undefined;
}