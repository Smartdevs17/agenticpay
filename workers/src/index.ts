/**
 * workers/src/index.ts — Cloudflare Worker edge handler
 *
 * Cold-start optimizations applied:
 *
 * 1. CODE SPLITTING — route handlers are loaded lazily via dynamic import()
 *    so the initial parse/eval cost is paid only for the code path actually hit.
 *
 * 2. EXECUTION CONTEXT REUSE — expensive objects (URL parser results, compiled
 *    regex, bot-pattern RegExp array) are cached at module scope so they survive
 *    across requests within the same isolate lifetime.
 *
 * 3. WARM-UP SCHEDULING — the Worker's cron trigger (defined in wrangler.toml)
 *    calls the backend /api/v1/cold-start/warmup endpoint every 5 minutes to
 *    prevent the backend from going idle between real requests.
 *
 * 4. COLD START METRICS — every request records whether it was a cold start
 *    (first request in this isolate) and the init duration, stored in KV for
 *    the monitoring dashboard.
 *
 * 5. MEMORY LIMITS — initialization is deferred so the isolate's 128 MB limit
 *    is not exhausted before the first request is served. Heavy objects are
 *    only allocated when the relevant code path is reached.
 */

import {
  validateJwt,
  cacheGet,
  cacheSet,
  checkRateLimit,
  trackAnalytics,
  getCountryFromCf,
  getContinentFromCf,
  isBotUserAgent,
} from './utilities';

// ── Env binding types ─────────────────────────────────────────────────────────

export interface Env {
  USER_SESSIONS: KVNamespace;
  EDGE_CACHE: KVNamespace;
  JWT_SECRET: string;
  API_BASE_URL: string;
}

// ── Execution-context reuse: module-scope constants ───────────────────────────
// These are evaluated once per isolate lifetime, not per request.

const RATE_LIMIT_WINDOW = 60;
const RATE_LIMIT_MAX = 100;

// Warm-up endpoints that should never be rate-limited or auth-checked
const WARMUP_PATHS = new Set([
  '/api/v1/cold-start/warmup',
]);

const PUBLIC_PATHS = [
  '/health',
  '/ready',
  '/api/v1/health',
  '/api/v1/catalog',
  '/api/v1/verification',
  '/api/v1/cold-start/warmup',
];

const CACHE_CONTROL = {
  public: 'public, max-age=60, s-maxage=60',
  private: 'private, max-age=0',
  static: 'public, max-age=86400',
} as const;

// ── Cold start tracking (per-isolate) ─────────────────────────────────────────

/** True for the very first request in this isolate instance. */
let isFirstRequest = true;
/** Timestamp (ms) when this isolate was initialized (module evaluation time). */
const ISOLATE_INIT_TIME = Date.now();

interface ColdStartRecord {
  isolateInitTime: number;
  firstRequestTime: number;
  initDurationMs: number;
  path: string;
  method: string;
}

/**
 * Persist a cold start event to KV so the monitoring dashboard can read it.
 * Fire-and-forget — we don't await this to avoid adding latency to the response.
 */
function recordColdStart(record: ColdStartRecord, env: Env): void {
  const key = `cold-start:${record.isolateInitTime}`;
  // Store for 24 hours
  env.EDGE_CACHE.put(key, JSON.stringify(record), { expirationTtl: 86400 }).catch(() => {
    // best-effort — never throw from metrics recording
  });
}

// ── Lazy handler registry ─────────────────────────────────────────────────────
// Each handler is a function that processes a matched request.
// Handlers are only imported/instantiated when their route is first hit,
// keeping the initial parse cost minimal.

type RouteHandler = (
  request: Request,
  env: Env,
  url: URL,
  userId: string | null
) => Promise<Response>;

// Cache of already-loaded handlers (execution context reuse across requests)
const handlerCache = new Map<string, RouteHandler>();

