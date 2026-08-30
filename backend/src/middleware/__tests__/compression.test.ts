import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import {
  getCompressionMetrics,
  recordCompressionMetric,
  shouldCompressResponse,
} from '../compression';

function req(headers: Record<string, string> = {}): Request {
  return { headers } as Request;
}

function res(contentType?: string): Response {
  const headers: Record<string, string> = {};
  if (contentType) headers['Content-Type'] = contentType;

  return {
    getHeader(name: string) {
      return headers[name];
    },
  } as unknown as Response;
}

describe('compression middleware helpers', () => {
  it('skips compression when explicitly disabled', () => {
    expect(shouldCompressResponse(req({ 'x-no-compression': '1' }), res('application/json'))).toBe(false);
  });

  it('allows JSON and text responses through the compression filter', () => {
    expect(shouldCompressResponse(req({ 'accept-encoding': 'gzip' }), res('application/json'))).toBe(true);
    expect(shouldCompressResponse(req({ 'accept-encoding': 'gzip' }), res('text/csv'))).toBe(true);
  });

  it('skips pre-compressed or binary content types', () => {
    expect(shouldCompressResponse(req({ 'accept-encoding': 'gzip' }), res('image/png'))).toBe(false);
    expect(shouldCompressResponse(req({ 'accept-encoding': 'gzip' }), res('application/zip'))).toBe(false);
  });

  it('records compression metrics', () => {
    const before = getCompressionMetrics();

    recordCompressionMetric(1000, 250, 'gzip', 4);
    const after = getCompressionMetrics();

    expect(after.totalRequests).toBe(before.totalRequests + 1);
    expect(after.compressedRequests).toBeGreaterThanOrEqual(before.compressedRequests + 1);
    expect(after.gzipRequests).toBeGreaterThanOrEqual(before.gzipRequests + 1);
    expect(after.compressionRatio).toBeGreaterThan(0);
  });
});
