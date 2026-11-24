/**
 * Responsive image loader for mobile assets (issue #1640).
 *
 * Assets are shipped as AVIF plus a PNG fallback. The loader picks the
 * smallest variant that covers the device's CSS width × pixel ratio, builds a
 * srcset for the chosen format, and retries a same-width fallback if the
 * preferred fetch fails. Every decision and fallback is observable through
 * injected logger/metrics hooks.
 */

export type ImageFormat = 'avif' | 'webp' | 'png' | 'jpeg' | 'gif' | 'unknown';

export interface ImageCandidate {
  url: string;
  width: number;
  format: ImageFormat;
  bytes: number;
}

export interface ImageAsset {
  description?: string;
  candidates: ImageCandidate[];
}

export interface AssetManifest {
  version: number;
  breakpoints: number[];
  images: Record<string, ImageAsset>;
}

export interface ImageRequest {
  viewportWidth: number;
  devicePixelRatio?: number;
  supportsAvif?: boolean;
}

export interface LoadedImage {
  id: string;
  url: string;
  width: number;
  format: ImageFormat;
  bytes: number;
  srcSet: string;
  usedFallback: boolean;
}

export interface ImageFetchResponse {
  ok: boolean;
  status?: number;
  bytes?: number;
  contentType?: string;
}

export type ImageFetcher = (url: string) => Promise<ImageFetchResponse>;

export interface ImageLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface ImageMetrics {
  increment(name: string, labels?: Record<string, string | number>): void;
}

export interface ResponsiveImageLoaderOptions {
  manifest: AssetManifest;
  baseUrl?: string;
  fetcher?: ImageFetcher;
  logger?: ImageLogger;
  metrics?: ImageMetrics;
  supportsAvif?: boolean;
  fallbackFormat?: ImageFormat;
}

export type ImageLoaderErrorCode =
  | 'INVALID_MANIFEST'
  | 'INVALID_REQUEST'
  | 'ASSET_NOT_FOUND'
  | 'NO_CANDIDATE'
  | 'LOAD_FAILED';

export class ImageLoaderError extends Error {
  readonly code: ImageLoaderErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ImageLoaderErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ImageLoaderError';
    this.code = code;
    this.details = details;
  }
}

const noopLogger: ImageLogger = { info: () => {}, warn: () => {}, error: () => {} };
const noopMetrics: ImageMetrics = { increment: () => {} };

const SUPPORTED_FORMATS: ImageFormat[] = ['avif', 'webp', 'png', 'jpeg', 'gif'];

export function formatFromUrl(url: string): ImageFormat {
  if (typeof url !== 'string') return 'unknown';
  const path = url.split('?')[0].split('#')[0].toLowerCase();
  const extension = path.slice(path.lastIndexOf('.') + 1);
  const format = SUPPORTED_FORMATS.find((item) => item === extension || (item === 'jpeg' && extension === 'jpg'));
  return format ?? 'unknown';
}

/** Reject malformed manifests explicitly instead of silently skipping entries. */
export function validateManifest(manifest: AssetManifest): void {
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.breakpoints)
    || !manifest.images || typeof manifest.images !== 'object') {
    throw new ImageLoaderError('INVALID_MANIFEST', 'Manifest must be version 1 with breakpoints and images');
  }
  for (const width of manifest.breakpoints) {
    if (!Number.isInteger(width) || width <= 0) {
      throw new ImageLoaderError('INVALID_MANIFEST', `Invalid breakpoint: ${String(width)}`);
    }
  }
  for (const [id, asset] of Object.entries(manifest.images)) {
    if (!asset || !Array.isArray(asset.candidates) || asset.candidates.length === 0) {
      throw new ImageLoaderError('INVALID_MANIFEST', `Asset ${id} has no candidates`);
    }
    const seen = new Set<string>();
    for (const candidate of asset.candidates) {
      if (!candidate.url || !Number.isInteger(candidate.width) || candidate.width <= 0
        || !SUPPORTED_FORMATS.includes(candidate.format) || !Number.isFinite(candidate.bytes) || candidate.bytes <= 0) {
        throw new ImageLoaderError('INVALID_MANIFEST', `Invalid candidate for asset ${id}`);
      }
      const key = `${candidate.width}:${candidate.format}`;
      if (seen.has(key)) {
        throw new ImageLoaderError('INVALID_MANIFEST', `Duplicate candidate ${key} for asset ${id}`);
      }
      seen.add(key);
    }
  }
}

/** Width-descriptor srcset for one format, ascending by width. */
export function buildSrcSet(candidates: ImageCandidate[], format: ImageFormat): string {
  return candidates
    .filter((candidate) => candidate.format === format)
    .sort((a, b) => a.width - b.width || a.url.localeCompare(b.url))
    .map((candidate) => `${candidate.url} ${candidate.width}w`)
    .join(', ');
}

/** Pick the smallest candidate covering the device target, deterministically. */
export function selectCandidate(
  candidates: ImageCandidate[],
  request: ImageRequest,
  preferredFormats?: ImageFormat[],
): ImageCandidate {
  if (!Number.isFinite(request.viewportWidth) || request.viewportWidth <= 0) {
    throw new ImageLoaderError('INVALID_REQUEST', 'viewportWidth must be positive');
  }
  const dpr = request.devicePixelRatio ?? 1;
  if (!Number.isFinite(dpr) || dpr <= 0) {
    throw new ImageLoaderError('INVALID_REQUEST', 'devicePixelRatio must be positive');
  }
  const target = request.viewportWidth * dpr;
  const formats = preferredFormats ?? (request.supportsAvif === false ? ['png'] : ['avif', 'png']);

  for (const format of formats) {
    const pool = candidates
      .filter((candidate) => candidate.format === format)
      .sort((a, b) => a.width - b.width || a.url.localeCompare(b.url));
    if (pool.length === 0) continue;
    return pool.find((candidate) => candidate.width >= target) ?? pool[pool.length - 1];
  }
  throw new ImageLoaderError('NO_CANDIDATE', 'No image candidate matches the request');
}