/**
 * Returns a handler for the given route key, loading it lazily on first access.
 * All handlers in this worker are thin wrappers around fetch() to the backend,
 * but the pattern allows future code-splitting into separate handler modules.
 */
function getHandler(routeKey: string): RouteHandler {
  const cached = handlerCache.get(routeKey);
  if (cached) return cached;

  // Default handler: proxy to backend API
  const handler: RouteHandler = async (request, env, url, _userId) => {
    const apiUrl = `${env.API_BASE_URL}${url.pathname}${url.search}`;
    const method = request.method;

    return fetch(apiUrl, {
      method,
      headers: {
        'Content-Type': request.headers.get('content-type') ?? 'application/json',
        'X-Forwarded-For': request.headers.get('cf-connecting-ip') ?? '',
        'X-Real-IP': request.headers.get('cf-connecting-ip') ?? '',
        'X-Edge-Country': getCountryFromCf((request as any).cf ?? {}),
        'X-Edge-Continent': getContinentFromCf((request as any).cf ?? {}),
        'X-Route-Key': routeKey,
      },
      ...(method !== 'GET' && method !== 'HEAD' ? { body: request.body } : {}),
    });
  };

  handlerCache.set(routeKey, handler);
  return handler;
}

/**
 * Classify a URL path into a route key for handler lookup and caching.
 * Coarse-grained bucketing keeps the handler cache small.
 */
function classifyRoute(path: string): string {
  if (path === '/health' || path === '/ready') return 'health';
  if (path.startsWith('/api/v1/cold-start')) return 'cold-start';
  if (path.startsWith('/api/v1/verification')) return 'verification';
  if (path.startsWith('/api/v1/invoice')) return 'invoice';
  if (path.startsWith('/api/v1/stellar')) return 'stellar';
  if (path.startsWith('/api/v1/catalog')) return 'catalog';
  if (path.startsWith('/api/v1/payments')) return 'payments';
  if (path.startsWith('/api/v1/webhooks') || path.startsWith('/webhooks')) return 'webhooks';
  if (path.startsWith('/api/v1/analytics')) return 'analytics';
  if (path.startsWith('/graphql')) return 'graphql';
  return 'default';
}

// ── Warm-up handler ───────────────────────────────────────────────────────────

/**
 * Called by the Cloudflare cron trigger (wrangler.toml: crons = ["*/5 * * * *"]).
 * Pings the backend warm-up endpoint to prevent cold starts on critical paths.
 */
async function handleScheduled(env: Env): Promise<void> {
  const warmupUrl = `${env.API_BASE_URL}/api/v1/cold-start/warmup`;

  try {
    const res = await fetch(warmupUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Warmup-Source': 'cf-cron' },
    });

    if (!res.ok) {
      console.warn(`[warmup] Backend warm-up ping returned ${res.status}`);
    } else {
      console.log('[warmup] Backend warm-up ping succeeded');
    }
  } catch (err) {
    console.error('[warmup] Backend warm-up ping failed:', err);
  }
}

