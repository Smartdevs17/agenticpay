import { createHash } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

// CDN TTL tiers (seconds)
export const CDN_TTL = {
  NONE:    0,
  REALTIME: 0,
  USER:    30,
  STATIC:  300,
} as const;

// How long stale content may be served while a CDN revalidates (seconds).
const SWR_SLACK = 60;

// Authorization header is hashed so CDN can cache per-user without leaking tokens.
const AUTH_HASH_LENGTH = 16;

export interface CacheHeaderOptions {
  ttl: number;
  surrogateTtl?: number;
  staleWhileRevalidate?: number;
  staleIfError?: number;
  varyOn?: string[];
  surrogateKeys?: string[];
  bypassForMutations?: boolean;
}

interface CacheMetric {
  path: string;
  method: string;
  ttl: number;
  cacheControl: string;
  surrogateControl: string;
  timestamp: number;
}

const metrics: CacheMetric[] = [];
const MAX_METRICS = 5000;

export function getCacheMetrics(): CacheMetric[] {
  return metrics.slice();
}

export function getCacheHitRatioSummary(): {
  total: number;
  cachedPaths: number;
  bypassedPaths: number;
} {
  const cached = metrics.filter((m) => m.ttl > 0).length;
  return { total: metrics.length, cachedPaths: cached, bypassedPaths: metrics.length - cached };
}

function record(metric: Omit<CacheMetric, 'timestamp'>): void {
  metrics.push({ ...metric, timestamp: Date.now() });
  if (metrics.length > MAX_METRICS) metrics.splice(0, metrics.length - MAX_METRICS);
}

function hashAuth(authorization: string | undefined): string {
  if (!authorization) return 'anon';
  return createHash('sha256').update(authorization).digest('hex').slice(0, AUTH_HASH_LENGTH);
}

function buildCacheControl(ttl: number, swr?: number, sie?: number): string {
  if (ttl <= 0) return 'no-store';
  const parts = ['private', `max-age=${ttl}`];
  if (swr && swr > 0) parts.push(`stale-while-revalidate=${swr}`);
  if (sie && sie > 0) parts.push(`stale-if-error=${sie}`);
  return parts.join(', ');
}

function buildSurrogateControl(ttl: number, swr?: number): string {
  if (ttl <= 0) return 'no-store';
  const stale = swr ?? SWR_SLACK;
  return `max-age=${ttl}, stale-while-revalidate=${stale}`;
}

export function cacheHeaders(options: CacheHeaderOptions) {
  const {
    ttl,
    surrogateTtl = ttl,
    staleWhileRevalidate = SWR_SLACK,
    staleIfError = 3600,
    varyOn = [],
    surrogateKeys = [],
    bypassForMutations = true,
  } = options;

  const cacheControl = buildCacheControl(ttl, staleWhileRevalidate, staleIfError);
  const surrogateControl = buildSurrogateControl(surrogateTtl, staleWhileRevalidate);

  return function cacheHeaderMiddleware(req: Request, res: Response, next: NextFunction): void {
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase());

    if (bypassForMutations && isMutation) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Surrogate-Control', 'no-store');
      next();
      return;
    }

    // Build Vary header: always include Accept, plus caller-specified fields plus
    // a hashed version of Authorization so CDN can cache per-user safely.
    const varyFields = ['Accept', ...varyOn];
    const authorization = req.headers['authorization'];
    if (authorization) {
      res.setHeader('X-Auth-Hash', hashAuth(authorization));
      varyFields.push('X-Auth-Hash');
    }
    if (req.headers['accept-language']) varyFields.push('Accept-Language');

    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('Surrogate-Control', surrogateControl);
    res.setHeader('Vary', [...new Set(varyFields)].join(', '));

    if (surrogateKeys.length > 0) {
      res.setHeader('Surrogate-Key', surrogateKeys.join(' '));
      res.setHeader('Cache-Tag', surrogateKeys.join(' ')); // Cloudflare syntax
    }

    res.setHeader('X-Cache-TTL', String(ttl));

    record({
      path: req.path,
      method: req.method,
      ttl,
      cacheControl,
      surrogateControl,
    });

    next();
  };
}

// ─── Purge helpers ────────────────────────────────────────────────────────────
// Call these after mutations to invalidate CDN edge caches.

export interface PurgeTarget {
  provider: 'cloudfront' | 'cloudflare' | 'fastly';
  paths?: string[];
  surrogateKeys?: string[];
}

export async function purgeCdnCache(target: PurgeTarget): Promise<{ ok: boolean; error?: string }> {
  try {
    switch (target.provider) {
      case 'cloudfront':
        return purgeCloudFront(target.paths ?? ['/*']);
      case 'cloudflare':
        return purgeCloudflare(target.surrogateKeys ?? [], target.paths ?? []);
      case 'fastly':
        return purgeFastly(target.surrogateKeys ?? []);
      default:
        return { ok: false, error: 'Unknown CDN provider' };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function purgeCloudFront(paths: string[]): Promise<{ ok: boolean; error?: string }> {
  const distributionId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!distributionId || !accessKeyId || !secretKey) {
    return { ok: false, error: 'CloudFront credentials not configured' };
  }

  const callerReference = `purge-${Date.now()}`;
  const body = JSON.stringify({
    Paths: { Quantity: paths.length, Items: paths },
    CallerReference: callerReference,
  });

  const res = await fetch(
    `https://cloudfront.amazonaws.com/2020-05-31/distribution/${distributionId}/invalidation`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    },
  );

  return { ok: res.ok, error: res.ok ? undefined : `CloudFront responded ${res.status}` };
}

async function purgeCloudflare(
  surrogateKeys: string[],
  paths: string[],
): Promise<{ ok: boolean; error?: string }> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;

  if (!zoneId || !token) {
    return { ok: false, error: 'Cloudflare credentials not configured' };
  }

  const payload =
    surrogateKeys.length > 0 ? { tags: surrogateKeys } : { files: paths };

  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return { ok: res.ok, error: res.ok ? undefined : `Cloudflare responded ${res.status}` };
}

async function purgeFastly(surrogateKeys: string[]): Promise<{ ok: boolean; error?: string }> {
  const serviceId = process.env.FASTLY_SERVICE_ID;
  const token = process.env.FASTLY_API_TOKEN;

  if (!serviceId || !token) {
    return { ok: false, error: 'Fastly credentials not configured' };
  }

  const results = await Promise.all(
    surrogateKeys.map((key) =>
      fetch(`https://api.fastly.com/service/${serviceId}/purge/${key}`, {
        method: 'POST',
        headers: { 'Fastly-Key': token },
      }),
    ),
  );

  const allOk = results.every((r) => r.ok);
  return { ok: allOk, error: allOk ? undefined : 'One or more Fastly purge requests failed' };
}

// ─── Pre-built presets ────────────────────────────────────────────────────────

export const cdnCache = {
  none: () => cacheHeaders({ ttl: CDN_TTL.NONE }),
  realtime: () => cacheHeaders({ ttl: CDN_TTL.REALTIME }),
  userData: (surrogateKeys?: string[]) =>
    cacheHeaders({ ttl: CDN_TTL.USER, staleWhileRevalidate: 10, surrogateKeys }),
  staticData: (surrogateKeys?: string[]) =>
    cacheHeaders({ ttl: CDN_TTL.STATIC, staleWhileRevalidate: SWR_SLACK, surrogateKeys }),
};