const defaultFetcher: ImageFetcher = async (url) => {
  const response = await fetch(url, { method: 'GET' });
  return {
    ok: response.ok,
    status: response.status,
    bytes: Number(response.headers.get('content-length') ?? 0),
    contentType: response.headers.get('content-type') ?? undefined,
  };
};

export class ResponsiveImageLoader {
  private readonly manifest: AssetManifest;
  private readonly baseUrl: string;
  private readonly fetcher: ImageFetcher;
  private readonly logger: ImageLogger;
  private readonly metrics: ImageMetrics;
  private readonly supportsAvif: boolean;
  private readonly fallbackFormat: ImageFormat;

  constructor(options: ResponsiveImageLoaderOptions) {
    validateManifest(options.manifest);
    this.manifest = options.manifest;
    this.baseUrl = options.baseUrl ?? '';
    this.fetcher = options.fetcher ?? defaultFetcher;
    this.logger = options.logger ?? noopLogger;
    this.metrics = options.metrics ?? noopMetrics;
    this.supportsAvif = options.supportsAvif ?? true;
    this.fallbackFormat = options.fallbackFormat ?? 'png';
  }

  async load(id: string, request: ImageRequest): Promise<LoadedImage> {
    const asset = this.manifest.images[id];
    if (!asset) {
      throw new ImageLoaderError('ASSET_NOT_FOUND', `Unknown image asset: ${id}`, { id });
    }

    const preferred = this.preferredFormats(request);
    const candidate = selectCandidate(asset.candidates, request, preferred);
    const fallback = asset.candidates.find(
      (item) => item.width === candidate.width && item.format === this.fallbackFormat && item.format !== candidate.format,
    );

    const first = await this.tryFetch(id, candidate, request);
    if (first.error === null) {
      return this.success(id, candidate, request, false, first.bytes);
    }
    const failure = first.error;

    if (!fallback) {
      this.logger.error('image.load.failed', { id, url: candidate.url, reason: failure });
      this.metrics.increment('imageLoadFailedTotal', { id, format: candidate.format });
      throw new ImageLoaderError('LOAD_FAILED', `Failed to load image ${id}`, { id, reason: failure });
    }

    this.logger.warn('image.load.fallback', {
      id,
      from: candidate.url,
      to: fallback.url,
      reason: failure,
    });
    this.metrics.increment('imageFallbackTotal', { id, from: candidate.format, to: fallback.format });

    const second = await this.tryFetch(id, fallback, request);
    if (second.error !== null) {
      this.logger.error('image.load.failed', { id, url: fallback.url, reason: second.error });
      this.metrics.increment('imageLoadFailedTotal', { id, format: fallback.format });
      throw new ImageLoaderError('LOAD_FAILED', `Failed to load image ${id} (including fallback)`, {
        id,
        reason: second.error,
      });
    }
    return this.success(id, fallback, request, true, second.bytes);
  }

  private preferredFormats(request: ImageRequest): ImageFormat[] {
    const supports = request.supportsAvif ?? this.supportsAvif;
    return supports ? ['avif', this.fallbackFormat] : [this.fallbackFormat];
  }

  private async tryFetch(
    id: string,
    candidate: ImageCandidate,
    request: ImageRequest,
  ): Promise<{ error: string | null; bytes: number }> {
    const url = this.resolveUrl(candidate.url);
    try {
      const response = await this.fetcher(url);
      if (!response || !response.ok) {
        return { error: response ? `HTTP ${String(response.status ?? 'unknown')}` : 'empty response', bytes: 0 };
      }
      if (!Number.isFinite(response.bytes) || (response.bytes as number) <= 0) {
        return { error: 'missing content length', bytes: 0 };
      }
      return { error: null, bytes: response.bytes as number };
    } catch (error) {
      this.logger.warn('image.fetch.error', {
        id,
        url,
        error: error instanceof Error ? error.message : String(error),
        viewportWidth: request.viewportWidth,
      });
      return { error: error instanceof Error ? error.message : String(error), bytes: 0 };
    }
  }

  private resolveUrl(url: string): string {
    if (/^https?:\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return url;
    return `${this.baseUrl}${url}`;
  }

  private success(
    id: string,
    candidate: ImageCandidate,
    request: ImageRequest,
    usedFallback: boolean,
    bytes: number,
  ): LoadedImage {
    this.metrics.increment('imageLoadTotal', { id, format: candidate.format });
    this.metrics.increment('imageBytesTotal', bytes);
    this.logger.info('image.load.completed', {
      id,
      url: candidate.url,
      width: candidate.width,
      format: candidate.format,
      bytes,
      viewportWidth: request.viewportWidth,
      usedFallback,
    });
    return {
      id,
      url: candidate.url,
      width: candidate.width,
      format: candidate.format,
      bytes,
      srcSet: buildSrcSet(this.manifest.images[id].candidates, candidate.format),
      usedFallback,
    };
  }
}

export function createResponsiveImageLoader(options: ResponsiveImageLoaderOptions): ResponsiveImageLoader {
  return new ResponsiveImageLoader(options);
}
