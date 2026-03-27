import { Request, Response, NextFunction } from 'express';

interface CacheEntry {
  response: any;
  statusCode: number;
  expiresAt: number;
}

// In-memory cache for idempotency keys
const idempotencyCache = new Map<string, CacheEntry>();

// Default TTL is 24 hours (in milliseconds)
const DEFAULT_TTL = 24 * 60 * 60 * 1000;

export const idempotency = (ttl: number = DEFAULT_TTL) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers['x-idempotency-key'] as string;

    if (!key) {
      // If no key is provided, proceed normally.
      return next();
    }

    // Include the original URL to scope the key per route
    const cacheKey = `${req.method}:${req.originalUrl}:${key}`;

    const cached = idempotencyCache.get(cacheKey);

    if (cached) {
      if (Date.now() < cached.expiresAt) {
        // Return cached response instantly
        return res.status(cached.statusCode).json(cached.response);
      } else {
        // Expired, remove from cache and proceed
        idempotencyCache.delete(cacheKey);
      }
    }

    // Intercept res.json to capture the response
    const originalJson = res.json.bind(res);

    res.json = (body: any) => {
      // Cache the response if status is successful or we want to cache errors too
      // Usually we cache 2xx and 4xx responses, but 5xx might be transient.
      // For simplicity, we cache all completed responses that used this key.
      idempotencyCache.set(cacheKey, {
        response: body,
        statusCode: res.statusCode,
        expiresAt: Date.now() + ttl,
      });

      // Call the original res.json
      return originalJson(body);
    };

    next();
  };
};

// Exported for testing purposes
export const clearIdempotencyCache = () => {
  idempotencyCache.clear();
};
