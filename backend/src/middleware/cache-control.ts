import type { Request, Response, NextFunction } from 'express';

export const CACHE_NOSTORE_HEADER = 'Cache-Control';
export const VARY_HEADER = 'Vary';

export function cacheControlNoStore(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader(CACHE_NOSTORE_HEADER, 'no-store');
  }
  res.setHeader(VARY_HEADER, 'Accept-Encoding');
  next();
}
