/**
 * Pagination Middleware Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CursorPaginator, generateETag, buildPrismaCursorFilter } from '../pagination';

describe('CursorPaginator', () => {
  describe('Cursor Encoding/Decoding', () => {
    it('should encode and decode cursors', () => {
      const original = 'user:123';
      const encoded = CursorPaginator.encodeCursor(original);
      const decoded = CursorPaginator.decodeCursor(encoded);

      expect(encoded).not.toBe(original);
      expect(decoded).toBe(original);
    });

    it('should handle special characters in cursors', () => {
      const original = 'id:abc123!@#$%';
      const encoded = CursorPaginator.encodeCursor(original);
      const decoded = CursorPaginator.decodeCursor(encoded);

      expect(decoded).toBe(original);
    });
  });

  describe('Pagination Parameter Parsing', () => {
    it('should parse default pagination params', () => {
      const query = {};
      const params = CursorPaginator.parsePaginationParams(query);

      expect(params.limit).toBe(20);
      expect(params.cursor).toBeUndefined();
      expect(params.fields).toBeUndefined();
    });

    it('should parse custom limit', () => {
      const query = { limit: '50' };
      const params = CursorPaginator.parsePaginationParams(query);

      expect(params.limit).toBe(50);
    });

    it('should cap limit at maximum', () => {
      const query = { limit: '500' };
      const params = CursorPaginator.parsePaginationParams(query);

      expect(params.limit).toBeLessThanOrEqual(100);
    });

    it('should parse field selection', () => {
      const query = { fields: 'id,name,email' };
      const params = CursorPaginator.parsePaginationParams(query);

      expect(params.fields).toEqual(['id', 'name', 'email']);
    });

    it('should parse array field selection', () => {
      const query = { fields: ['id', 'name'] };
      const params = CursorPaginator.parsePaginationParams(query);

      expect(params.fields).toEqual(['id', 'name']);
    });

    it('should parse cursor params', () => {
      const query = { cursor: 'abc123', limit: '20' };
      const params = CursorPaginator.parsePaginationParams(query);

      expect(params.cursor).toBe('abc123');
    });
  });

  describe('Field Selection', () => {
    it('should select specified fields', () => {
      const items = [
        { id: 1, name: 'Alice', email: 'alice@example.com', password: 'secret' },
        { id: 2, name: 'Bob', email: 'bob@example.com', password: 'secret' },
      ];

      const fields = ['id', 'name'];
      const selected = CursorPaginator.selectFields(items, fields);

      expect(selected).toHaveLength(2);
      expect(selected[0]).toHaveProperty('id');
      expect(selected[0]).toHaveProperty('name');
      expect(selected[0]).not.toHaveProperty('password');
    });

    it('should always include id field', () => {
      const items = [{ id: 1, name: 'Alice', secret: 'hidden' }];
      const fields = ['name'];

      const selected = CursorPaginator.selectFields(items, fields);

      expect(selected[0]).toHaveProperty('id');
      expect(selected[0]).toHaveProperty('name');
      expect(selected[0]).not.toHaveProperty('secret');
    });

    it('should return all fields if none specified', () => {
      const items = [{ id: 1, name: 'Alice', email: 'alice@example.com' }];

      const selected = CursorPaginator.selectFields(items);

      expect(selected).toEqual(items);
    });
  });

  describe('Response Creation', () => {
    it('should create proper paginated response', () => {
      const items = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];

      const params = { limit: 20, fields: undefined };
      const response = CursorPaginator.createResponse(items, params as any, 100);

      expect(response).toHaveProperty('data');
      expect(response).toHaveProperty('pageInfo');
      expect(response).toHaveProperty('_meta');
      expect(response.data).toEqual(items);
      expect(response.pageInfo.pageSize).toBe(2);
      expect(response.pageInfo.totalCount).toBe(100);
    });

    it('should set hasNextPage correctly', () => {
      const items = Array(20).fill(null).map((_, i) => ({ id: i }));
      const params = { limit: 20 };

      const response = CursorPaginator.createResponse(items, params as any);

      expect(response.pageInfo.hasNextPage).toBe(true);
    });

    it('should set hasPreviousPage on subsequent pages', () => {
      const items = [{ id: 3 }, { id: 4 }];
      const params = { limit: 20, cursor: 'encoded_id_2' };

      const response = CursorPaginator.createResponse(items, params as any);

      expect(response.pageInfo.hasPreviousPage).toBe(true);
    });
  });
});

describe('ETag Generation', () => {
  it('should generate consistent ETags', () => {
    const data = { id: 1, name: 'Test' };

    const etag1 = generateETag(data);
    const etag2 = generateETag(data);

    expect(etag1).toBe(etag2);
  });

  it('should generate different ETags for different data', () => {
    const data1 = { id: 1, name: 'Test' };
    const data2 = { id: 2, name: 'Test' };

    const etag1 = generateETag(data1);
    const etag2 = generateETag(data2);

    expect(etag1).not.toBe(etag2);
  });

  it('should generate properly formatted ETags', () => {
    const data = { id: 1 };
    const etag = generateETag(data);

    expect(etag).toMatch(/^"[a-f0-9]{16}"$/);
  });
});

describe('Prisma Cursor Filter Builder', () => {
  it('should build filter for "after" direction', () => {
    const cursor = CursorPaginator.encodeCursor('user:123');
    const filter = buildPrismaCursorFilter(cursor, 'id', 'after');

    expect(filter).toBeDefined();
    expect(filter?.id?.gt).toBe('user:123');
  });

  it('should build filter for "before" direction', () => {
    const cursor = CursorPaginator.encodeCursor('user:123');
    const filter = buildPrismaCursorFilter(cursor, 'id', 'before');

    expect(filter).toBeDefined();
    expect(filter?.id?.lt).toBe('user:123');
  });

  it('should return undefined for empty cursor', () => {
    const filter = buildPrismaCursorFilter(undefined, 'id');

    expect(filter).toBeUndefined();
  });

  it('should use custom id field', () => {
    const cursor = CursorPaginator.encodeCursor('123');
    const filter = buildPrismaCursorFilter(cursor, 'userId', 'after');

    expect(filter?.userId?.gt).toBe('123');
  });
});
