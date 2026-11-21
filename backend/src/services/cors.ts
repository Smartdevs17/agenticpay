/**
 * services/cors.ts — Dynamic CORS origin whitelist.
 *
 * Runtime-mutable allowlist of browser origins that may call the API
 * cross-origin. Supports:
 *
 *   - Exact origins:      `https://app.example.com`
 *   - Subdomain wildcard: `https://*.example.com`  (matches the apex too)
 *   - Scheme-relative:    `example.com` / `*.example.com` (any scheme)
 *   - Open mode:          `*`
 *
 * The allowlist can be mutated at runtime (add/remove/set) and refreshed
 * from an async loader, so policies change without a redeploy. Every origin
 * decision is tracked in metrics for observability.
 *
 * Semantic notes:
 *   - Matching ignores the port: `https://app.example.com:8443` matches the
 *     pattern `https://app.example.com`. Ports are rarely meaningful for
 *     CORS policy and ignoring them avoids spurious denials.
 *   - Scheme and hostname are compared case-insensitively.
 *   - `Origin: null` (and empty origins) are never allowed; browsers use
 *     `null` for sandboxed or file:// contexts.
 *   - An empty allowlist denies everything. Use `*` to allow any origin.
 */

export interface CorsPolicyOptions {
  /** Initial allowlist entries (origins or patterns). */
  allowedOrigins?: string[];
  /** Reflect `Access-Control-Allow-Credentials`. */
  allowCredentials?: boolean;
  /** Async source of truth used by `refresh()`. */
  loader?: () => Promise<string[]>;
}

export interface CorsMetrics {
  /** Requests whose Origin was allowed. */
  allowedRequests: number;
  /** Requests whose Origin was present but denied. */
  deniedRequests: number;
  /** Preflight (OPTIONS + Access-Control-Request-Method) requests handled. */
  preflights: number;
  /** Preflight requests denied at the origin check. */
  preflightDenied: number;
}

/** Thrown when an origin/pattern fails syntax validation or the loader errors. */
export class CorsPolicyError extends Error {
  readonly code = 'INVALID_CORS_ORIGIN';

  constructor(pattern: string) {
    super(`Invalid CORS origin or pattern: "${pattern}"`);
    this.name = 'CorsPolicyError';
  }
}

const MAX_PATTERN_LENGTH = 200;
const ORIGIN_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
// eslint-disable-next-line no-control-regex -- CORS origins must reject control characters outright
const FORBIDDEN_CHARS_RE = /[\s\u0000-\u001f\u007f]/;

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * `true` when `origin` is a well-formed `scheme://host[:port]` with no path,
 * query, fragment, whitespace, or control characters.
 */
export function isValidOrigin(origin: string): boolean {
  if (typeof origin !== 'string' || origin.length === 0 || origin.length > MAX_PATTERN_LENGTH) {
    return false;
  }
  if (!ORIGIN_SCHEME_RE.test(origin) || FORBIDDEN_CHARS_RE.test(origin)) {
    return false;
  }
  const rest = origin.split('://', 2)[1];
  if (!rest || rest.includes('/') || rest.includes('?') || rest.includes('#')) {
    return false;
  }
  return hostOf(origin).length > 0;
}

/**
 * `true` when `pattern` is a usable allowlist entry: a valid origin or a
 * scheme-relative host (optionally with a `*.` subdomain prefix). The bare
 * `*` wildcard is reserved for allowlist semantics, not validation.
 */
export function isValidPattern(pattern: unknown): pattern is string {
  if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > MAX_PATTERN_LENGTH) {
    return false;
  }
  const trimmed = pattern.trim().toLowerCase();
  if (FORBIDDEN_CHARS_RE.test(trimmed)) return false;
  if (trimmed === '*') return true;
  if (trimmed.includes('://')) {
    return isValidOrigin(pattern) && validPatternHost(hostOf(trimmed));
  }
  // Scheme-relative host, optionally wildcarded.
  if (trimmed.includes('/') || trimmed.includes('?') || trimmed.includes('#')) return false;
  return validPatternHost(trimmed.startsWith('*.') ? trimmed.slice(2) : trimmed);
}

/** Host portion of a pattern: letters/numbers/dots/hyphens, no port; a `*`
 * is only allowed as the leading `*.` subdomain prefix. */
function validPatternHost(host: string): boolean {
  if (host.length === 0) return false;
  if (/[^a-z0-9.*-]/.test(host) || host.includes(':') || host.startsWith('.')) return false;
  const starIndex = host.indexOf('*');
  if (starIndex !== -1) {
    if (!(host.startsWith('*.') && starIndex === 0)) return false;
    if (host.slice(2).includes('*')) return false;
  }
  return true;
}

// ─── Matching ─────────────────────────────────────────────────────────────────

function hostOf(origin: string): string {
  const after = origin.split('://', 2)[1] ?? '';
  return after.split(':')[0];
}

function schemeOf(origin: string): string {
  const match = /^([a-z][a-z0-9+.-]*):\/\//i.exec(origin);
  return match ? match[1].toLowerCase() : '';
}

function hostMatches(subject: string, wildcardTarget: string): boolean {
  const target = wildcardTarget.toLowerCase().replace(/^\./, '');
  if (target.startsWith('*.')) {
    const suffix = target.slice(2);
    return subject === suffix || subject.endsWith(`.${suffix}`);
  }
  return subject === target;
}

/**
 * `true` when `origin` satisfies the allowlist `pattern`.
 *
 * @see top-of-file block for supported pattern forms.
 */
