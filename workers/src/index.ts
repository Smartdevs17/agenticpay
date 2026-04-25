import { validateJwt, cacheGet, cacheSet, checkRateLimit, trackAnalytics, getCountryFromCf, getContinentFromCf, isBotUserAgent } from './utilities';

export interface Env {
  USER_SESSIONS: KVNamespace;
  EDGE_CACHE: KVNamespace;
  JWT_SECRET: string;
  API_BASE_URL: string;
}

const RATE_LIMIT_WINDOW = 60;
const RATE_LIMIT_MAX = 100;

const PUBLIC_PATHS = [
  '/health',
  '/api/v1/health',
  '/api/v1/catalog',
  '/api/v1/verification',
];

const CACHE_CONTROL = {
  public: 'public, max-age=60, s-maxage=60',
  private: 'private, max-age=0',
  static: 'public, max-age=86400',
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const startTime = Date.now();

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

  const country = getCountryFromCf(request.cf || {});
  const continent = getContinentFromCf(request.cf || {});
  const isBot = isBotUserAgent(request.headers.get('user-agent') || '');

  if (isBot && !path.startsWith('/sitemap')) {
    return new Response('Forbidden', { status: 403 });
  }

  const authHeader = request.headers.get('authorization');
  let userId: string | null = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const session = await validateJwt(token, env);
    userId = session?.userId || null;
  }

  const rateLimitResult = await checkRateLimit(
    userId || request.headers.get('cf-connecting-ip') || 'anonymous',
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW,
    env
  );

  if (!rateLimitResult.allowed) {
    return new Response(JSON.stringify({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests',
        retryAfter: Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000),
      },
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(rateLimitResult.resetAt / 1000)),
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  const isPublicPath = PUBLIC_PATHS.some(
    (publicPath) => path === publicPath || path.startsWith(publicPath + '/')
  );

  if (!isPublicPath && !userId) {
    return new Response(JSON.stringify({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cacheKey = `cache:${path}:${JSON.stringify(Object.fromEntries(url.searchParams))}`;
  const cached = await cacheGet(cacheKey, env);

  if (cached && method === 'GET') {
    const responseTime = Date.now() - startTime;
    await trackAnalytics({
      path,
      method,
      country,
      continent,
      responseTime,
      statusCode: 200,
      isBot,
      timestamp: Date.now(),
    }, env);

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

  try {
    const apiUrl = `${env.API_BASE_URL}${path}`;
    const apiResponse = await fetch(apiUrl, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': request.headers.get('cf-connecting-ip') || '',
        'X-Real-IP': request.headers.get('cf-connecting-ip') || '',
        'X-Edge-Country': country,
        'X-Edge-Continent': continent,
      },
      ...(method !== 'GET' && method !== 'HEAD' ? { body: request.body } : {}),
    });

    const responseBody = await apiResponse.text();
    const statusCode = apiResponse.status;

    if (statusCode === 200 && method === 'GET' && isPublicPath) {
      await cacheSet(cacheKey, responseBody, 60, env);
    }

    const responseTime = Date.now() - startTime;
    await trackAnalytics({
      path,
      method,
      country,
      continent,
      responseTime,
      statusCode,
      isBot,
      timestamp: Date.now(),
    }, env);

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
    return new Response(JSON.stringify({
      error: {
        code: 'EDGE_ERROR',
        message: 'Failed to process request',
      },
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return new Response(JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Edge worker error',
        },
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};