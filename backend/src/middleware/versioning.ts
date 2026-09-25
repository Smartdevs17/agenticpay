/**
 * Issue #822 — API Versioning with Deprecation Headers
 *
 * Middleware and registry for multi-version API management.
 *
 * Standards:
 *   - RFC 8594  (Sunset header)
 *   - Draft "The Deprecation HTTP Header Field" (IETF)
 *   - RFC 7234  (Warning header — 299 Miscellaneous Persistent Warning)
 *
 * Header behaviour on deprecated versions:
 *   Deprecation: <HTTP-date>          — date the version was deprecated
 *   Sunset:      <HTTP-date>          — date the version will stop working
 *   Warning:     299 - "<message>"    — human-readable warning per RFC 7234
 *   Link:        </api/vN>; rel="successor-version"   — migration target
 *   X-API-Version: vN                 — version that handled the request
 *
 * On sunset (sun has already set):
 *   HTTP 410 Gone with JSON error body
 */

import { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiVersion {
  version: string;
  deprecated?: boolean;
  deprecationDate?: Date;
  sunsetDate?: Date;
  alternativeVersion?: string;
  description?: string;
  changelogUrl?: string;
}

export interface VersioningConfig {
  defaultVersion: string;
  supportedVersions: ApiVersion[];
  /** Header name for explicit version selection (default: 'api-version') */
  headerName?: string;
  /** Query param for version selection (default: 'version') */
  queryParamName?: string;
}

// ---------------------------------------------------------------------------
// In-memory version registry (runtime-mutable)
// ---------------------------------------------------------------------------

const registry = new Map<string, ApiVersion>();
let defaultVersion = 'v1';

/** Seed the registry with an initial configuration */
export function initVersionRegistry(config: VersioningConfig): void {
  registry.clear();
  defaultVersion = config.defaultVersion;
  for (const v of config.supportedVersions) {
    registry.set(v.version, { ...v });
  }
}

/** Register or upsert a version entry */
export function registerVersion(version: ApiVersion): void {
  registry.set(version.version, { ...version });
}

/** Mark a version as deprecated */
export function deprecateVersion(version: string, sunsetDate: Date, alternativeVersion?: string): void {
  const existing = registry.get(version);
  if (!existing) throw new Error(`Version '${version}' is not registered`);
  registry.set(version, {
    ...existing,
    deprecated: true,
    deprecationDate: new Date(),
    sunsetDate,
    alternativeVersion: alternativeVersion ?? existing.alternativeVersion,
  });
}

/** List all registered versions */
export function listVersions(): ApiVersion[] {
  return Array.from(registry.values());
}

/** Get a single version entry */
export function getVersion(version: string): ApiVersion | undefined {
  return registry.get(version);
}

// Bootstrap with v1 active
registry.set('v1', { version: 'v1', description: 'Current stable version' });

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

/**
 * Format a Date as an HTTP-date string per RFC 7231 §7.1.1.
 * e.g. "Fri, 25 Sep 2026 21:00:00 GMT"
 */
function toHttpDate(date: Date): string {
  return date.toUTCString();
}

function applyDeprecationHeaders(res: Response, info: ApiVersion): void {
  // Deprecation: <HTTP-date> — when the deprecation was announced
  if (info.deprecationDate) {
    res.setHeader('Deprecation', toHttpDate(info.deprecationDate));
  } else {
    res.setHeader('Deprecation', 'true');
  }

  // Sunset: <HTTP-date> — when the version will stop working
  if (info.sunsetDate) {
    res.setHeader('Sunset', toHttpDate(info.sunsetDate));
  }

  // Warning: 299 — human-readable advisory per RFC 7234 §5.5
  const days = info.sunsetDate
    ? Math.ceil((info.sunsetDate.getTime() - Date.now()) / 86_400_000)
    : null;

  const migrateTo = info.alternativeVersion ? ` Migrate to ${info.alternativeVersion}.` : '';
  const daysNote = days !== null ? ` Sunset in ${days} day(s).` : '';
  res.setHeader('Warning', `299 - "API version ${info.version} is deprecated.${daysNote}${migrateTo}"`);

  // Link: successor-version
  const successor = info.alternativeVersion ?? defaultVersion;
  res.setHeader('Link', `</api/${successor}>; rel="successor-version"`);
}

// ---------------------------------------------------------------------------
// Version extraction
// ---------------------------------------------------------------------------

function normalise(raw: string): string {
  const v = raw.trim().replace(/^v/i, '');
  return `v${v}`;
}

function extractVersionFromRequest(req: Request, headerName: string, queryParam: string): string | null {
  // 1. URL path: /api/v1/... or /api/v2/...
  const pathMatch = (req.originalUrl ?? req.path ?? '').match(/^\/api\/(v\d+)/i);
  if (pathMatch) return normalise(pathMatch[1]);

  // 2. Explicit version headers
  for (const h of [headerName, 'x-api-version', 'accept-version']) {
    const val = req.headers[h];
    if (val) return normalise(Array.isArray(val) ? val[0] : val);
  }

  // 3. Content-Type media-type versioning
  //    e.g. application/vnd.agenticpay.v1+json  or  application/json; version=1
  const ct = req.headers['content-type'] ?? '';
  const vendorMatch = ct.match(/vnd\.[^.]+\.v(\d+)/i);
  if (vendorMatch) return `v${vendorMatch[1]}`;
  const paramMatch = ct.match(/;\s*version=(\d+)/i);
  if (paramMatch) return `v${paramMatch[1]}`;

  // 4. Query param
  const qv = req.query?.[queryParam];
  if (qv) return normalise(String(qv));

  return null;
}

// ---------------------------------------------------------------------------
// Configurable middleware factory
// ---------------------------------------------------------------------------

export function apiVersioning(config: VersioningConfig) {
  initVersionRegistry(config);
  const hdr = config.headerName ?? 'api-version';
  const qp  = config.queryParamName ?? 'version';

  return buildVersionMiddleware(hdr, qp);
}

function buildVersionMiddleware(headerName = 'api-version', queryParam = 'version') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const extracted = extractVersionFromRequest(req, headerName, queryParam);
    const version = extracted ?? defaultVersion;

    const info = registry.get(version);

    if (!info) {
      res.status(400).json({
        error: 'Unsupported API version',
        message: `API version '${version}' is not supported.`,
        supportedVersions: Array.from(registry.keys()),
        current: defaultVersion,
      });
      return;
    }

    // Check if version has already reached sunset
    if (info.deprecated && info.sunsetDate && info.sunsetDate <= new Date()) {
      res.status(410).json({
        error: 'API version sunset',
        message: `API version '${version}' has been sunset and is no longer available.`,
        alternativeVersion: info.alternativeVersion ?? defaultVersion,
        sunsetDate: info.sunsetDate.toISOString(),
      });
      return;
    }

    req.apiVersion = version;
    res.setHeader('X-API-Version', version);

    if (info.deprecated) {
      applyDeprecationHeaders(res, info);
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Simple drop-in middleware (used by default in index.ts)
// ---------------------------------------------------------------------------

export const versionMiddleware = buildVersionMiddleware();

// ---------------------------------------------------------------------------
// Additional helpers (used in tests / routes)
// ---------------------------------------------------------------------------

export function versionedRoute(
  version: string,
  handler: (req: Request, res: Response, next: NextFunction) => void,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.apiVersion === version) {
      return handler(req, res, next);
    }
    next();
  };
}

export function getApiVersionInfo(req: Request): { version: string; deprecated: boolean; sunsetDate?: Date } {
  const info = registry.get(req.apiVersion ?? defaultVersion);
  return {
    version: req.apiVersion ?? defaultVersion,
    deprecated: info?.deprecated ?? false,
    sunsetDate: info?.sunsetDate,
  };
}

declare global {
  namespace Express {
    interface Request {
      apiVersion?: string;
    }
  }
}