export function originMatches(pattern: string, origin: string): boolean {
  if (pattern === '*') return true;
  if (!isValidOrigin(origin)) return false;

  const p = pattern.trim().toLowerCase();
  const o = origin.toLowerCase();

  if (p.startsWith('*.')) {
    return hostMatches(hostOf(o), p);
  }
  if (!p.includes('://')) {
    return hostOf(o) === p;
  }
  if (schemeOf(p) !== schemeOf(o)) return false;
  return hostMatches(hostOf(o), hostOf(p));
}

// ─── Policy ───────────────────────────────────────────────────────────────────

const metrics: CorsMetrics = {
  allowedRequests: 0,
  deniedRequests: 0,
  preflights: 0,
  preflightDenied: 0,
};

export class CORSOriginPolicy {
  private origins = new Set<string>();
  private allowCredentials: boolean;
  private loader?: () => Promise<string[]>;
  private revision = 0;

  constructor(options: CorsPolicyOptions = {}) {
    this.allowCredentials = options.allowCredentials ?? false;
    this.loader = options.loader;
    if (options.allowedOrigins) {
      this.set(options.allowedOrigins);
    }
  }

  /** Replace the whole allowlist. Throws `CorsPolicyError` on a bad entry. */
  set(allowedOrigins: string[]): void {
    const next = new Set<string>();
    for (const entry of allowedOrigins) {
      const trimmed = typeof entry === 'string' ? entry.trim() : '';
      if (trimmed === '' || !isValidPattern(trimmed)) {
        throw new CorsPolicyError(entry);
      }
      next.add(trimmed.toLowerCase());
    }
    this.origins = next;
    this.revision++;
  }

  /** Add a single origin/pattern. Returns the new allowlist size. */
  add(pattern: string): number {
    const trimmed = pattern.trim();
    if (trimmed === '' || !isValidPattern(trimmed)) {
      throw new CorsPolicyError(pattern);
    }
    this.origins.add(trimmed.toLowerCase());
    this.revision++;
    return this.origins.size;
  }

  /** Remove a single origin/pattern. Returns `true` if it was present. */
  remove(pattern: string): boolean {
    const removed = this.origins.delete(pattern.trim().toLowerCase());
    if (removed) this.revision++;
    return removed;
  }

  /** Current allowlist entries, sorted for deterministic output. */
  list(): string[] {
    return Array.from(this.origins).sort();
  }

  /** `true` when the allowlist contains the `*` entry (concede any origin). */
  get wildcard(): boolean {
    return this.origins.has('*');
  }

  /** When credentials are reflected alongside allowed origins. */
  get credentials(): boolean {
    return this.allowCredentials;
  }

  /** Toggle credential reflection at runtime. */
  setCredentials(allow: boolean): void {
    this.allowCredentials = allow;
    this.revision++;
  }

  /** Monotonic revision counter; increments on every mutation. */
  get version(): number {
    return this.revision;
  }

  get size(): number {
    return this.origins.size;
  }

  /**
   * `true` when `origin` is admitted by this policy. Counts allow/deny in
   * the shared metrics. `null`/empty/sandbox origins are never allowed.
   */
  isAllowed(origin: string | null | undefined): boolean {
    if (origin == null || origin === '' || origin === 'null' || !isValidOrigin(origin)) {
      metrics.deniedRequests++;
      return false;
    }
    if (this.wildcard) {
      metrics.allowedRequests++;
      return true;
    }
    for (const pattern of this.origins) {
      if (originMatches(pattern, origin)) {
        metrics.allowedRequests++;
        return true;
      }
    }
    metrics.deniedRequests++;
    return false;
  }

  /**
   * Re-pull the allowlist from the loader. Fails safe: the previous list is
   * kept untouched if the loader rejects or returns invalid entries.
   */
  async refresh(): Promise<string[]> {
    if (!this.loader) {
      throw new CorsPolicyError(this.list().join(',') || '*');
    }
    const next = await this.loader();
    this.set(next);
    return this.list();
  }
}

let defaultPolicy: CORSOriginPolicy | undefined;

/** The shared policy used by middleware, routes, and management endpoints. */
export function getCorsPolicy(): CORSOriginPolicy {
  if (!defaultPolicy) {
    defaultPolicy = new CORSOriginPolicy();
  }
  return defaultPolicy;
}

/** Replace the shared policy (used at boot and in tests). */
export function initCorsPolicy(options: CorsPolicyOptions = {}): CORSOriginPolicy {
  defaultPolicy = new CORSOriginPolicy(options);
  return defaultPolicy;
}

// ─── Convenience wrappers over the shared policy ─────────────────────────────

export function addAllowedOrigin(pattern: string): number {
  return getCorsPolicy().add(pattern);
}

export function removeAllowedOrigin(pattern: string): boolean {
  return getCorsPolicy().remove(pattern);
}

export function setAllowedOrigins(patterns: string[]): void {
  getCorsPolicy().set(patterns);
}

export function getAllowedOrigins(): string[] {
  return getCorsPolicy().list();
}

export function isOriginAllowed(origin: string | null | undefined): boolean {
  return getCorsPolicy().isAllowed(origin);
}

/** Record a handled preflight request against the shared metrics. */
export function recordPreflight(allowed: boolean): void {
  metrics.preflights++;
  if (!allowed) metrics.preflightDenied++;
}

export async function refreshAllowedOrigins(): Promise<string[]> {
  return getCorsPolicy().refresh();
}

export function getCorsMetrics(): CorsMetrics {
  return { ...metrics };
}

export function resetCorsMetrics(): void {
  metrics.allowedRequests = 0;
  metrics.deniedRequests = 0;
  metrics.preflights = 0;
  metrics.preflightDenied = 0;
}