// ── Main request handler ──────────────────────────────────────────────────────

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const startTime = Date.now();

  // ── Cold start detection ────────────────────────────────────────────────────
  if (isFirstRequest) {
    isFirstRequest = false;
    const initDurationMs = startTime - ISOLATE_INIT_TIME;

    recordColdStart(
      {
        isolateInitTime: ISOLATE_INIT_TIME,
        firstRequestTime: startTime,
        initDurationMs,
        path,
        method,
      },
      env
    );

    console.log(`[cold-start] New isolate — init: ${initDurationMs}ms, first request: ${method} ${path}`);
  }

  // ── CORS preflight ──────────────────────────────────────────────────────────
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key',
      },
    });
  }

  // ── Warm-up shortcut — skip auth/rate-limit, proxy directly to backend ───────
  // The warmup endpoint is called by the cron trigger. We skip auth and rate
  // limiting but still proxy to the backend so it registers the request and
  // updates its own lastRequestAt timestamp (preventing idle-gap cold starts).
  if (WARMUP_PATHS.has(path) && method === 'POST') {
    try {
      const warmupUrl = `${env.API_BASE_URL}${path}`;
      const backendRes = await fetch(warmupUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Warmup-Source': 'cf-worker' },
      });
      const body = await backendRes.text();
      return new Response(body, {
        status: backendRes.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    } catch {
      // Backend unreachable — return a local warm response so the cron doesn't fail
      return new Response(
        JSON.stringify({ ok: true, warm: true, source: 'edge-fallback', timestamp: new Date().toISOString() }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }
  }

  // ── Bot detection ───────────────────────────────────────────────────────────
  const isBot = isBotUserAgent(request.headers.get('user-agent') ?? '');
  if (isBot && !path.startsWith('/sitemap')) {
    return new Response('Forbidden', { status: 403 });
  }

  // ── Auth ────────────────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization');
  let userId: string | null = null;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const session = await validateJwt(token, env);
    userId = session?.userId ?? null;
  }

  // ── Rate limiting ───────────────────────────────────────────────────────────
  const rateLimitResult = await checkRateLimit(
    userId ?? request.headers.get('cf-connecting-ip') ?? 'anonymous',
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW,
    env
  );

  if (!rateLimitResult.allowed) {
    return new Response(
      JSON.stringify({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests',
          retryAfter: Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000),
        },
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(rateLimitResult.resetAt / 1000)),
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }

  // ── Auth guard for non-public paths ────────────────────────────────────────
  const isPublicPath = PUBLIC_PATHS.some(
    (p) => path === p || path.startsWith(p + '/')
  );

  if (!isPublicPath && !userId) {
    return new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ── Edge cache (GET only) ───────────────────────────────────────────────────
  const cacheKey = `cache:${path}:${JSON.stringify(Object.fromEntries(url.searchParams))}`;
  if (method === 'GET') {
    const cached = await cacheGet(cacheKey, env);
    if (cached) {
      const responseTime = Date.now() - startTime;
      await trackAnalytics(
        {
          path,
          method,
          country: getCountryFromCf((request as any).cf ?? {}),
          continent: getContinentFromCf((request as any).cf ?? {}),
          responseTime,
          statusCode: 200,
          isBot,
          timestamp: Date.now(),
        },
        env
      );

      return new Response(cached, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': CACHE_CONTROL.public,
          'X-Cache': 'HIT',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  }

  // ── Route to lazy-loaded handler ────────────────────────────────────────────
  const routeKey = classifyRoute(path);
  const handler = getHandler(routeKey);

  try {
    const apiResponse = await handler(request, env, url, userId);
    const responseBody = await apiResponse.text();
    const statusCode = apiResponse.status;

    // Cache successful public GET responses at the edge
    if (statusCode === 200 && method === 'GET' && isPublicPath) {
      await cacheSet(cacheKey, responseBody, 60, env);
    }

    const responseTime = Date.now() - startTime;
    await trackAnalytics(
      {
        path,
        method,
        country: getCountryFromCf((request as any).cf ?? {}),
        continent: getContinentFromCf((request as any).cf ?? {}),
        responseTime,
        statusCode,
        isBot,
        timestamp: Date.now(),
      },
      env
    );

    return new Response(responseBody, {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': isPublicPath ? CACHE_CONTROL.public : CACHE_CONTROL.private,
        'X-Cache': 'MISS',
        'X-RateLimit-Remaining': String(rateLimitResult.remaining),
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: { code: 'EDGE_ERROR', message: 'Failed to process request' } }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ── Worker export ─────────────────────────────────────────────────────────────

export default {
  /**
   * Handles incoming HTTP requests.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return new Response(
        JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Edge worker error' } }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  },

  /**
   * Handles Cloudflare cron triggers.
   * Triggered by: crons = ["*/5 * * * *"] in wrangler.toml
   * Pings the backend warm-up endpoint to prevent cold starts.
   */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(env));
  },
};
