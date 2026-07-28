/**
 * Cursor-based pagination middleware with field selection support
 */

import type { Request, Response, NextFunction } from 'express';

export interface PaginationParams {
  limit: number;
  cursor?: string;
  after?: string;
  before?: string;
  fields?: string[];
}

export interface CursorPageInfo {
  startCursor: string;
  endCursor: string;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  totalCount?: number;
  pageSize: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pageInfo: CursorPageInfo;
  _meta: {
    requestId?: string;
    timestamp: string;
    cacheStatus?: 'HIT' | 'MISS';
  };
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const DEFAULT_CURSOR_ENCODING = 'base64url';

export class CursorPaginator {
  /**
   * Decode cursor to get the offset/ID
   */
  static decodeCursor(cursor: string, encoding = DEFAULT_CURSOR_ENCODING): string {
    try {
      if (encoding === 'base64url') {
        return Buffer.from(cursor, 'base64').toString('utf-8');
      }
      return cursor;
    } catch {
      return '';
    }
  }

  /**
   * Encode value to cursor
   */
  static encodeCursor(value: string, encoding = DEFAULT_CURSOR_ENCODING): string {
    if (encoding === 'base64url') {
      return Buffer.from(value, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    }
    return value;
  }

  /**
   * Parse pagination params from request
   */
  static parsePaginationParams(query: any): PaginationParams {
    let limit = parseInt(query.limit || DEFAULT_PAGE_SIZE, 10);
    if (limit < 1) limit = DEFAULT_PAGE_SIZE;
    if (limit > MAX_PAGE_SIZE) limit = MAX_PAGE_SIZE;

    const fields = query.fields ? (typeof query.fields === 'string' ? query.fields.split(',') : query.fields) : undefined;

    return {
      limit,
      cursor: query.cursor || query.after,
      after: query.after,
      before: query.before,
      fields: fields?.map((f: string) => f.trim()).filter((f: string) => f),
    };
  }

  /**
   * Create a paginated response
   */
  static createResponse<T extends Record<string, any>>(
    items: T[],
    params: PaginationParams,
    totalCount?: number,
    cacheStatus?: 'HIT' | 'MISS',
  ): PaginatedResponse<T> {
    const startCursor = items.length > 0 ? this.encodeCursor(String(items[0].id || items[0]._id || 0)) : '';
    const endCursor = items.length > 0 ? this.encodeCursor(String(items[items.length - 1].id || items[items.length - 1]._id || 0)) : '';

    return {
      data: items,
      pageInfo: {
        startCursor,
        endCursor,
        hasNextPage: items.length >= params.limit,
        hasPreviousPage: !!params.cursor || !!params.before,
        totalCount,
        pageSize: items.length,
      },
      _meta: {
        timestamp: new Date().toISOString(),
        cacheStatus,
      },
    };
  }

  /**
   * Apply field selection to objects
   */
  static selectFields<T extends Record<string, any>>(items: T[], fields?: string[]): Partial<T>[] {
    if (!fields || fields.length === 0) return items;

    return items.map((item) => {
      const selected: any = {};
      for (const field of fields) {
        if (field in item) {
          selected[field] = item[field];
        }
      }
      // Always include id
      if ('id' in item) selected.id = item.id;
      if ('_id' in item) selected._id = item._id;
      return selected;
    });
  }
}

/**
 * Pagination middleware for automatic param parsing
 */
export function paginationMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.pagination = CursorPaginator.parsePaginationParams(req.query);

  // Add response helper
  res.sendPaginated = function <T extends Record<string, any>>(
    items: T[],
    totalCount?: number,
    cacheStatus?: 'HIT' | 'MISS',
  ) {
    const fields = req.pagination?.fields;
    const selectedItems = CursorPaginator.selectFields(items, fields);
    const response = CursorPaginator.createResponse(selectedItems as T[], req.pagination || { limit: DEFAULT_PAGE_SIZE }, totalCount, cacheStatus);
    response._meta.requestId = req.id || (req as any).requestId;

    // Add cache headers for paginated responses
    res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
    res.set('Vary', 'Accept-Encoding,Accept-Language,Cookie');

    return res.json(response);
  };

  next();
}

// Extend Express types
declare global {
  namespace Express {
    interface Request {
      pagination?: PaginationParams;
    }
    interface Response {
      sendPaginated?: <T extends Record<string, any>>(items: T[], totalCount?: number, cacheStatus?: 'HIT' | 'MISS') => Response;
    }
  }
}

/**
 * Build efficient cursor-based query filters for database
 */
export function buildCursorFilter(cursor: string | undefined, idField = 'id', direction: 'after' | 'before' = 'after') {
  if (!cursor) return {};

  const decodedCursor = CursorPaginator.decodeCursor(cursor);

  if (direction === 'after') {
    return { [idField]: { $gt: decodedCursor } };
  } else {
    return { [idField]: { $lt: decodedCursor } };
  }
}

/**
 * Prisma-specific cursor filter builder
 */
export function buildPrismaCursorFilter(cursor: string | undefined, idField = 'id', direction: 'after' | 'before' = 'after') {
  if (!cursor) return undefined;

  const decodedCursor = CursorPaginator.decodeCursor(cursor);

  if (direction === 'after') {
    return {
      [idField]: {
        gt: decodedCursor,
      },
    };
  } else {
    return {
      [idField]: {
        lt: decodedCursor,
      },
    };
  }
}

/**
 * ETag generation for response validation
 */
export function generateETag(data: any, encoding = 'utf8'): string {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(JSON.stringify(data), encoding).digest('hex');
  return `"${hash.substring(0, 16)}"`;
}

/**
 * Middleware for ETag validation
 */
export function etagMiddleware(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);

  res.json = function (body: any) {
    const etag = generateETag(body);
    res.set('ETag', etag);

    // Check If-None-Match
    if (req.get('if-none-match') === etag) {
      return res.status(304).end();
    }

    return originalJson(body);
  };

  next();
}
