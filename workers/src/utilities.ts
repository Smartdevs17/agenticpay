export interface Env {
  USER_SESSIONS: KVNamespace;
  EDGE_CACHE: KVNamespace;
  JWT_SECRET: string;
  API_BASE_URL: string;
}

export interface SessionData {
  userId: string;
  email: string;
  roles: string[];
  exp: number;
  iat: number;
}

export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  exp: number;
  iat: number;
}

export async function validateJwt(token: string, env: Env): Promise<SessionData | null> {
  try {
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) {
      return null;
    }

    const payloadDecoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    const now = Math.floor(Date.now() / 1000);

    if (payloadDecoded.exp && payloadDecoded.exp < now) {
      return null;
    }

    const cachedSession = await env.USER_SESSIONS.get(`session:${payloadDecoded.sub}`);
    if (cachedSession) {
      return JSON.parse(cachedSession);
    }

    return {
      userId: payloadDecoded.sub,
      email: payloadDecoded.email,
      roles: payloadDecoded.roles || [],
      exp: payloadDecoded.exp,
      iat: payloadDecoded.iat,
    };
  } catch {
    return null;
  }
}

export async function cacheGet(key: string, env: Env): Promise<string | null> {
  return env.EDGE_CACHE.get(key);
}

export async function cacheSet(
  key: string,
  value: string,
  ttl: number,
  env: Env
): Promise<void> {
  await env.EDGE_CACHE.put(key, value, { expirationTtl: ttl });
}

export function getCountryFromCf(cf: CfProperties): string {
  return cf.country || 'unknown';
}

export function getContinentFromCf(cf: CfProperties): string {
  return cf.continent || 'unknown';
}

export function isBotUserAgent(userAgent: string): boolean {
  const botPatterns = [
    /bot/i,
    /spider/i,
    /crawl/i,
    /slurp/i,
    /mediapartners/i,
    /googlebot/i,
    /bingbot/i,
    /duckduckbot/i,
  ];
  return botPatterns.some((pattern) => pattern.test(userAgent));
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export async function checkRateLimit(
  identifier: string,
  limit: number,
  windowSeconds: number,
  env: Env
): Promise<RateLimitResult> {
  const key = `ratelimit:${identifier}`;
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  const current = await env.EDGE_CACHE.get(key);
  
  if (!current) {
    await env.EDGE_CACHE.put(key, '1', { expirationTtl: windowSeconds });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  const count = parseInt(current, 10);
  if (count >= limit) {
    const ttl = await env.EDGE_CACHE.getWithMetadata(key);
    const resetAt = ttl?.expiration ? ttl.expiration * 1000 : now + windowMs;
    return { allowed: false, remaining: 0, resetAt };
  }

  await env.EDGE_CACHE.put(key, String(count + 1), { expirationTtl: windowSeconds });
  return { allowed: true, remaining: limit - count - 1, resetAt: now + windowMs };
}

export interface EdgeAnalytics {
  path: string;
  method: string;
  country: string;
  continent: string;
  responseTime: number;
  statusCode: number;
  isBot: boolean;
  timestamp: number;
}

export async function trackAnalytics(
  analytics: EdgeAnalytics,
  env: Env
): Promise<void> {
  try {
    const key = `analytics:${analytics.timestamp}:${Math.random().toString(36).substr(2, 9)}`;
    await env.EDGE_CACHE.put(key, JSON.stringify(analytics), { expirationTtl: 86400 });
  } catch (error) {
    console.error('Failed to track analytics:', error);
  }
}