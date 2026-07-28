// API versioning middleware — Issue #526
// Routes requests to the correct API version handler and adds deprecation headers

import { Request, Response, NextFunction } from 'express';

export interface VersionedRequest extends Request {
  apiVersion?: string;
  isDeprecated?: boolean;
  deprecatedUntil?: Date;
}

// Current API version - update when releasing new versions
const CURRENT_VERSION = 'v1';
const SUPPORTED_VERSIONS = ['v1'];

// Version status tracking
const versionStatus: Record<string, { deprecated?: Date; sunset?: Date }> = {
  v1: { deprecated: undefined, sunset: undefined },
};

export function apiVersionMiddleware(req: VersionedRequest, res: Response, next: NextFunction) {
  // Extract version from URL path (e.g., /api/v1/payments, /api/v2/invoices)
  const pathMatch = req.path.match(/^\/api\/(v\d+)\//);
  const version = pathMatch ? pathMatch[1] : CURRENT_VERSION;

  // Set version on request
  req.apiVersion = version;

  // Check if version is supported
  if (!SUPPORTED_VERSIONS.includes(version)) {
    return res.status(400).json({
      error: 'Unsupported API version',
      version,
      supported: SUPPORTED_VERSIONS,
      current: CURRENT_VERSION,
    });
  }

  // Check version status and add deprecation headers
  const status = versionStatus[version];
  if (status?.deprecated) {
    req.isDeprecated = true;
    req.deprecatedUntil = status.deprecated;

    // Add deprecation headers (RFC 8594)
    res.set('Deprecation', 'true');
    res.set('Sunset', new Date(status.deprecated).toUTCString());
    res.set('Warning', `299 - "API version ${version} is deprecated"`);

    if (status.sunset) {
      const sunsetDate = new Date(status.sunset);
      res.set('Sunset', sunsetDate.toUTCString());
    }
  }

  // Log version usage (can be collected for analytics)
  const timestamp = new Date();
  console.log(`[api-version] ${req.method} ${req.path} -> ${version} at ${timestamp.toISOString()}`);

  next();
}

export function getVersionInfo(version: string = CURRENT_VERSION) {
  return {
    version,
    supported: SUPPORTED_VERSIONS,
    current: CURRENT_VERSION,
    status: versionStatus[version] || { deprecated: undefined, sunset: undefined },
  };
}

export function markVersionDeprecated(version: string, sunsetDate: Date) {
  if (versionStatus[version]) {
    versionStatus[version].deprecated = new Date();
    versionStatus[version].sunset = sunsetDate;
  }
}

export function getDeprecationWarning(version: string): string | null {
  const status = versionStatus[version];
  if (!status?.deprecated) return null;

  const daysUntilSunset = Math.ceil((status.sunset!.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return `API version ${version} is deprecated and will be removed in ${daysUntilSunset} days. See migration guide.`;
}
