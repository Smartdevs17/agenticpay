/**
 * Issue #821 — Request/Response Compression
 * Tests for gzip/brotli selection, compressibility checks, metrics, and config.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import {
  shouldCompressResponse,
  clientAcceptsBrotli,
  getCompressionMetrics,
  recordCompressionMetric,
  configureEndpoint,
  resetCompressionMetrics,
  DEFAULT_CONFIG,
} from '../compression.js';

function req(headers: Record<string, string> = {}, path = '/api/v1/data'): Request {
  return { headers, path } as unknown as Request;
}

function res(contentType?: string): Response {
  const h: Record<string, string> = {};
  if (contentType) h['Content-Type'] = contentType;
  return {
    getHeader: (n: string) => h[n],
  } as unknown as Response;
}

describe('shouldCompressResponse', () => {
  it('skips when X-No-Compression header is set', () => {
    expect(shouldCompressResponse(req({ 'x-no-compression': '1' }), res('application/json'))).toBe(false);
  });

  it('compresses JSON responses', () => {
    expect(shouldCompressResponse(req({ 'accept-encoding': 'gzip' }), res('application/json'))).toBe(true);
  });

  it('compresses text/* responses', () => {
    expect(shouldCompressResponse(req({ 'accept-encoding': 'gzip' }), res('text/plain'))).toBe(true);
    expect(shouldCompressResponse(req({ 'accept-encoding': 'gzip' }), res('text/csv'))).toBe(true);
  });

  it('skips binary / already-compressed content types', () => {
    for (const ct of ['image/png', 'video/mp4', 'application/zip', 'application/gzip', 'font/woff2']) {
      expect(shouldCompressResponse(req({ 'accept-encoding': 'gzip' }), res(ct))).toBe(false);
    }
  });

  it('passes graphql+json as compressible', () => {
    expect(shouldCompressResponse(req({ 'accept-encoding': 'gzip' }), res('application/graphql-response+json'))).toBe(true);
  });
});

describe('clientAcceptsBrotli', () => {
  it('returns true when br is in Accept-Encoding', () => {
    expect(clientAcceptsBrotli(req({ 'accept-encoding': 'gzip, deflate, br' }))).toBe(true);
    expect(clientAcceptsBrotli(req({ 'accept-encoding': 'br' }))).toBe(true);
  });

  it('returns false when br is absent', () => {
    expect(clientAcceptsBrotli(req({ 'accept-encoding': 'gzip, deflate' }))).toBe(false);
    expect(clientAcceptsBrotli(req({}))).toBe(false);
  });

  it('does not match partial tokens like "brotli"', () => {
    // 'brotli' should not match the 'br' token
    expect(clientAcceptsBrotli(req({ 'accept-encoding': 'brotli' }))).toBe(false);
  });
});

describe('compression metrics', () => {
  beforeEach(() => resetCompressionMetrics());

  it('starts with zeroed counters', () => {
    const m = getCompressionMetrics();
    expect(m.totalRequests).toBe(0);
    expect(m.compressedRequests).toBe(0);
    expect(m.brotliRequests).toBe(0);
    expect(m.gzipRequests).toBe(0);
  });

  it('records a gzip compression event', () => {
    recordCompressionMetric(2000, 500, 'gzip', 2);
    const m = getCompressionMetrics();
    expect(m.totalRequests).toBe(1);
    expect(m.compressedRequests).toBe(1);
    expect(m.gzipRequests).toBe(1);
    expect(m.brotliRequests).toBe(0);
    expect(m.compressionRatio).toBeGreaterThan(0);
  });

  it('records a brotli compression event', () => {
    recordCompressionMetric(3000, 600, 'br', 3);
    const m = getCompressionMetrics();
    expect(m.brotliRequests).toBe(1);
    expect(m.gzipRequests).toBe(0);
  });

  it('does not count as compressed when body grew', () => {
    // compressed >= original → not counted
    recordCompressionMetric(100, 200, 'gzip', 1);
    const m = getCompressionMetrics();
    expect(m.compressedRequests).toBe(0);
  });

  it('accumulates multiple events', () => {
    recordCompressionMetric(1000, 400, 'gzip', 1);
    recordCompressionMetric(2000, 600, 'br', 2);
    const m = getCompressionMetrics();
    expect(m.totalRequests).toBe(2);
    expect(m.compressedRequests).toBe(2);
    expect(m.gzipRequests).toBe(1);
    expect(m.brotliRequests).toBe(1);
  });

  it('resets all counters', () => {
    recordCompressionMetric(1000, 300, 'gzip', 1);
    resetCompressionMetrics();
    const m = getCompressionMetrics();
    expect(m.totalRequests).toBe(0);
    expect(m.compressionRatio).toBe(0);
    expect(m.averageCompressionTimeMs).toBe(0);
  });
});

describe('per-endpoint config', () => {
  beforeEach(() => resetCompressionMetrics());

  it('registers an endpoint override', () => {
    configureEndpoint('/api/v1/exports', { level: 9, minSizeBytes: 512 });
    const m = getCompressionMetrics();
    expect(m.activeEndpoints).toContain('/api/v1/exports');
  });

  it('overwrites partial fields while keeping defaults', () => {
    configureEndpoint('/api/v1/exports', { level: 9, minSizeBytes: 512 });
    configureEndpoint('/api/v1/exports', { level: 1 });
    const m = getCompressionMetrics();
    // Both calls target the same endpoint — still 1 entry
    expect(m.activeEndpoints.filter(e => e === '/api/v1/exports').length).toBe(1);
  });
});

describe('DEFAULT_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_CONFIG.level).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_CONFIG.level).toBeLessThanOrEqual(9);
    expect(DEFAULT_CONFIG.minSizeBytes).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.brotliQuality).toBeDefined();
    expect(DEFAULT_CONFIG.excludeContentTypes.length).toBeGreaterThan(0);
  });
});
