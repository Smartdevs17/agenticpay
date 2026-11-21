/**
 * Access-token revocation list — Issue #1014
 *
 * Short-lived JWTs still need to die immediately on logout, compromise or "sign out
 * everywhere". Three kinds of entry are kept:
 *
 * - by `jti`      — one specific token (logout)
 * - by family     — every access token minted from a refresh-token family (replay detected)
 * - by subject    — every token for a user issued at or before a cut-off (sign out all)
 *
 * Entries only need to live as long as the tokens they cover, so each expires once the
 * longest possible access token would have. A local cache answers synchronously (used by
 * WebSocket upgrades); when Redis is configured, writes are mirrored there and
 * `isRevokedShared` consults it so revocation reaches every instance.
 */

import { getSharedRateLimitRedis } from '../config/rate-limit-redis.js';

/** Longest access-token lifetime plus skew; kept in sync with `MAX_ACCESS_TOKEN_TTL_SECONDS`. */
const MAX_COVERED_TOKEN_LIFETIME_MS = (60 * 60 + 60) * 1000;

const KEY_PREFIX = 'at:revoked:';

export interface RevocableClaims {
  jti: string;
  sub: string;
  iat: number;
  exp: number;
  fid?: string;
}

interface SharedStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>;
}

export interface AccessTokenRevocationListOptions {
  /** Resolves the shared store; defaults to the shared rate-limit Redis connection. */
  sharedStore?: () => Promise<SharedStore | null | undefined>;
  now?: () => Date;
}

export class AccessTokenRevocationList {
  private readonly tokens = new Map<string, number>(); // jti -> expires epoch ms
  private readonly families = new Map<string, number>(); // fid -> expires epoch ms
  private readonly subjects = new Map<string, { cutoffSeconds: number; expiresAt: number }>();
  private readonly sharedStore: () => Promise<SharedStore | null | undefined>;
  private readonly now: () => Date;

  constructor(options: AccessTokenRevocationListOptions = {}) {
    this.sharedStore =
      options.sharedStore ??
      (async () => (await getSharedRateLimitRedis()) as unknown as SharedStore | null | undefined);
    this.now = options.now ?? (() => new Date());
  }

  async revokeToken(jti: string, expiresAt: Date): Promise<void> {
    const until = Math.min(expiresAt.getTime(), this.nowMs() + MAX_COVERED_TOKEN_LIFETIME_MS);
    if (until <= this.nowMs()) return;
    this.tokens.set(jti, until);
    await this.mirror(`jti:${jti}`, '1', until - this.nowMs());
  }

  async revokeFamily(familyId: string): Promise<void> {
    const until = this.nowMs() + MAX_COVERED_TOKEN_LIFETIME_MS;
    this.families.set(familyId, until);
    await this.mirror(`fid:${familyId}`, '1', MAX_COVERED_TOKEN_LIFETIME_MS);
  }

  /** Rejects every token for `subject` issued at or before now. */
  async revokeSubject(subject: string): Promise<void> {
    const cutoffSeconds = Math.floor(this.nowMs() / 1000);
    const expiresAt = this.nowMs() + MAX_COVERED_TOKEN_LIFETIME_MS;
    this.subjects.set(subject, { cutoffSeconds, expiresAt });
    await this.mirror(`sub:${subject}`, String(cutoffSeconds), MAX_COVERED_TOKEN_LIFETIME_MS);
  }

  /** Local check only. */
  isRevoked(claims: RevocableClaims): boolean {
    this.prune();
    if (this.tokens.has(claims.jti)) return true;
    if (claims.fid && this.families.has(claims.fid)) return true;
    const subject = this.subjects.get(claims.sub);
    return subject !== undefined && claims.iat <= subject.cutoffSeconds;
  }

  /** Local check, then the shared store. A shared-store outage falls back to local only. */
  async isRevokedShared(claims: RevocableClaims): Promise<boolean> {
    if (this.isRevoked(claims)) return true;
    let store: SharedStore | null | undefined;
    try {
      store = await this.sharedStore();
    } catch {
      return false;
    }
    if (!store) return false;
    try {
      const [byToken, byFamily, bySubject] = await Promise.all([
        store.get(`${KEY_PREFIX}jti:${claims.jti}`),
        claims.fid ? store.get(`${KEY_PREFIX}fid:${claims.fid}`) : Promise.resolve(null),
        store.get(`${KEY_PREFIX}sub:${claims.sub}`),
      ]);
      if (byToken !== null || byFamily !== null) return true;
      return bySubject !== null && claims.iat <= Number(bySubject);
    } catch {
      return false;
    }
  }

  /** Clears every entry. Intended for tests. */
  clear(): void {
    this.tokens.clear();
    this.families.clear();
    this.subjects.clear();
  }

  private async mirror(key: string, value: string, ttlMs: number): Promise<void> {
    try {
      const store = await this.sharedStore();
      await store?.set(`${KEY_PREFIX}${key}`, value, 'PX', Math.max(1, Math.ceil(ttlMs)));
    } catch {
      // Local revocation already applies; the shared mirror is best-effort.
    }
  }

  private prune(): void {
    const now = this.nowMs();
    for (const [key, until] of this.tokens) if (until <= now) this.tokens.delete(key);
    for (const [key, until] of this.families) if (until <= now) this.families.delete(key);
    for (const [key, entry] of this.subjects) if (entry.expiresAt <= now) this.subjects.delete(key);
  }

  private nowMs(): number {
    return this.now().getTime();
  }
}

export const accessTokenRevocationList = new AccessTokenRevocationList();
