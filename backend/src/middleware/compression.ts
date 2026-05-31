import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import type { Request, Response, NextFunction } from 'express';

interface CompressionConfig {
  brotliLevel: number;
  gzipLevel: number;
  minSizeBytes: number;
  excludeContentTypes: string[];
}

const DEFAULT_CONFIG: CompressionConfig = {
  brotliLevel: 5,
  gzipLevel: 6,
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

export function configureEndpoint(endpoint: string, config: Partial<CompressionConfig>): void {
  const existing = configs.get(endpoint) ?? { ...DEFAULT_CONFIG };
  Object.assign(existing, config);
  configs.set(endpoint, existing);
}

function getConfig(req: Request): CompressionConfig {
  const endpoint = req.route?.path ?? req.path;
  return configs.get(endpoint) ?? DEFAULT_CONFIG;
}

function shouldCompress(req: Request, res: Response, config: CompressionConfig): boolean {
  if (req.headers['x-no-compression']) return false;

  const contentLength = parseInt(res.getHeader('Content-Length') as string || '0', 10);
  if (contentLength > 0 && contentLength < config.minSizeBytes) return false;

  const contentType = (res.getHeader('Content-Type') as string || '').toLowerCase();
  if (!contentType) return false;

  for (const exclude of config.excludeContentTypes) {
    if (contentType.startsWith(exclude)) return false;
  }

  if (TEXT_TYPES.some(t => contentType.startsWith(t))) return true;

  return false;
}

function getCompressedResponse(res: Response, body: unknown, config: CompressionConfig): Buffer | null {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const bodyBuf = Buffer.from(bodyStr, 'utf-8');
  const len = bodyBuf.length;

  const acceptEncoding = (res.req.headers['accept-encoding'] as string) || '';

  if (acceptEncoding.includes('br')) {
    try {
      const compressed = brotliCompressSync(bodyBuf, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: config.brotliLevel,
          [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
        },
      });
      if (compressed.length < len) {
        res.setHeader('Content-Encoding', 'br');
        res.setHeader('X-Compression', 'brotli');
        return compressed;
      }
    } catch {
      // Fall through to gzip
    }
  }

  if (acceptEncoding.includes('gzip')) {
    try {
      const compressed = gzipSync(bodyBuf, { level: config.gzipLevel });
      if (compressed.length < len) {
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('X-Compression', 'gzip');
        return compressed;
      }
    } catch {
      // Fall through to uncompressed
    }
  }

  if (acceptEncoding.includes('deflate')) {
    return null;
  }

  return null;
}

export function compressionMiddleware(config?: Partial<CompressionConfig>) {
  const globalConfig = { ...DEFAULT_CONFIG, ...config };

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === 'HEAD') {
      next();
      return;
    }

    const endpointConfig = configs.get(req.path) ?? globalConfig;

    if (!shouldCompress(req, res, endpointConfig)) {
      next();
      return;
    }

    const originalSend = res.send.bind(res);
    const originalJson = res.json.bind(res);
    const originalEnd = res.end.bind(res);

    let responseBody: unknown = null;
    let contentType: string | undefined;

    res.send = (body: unknown): Response => {
      responseBody = body;
      contentType = res.getHeader('Content-Type') as string || undefined;
      return originalSend(''); // Will be replaced by our compressed version in end
    };

    res.json = (body: unknown): Response => {
      responseBody = body;
      contentType = 'application/json';
      return originalJson(body);
    };

    res.end = (data?: unknown, encoding?: BufferEncoding | (() => void), cb?: () => void): Response => {
      const body = data ?? responseBody;
      if (!body) {
        return originalEnd(data as Buffer, (encoding as BufferEncoding) || 'utf-8', cb as (() => void) | undefined);
      }

      const compressed = getCompressedResponse(res, body, endpointConfig);
      if (compressed) {
        res.removeHeader('Content-Length');
        return originalEnd(compressed, cb as (() => void) | undefined);
      }

      return originalEnd(data as Buffer, (encoding as BufferEncoding) || 'utf-8', cb as (() => void) | undefined);
    };

    next();
  };
}

export function getCompressionMetrics() {
  return {
    activeEndpoints: Array.from(configs.keys()),
  };
}
