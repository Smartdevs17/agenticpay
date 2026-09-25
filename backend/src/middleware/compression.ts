/**
 * Issue #821 — Request/Response Compression
 *
 * Layered compression middleware for the AgenticPay API:
 *
 * Response compression:
 *   - Brotli (br) — preferred when client sends `Accept-Encoding: br`
 *   - Gzip / deflate — fallback via the `compression` npm package
 *   - Skips already-compressed content types (images, zip, etc.)
 *   - Respects `X-No-Compression: 1` opt-out header
 *   - Per-endpoint configuration overrides global threshold/level
 *
 * Request decompression:
 *   - Transparently decompresses gzip / brotli request bodies before
 *     express.json() / express.urlencoded() parses them
 *
 * Metrics:
 *   - Tracks total/compressed request counts, ratio, avg latency, and
 *     per-encoding (br, gzip) counters via getCompressionMetrics()
 */

import compression from 'compression';
import zlib from 'node:zlib';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompressionConfig {
  level: number;
  minSizeBytes: number;
  excludeContentTypes: string[];
  /** Brotli quality (0-11, default 4 — fast with good ratio) */
  brotliQuality?: number;
}

interface CompressionMetrics {
  totalRequests: number;
  compressedRequests: number;
  totalOriginalSize: number;
  totalCompressedSize: number;
  compressionRatio: number;
  brotliRequests: number;
  gzipRequests: number;
  averageCompressionTimeMs: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: CompressionConfig = {
  level: 6,
  minSizeBytes: 1024,
  brotliQuality: 4,
  excludeContentTypes: [
    'image/',
    'video/',
    'audio/',
    'application/zip',
    'application/gzip',
    'application/br',
    'font/',
  ],
};

const TEXT_TYPES = [
  'text/',
  'application/json',
  'application/javascript',
  'application/xml',
  'application/graphql-response+json',
  'application/problem+json',
];

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const configs = new Map<string, CompressionConfig>();
const compressionTimes: number[] = [];

const metrics: CompressionMetrics = {
  totalRequests: 0,
  compressedRequests: 0,
  totalOriginalSize: 0,
  totalCompressedSize: 0,
  compressionRatio: 0,
  brotliRequests: 0,
  gzipRequests: 0,
  averageCompressionTimeMs: 0,
};

// ---------------------------------------------------------------------------
// Per-endpoint config
// ---------------------------------------------------------------------------

export function configureEndpoint(endpoint: string, config: Partial<CompressionConfig>): void {
  const existing = configs.get(endpoint) ?? { ...DEFAULT_CONFIG };
  configs.set(endpoint, { ...existing, ...config });
}

function endpointConfig(req: Request, globalConfig: CompressionConfig): CompressionConfig {
  return configs.get(req.route?.path ?? req.path) ?? configs.get(req.path) ?? globalConfig;
}

// ---------------------------------------------------------------------------
// Compressibility checks
// ---------------------------------------------------------------------------

function isCompressibleContentType(contentType: string, config: CompressionConfig): boolean {
  const normalized = contentType.toLowerCase();
  if (config.excludeContentTypes.some((excluded) => normalized.startsWith(excluded))) {
    return false;
  }
  return TEXT_TYPES.some((type) => normalized.startsWith(type));
}

export function shouldCompressResponse(req: Request, res: Response, config = DEFAULT_CONFIG): boolean {
  if (req.headers['x-no-compression']) return false;

  const contentType = String(res.getHeader('Content-Type') ?? '').toLowerCase();
  if (contentType && !isCompressibleContentType(contentType, config)) {
    return false;
  }

  return compression.filter(req, res);
}

export function clientAcceptsBrotli(req: Request): boolean {
  const ae = req.headers['accept-encoding'];
  if (!ae) return false;
  const value = Array.isArray(ae) ? ae.join(',') : ae;
  // Match 'br' as a token, ignoring quality values
  return /\bbr\b/.test(value);
}

// ---------------------------------------------------------------------------
// Metrics helpers
// ---------------------------------------------------------------------------

function updateMetrics(startedAt: bigint, res: Response): void {
  metrics.totalRequests += 1;

  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  compressionTimes.push(elapsedMs);
  if (compressionTimes.length > 1000) compressionTimes.shift();
  metrics.averageCompressionTimeMs =
    compressionTimes.reduce((sum, value) => sum + value, 0) / compressionTimes.length;

  const encoding = String(res.getHeader('Content-Encoding') ?? '').toLowerCase();
  if (!encoding) return;

  metrics.compressedRequests += 1;
  if (encoding === 'br') metrics.brotliRequests += 1;
  if (encoding === 'gzip') metrics.gzipRequests += 1;

  const contentLength = Number(res.getHeader('Content-Length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 0) {
    metrics.totalCompressedSize += contentLength;
  }

  if (metrics.totalOriginalSize > 0 && metrics.totalCompressedSize > 0) {
    metrics.compressionRatio =
      (1 - metrics.totalCompressedSize / metrics.totalOriginalSize) * 100;
  }
}

export function recordCompressionMetric(
  originalSize: number,
  compressedSize: number,
  encoding: string,
  timeMs: number,
): void {
  metrics.totalRequests += 1;
  if (compressedSize < originalSize) {
    metrics.compressedRequests += 1;
    metrics.totalOriginalSize += originalSize;
    metrics.totalCompressedSize += compressedSize;
    if (encoding === 'br') metrics.brotliRequests += 1;
    if (encoding === 'gzip') metrics.gzipRequests += 1;
  }

  compressionTimes.push(timeMs);
  if (compressionTimes.length > 1000) compressionTimes.shift();
  metrics.compressionRatio =
    metrics.totalOriginalSize > 0
      ? (1 - metrics.totalCompressedSize / metrics.totalOriginalSize) * 100
      : 0;
  metrics.averageCompressionTimeMs =
    compressionTimes.reduce((sum, value) => sum + value, 0) / compressionTimes.length;
}

export function getCompressionMetrics() {
  return {
    activeEndpoints: Array.from(configs.keys()),
    ...metrics,
  };
}

export function resetCompressionMetrics(): void {
  metrics.totalRequests = 0;
  metrics.compressedRequests = 0;
  metrics.totalOriginalSize = 0;
  metrics.totalCompressedSize = 0;
  metrics.compressionRatio = 0;
  metrics.brotliRequests = 0;
  metrics.gzipRequests = 0;
  metrics.averageCompressionTimeMs = 0;
  compressionTimes.length = 0;
}

// ---------------------------------------------------------------------------
// Brotli response middleware
//
// Intercepts res.end/write to brotli-compress the response body when the
// client sends `Accept-Encoding: br` and the response is compressible.
// Falls through to the gzip middleware otherwise.
// ---------------------------------------------------------------------------

function brotliResponseMiddleware(config: CompressionConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const cfg = endpointConfig(req, config);

    if (!clientAcceptsBrotli(req)) {
      return next();
    }

    // We'll intercept only compressible responses
    const originalEnd = res.end.bind(res) as typeof res.end;
    const originalWrite = res.write.bind(res);
    const chunks: Buffer[] = [];
    let intercepting = false;

    function checkAndIntercept() {
      if (intercepting) return;
      const contentType = String(res.getHeader('Content-Type') ?? '').toLowerCase();
      if (!contentType || !isCompressibleContentType(contentType, cfg)) return;
      if (req.headers['x-no-compression']) return;
      intercepting = true;
    }

    // Override write to buffer chunks
    res.write = function (
      chunk: any,
      encodingOrCallback?: BufferEncoding | ((error: Error | null | undefined) => void),
      callback?: (error: Error | null | undefined) => void,
    ): boolean {
      checkAndIntercept();
      if (!intercepting) {
        if (typeof encodingOrCallback === 'function') {
          return originalWrite(chunk, encodingOrCallback as any);
        }
        return originalWrite(chunk, encodingOrCallback as any, callback as any);
      }
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else if (typeof chunk === 'string') {
        const enc = typeof encodingOrCallback === 'string' ? encodingOrCallback : 'utf8';
        chunks.push(Buffer.from(chunk, enc as BufferEncoding));
      } else if (chunk) {
        chunks.push(Buffer.from(String(chunk)));
      }
      return true;
    } as typeof res.write;

    res.end = function (
      chunkOrCallback?: any,
      encodingOrCallback?: any,
      callback?: any,
    ): Response {
      checkAndIntercept();

      if (!intercepting) {
        return originalEnd(chunkOrCallback, encodingOrCallback, callback);
      }

      // Collect final chunk
      if (chunkOrCallback && typeof chunkOrCallback !== 'function') {
        const chunk = chunkOrCallback;
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        } else if (typeof chunk === 'string') {
          const enc = typeof encodingOrCallback === 'string' ? encodingOrCallback : 'utf8';
          chunks.push(Buffer.from(chunk, enc as BufferEncoding));
        }
      }

      const body = Buffer.concat(chunks);

      if (body.length < cfg.minSizeBytes) {
        // Too small — don't compress
        res.write = originalWrite;
        res.end = originalEnd;
        return originalEnd(body, encodingOrCallback, callback);
      }

      const brotliOpts: zlib.BrotliOptions = {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: cfg.brotliQuality ?? 4,
        },
      };

      const startMs = Date.now();
      zlib.brotliCompress(body, brotliOpts, (err, compressed) => {
        if (err) {
          // Fall back to uncompressed on error
          res.write = originalWrite;
          res.end = originalEnd;
          originalEnd(body);
          return;
        }

        recordCompressionMetric(body.length, compressed.length, 'br', Date.now() - startMs);

        res.removeHeader('Content-Length');
        res.setHeader('Content-Encoding', 'br');
        res.setHeader('Vary', 'Accept-Encoding');

        res.write = originalWrite;
        res.end = originalEnd;
        originalEnd(compressed);
      });

      return res;
    } as typeof res.end;

