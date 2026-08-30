import compression from 'compression';
import type { Request, Response, NextFunction } from 'express';

interface CompressionConfig {
  level: number;
  minSizeBytes: number;
  excludeContentTypes: string[];
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

const DEFAULT_CONFIG: CompressionConfig = {
  level: 6,
  minSizeBytes: 1024,
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

export function configureEndpoint(endpoint: string, config: Partial<CompressionConfig>): void {
  const existing = configs.get(endpoint) ?? { ...DEFAULT_CONFIG };
  configs.set(endpoint, { ...existing, ...config });
}

function endpointConfig(req: Request, globalConfig: CompressionConfig): CompressionConfig {
  return configs.get(req.route?.path ?? req.path) ?? configs.get(req.path) ?? globalConfig;
}

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

export function compressionMiddleware(config?: Partial<CompressionConfig>) {
  const globalConfig = { ...DEFAULT_CONFIG, ...config };
  const middleware = compression({
    threshold: globalConfig.minSizeBytes,
    level: globalConfig.level,
    filter: (req, res) => shouldCompressResponse(req, res, endpointConfig(req, globalConfig)),
  });

  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = process.hrtime.bigint();
    res.once('finish', () => updateMetrics(startedAt, res));
    middleware(req, res, next);
  };
}

export function getCompressionMetrics() {
  return {
    activeEndpoints: Array.from(configs.keys()),
    ...metrics,
  };
}