    next();
  };
}

// ---------------------------------------------------------------------------
// Request decompression middleware
//
// Decompresses incoming request bodies encoded as gzip or brotli so that
// express.json() receives a normal uncompressed body.
// ---------------------------------------------------------------------------

export function requestDecompressionMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const encoding = (req.headers['content-encoding'] ?? '').toLowerCase();

    if (encoding !== 'gzip' && encoding !== 'br') {
      return next();
    }

    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('error', next);
    req.on('end', () => {
      const compressed = Buffer.concat(chunks);
      const decompress = encoding === 'br' ? zlib.brotliDecompress : zlib.gunzip;

      decompress(compressed, (err, decompressed) => {
        if (err) {
          res.status(400).json({ error: 'Failed to decompress request body', encoding });
          return;
        }

        // Replace stream with decompressed data
        delete req.headers['content-encoding'];
        req.headers['content-length'] = String(decompressed.length);

        let offset = 0;
        (req as any).push = undefined; // make it re-readable

        // Re-emit data so express body parsers pick it up
        const { Readable } = require('stream');
        const stream = new Readable({
          read() {
            this.push(decompressed);
            this.push(null);
          },
        });

        Object.assign(req, stream);
        next();
      });
    });
  };
}

// ---------------------------------------------------------------------------
// Main composite middleware
//
// Order: brotli intercept → gzip fallback (via `compression` package)
// ---------------------------------------------------------------------------

export function compressionMiddleware(config?: Partial<CompressionConfig>) {
  const globalConfig: CompressionConfig = { ...DEFAULT_CONFIG, ...config };

  const brotliMw = brotliResponseMiddleware(globalConfig);
  const gzipMw = compression({
    threshold: globalConfig.minSizeBytes,
    level: globalConfig.level,
    filter: (req, res) => {
      // Skip if brotli was already applied
      if (res.getHeader('Content-Encoding') === 'br') return false;
      return shouldCompressResponse(req, res, endpointConfig(req, globalConfig));
    },
  });

  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = process.hrtime.bigint();
    res.once('finish', () => updateMetrics(startedAt, res));

    // Try brotli first; if client doesn't accept it, gzip handles it
    brotliMw(req, res, () => {
      if (res.getHeader('Content-Encoding') === 'br') {
        return next();
      }
      gzipMw(req, res, next);
    });
  };
}
