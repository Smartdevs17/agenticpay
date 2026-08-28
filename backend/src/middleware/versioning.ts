import { Request, Response, NextFunction } from "express";

export interface ApiVersion {
  version: string;
  deprecated?: boolean;
  deprecationDate?: Date;
  sunsetDate?: Date;
  alternativeVersion?: string;
}

export interface VersioningConfig {
  defaultVersion: string;
  supportedVersions: ApiVersion[];
  headerName?: string;
  queryParamName?: string;
}

const DEPRECATION_WARNING_DAYS = 90;

function parseVersion(versionString: string): number {
  const match = versionString.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return 0;

  const major = parseInt(match[1] || "0", 10);
  const minor = parseInt(match[2] || "0", 10);
  const patch = parseInt(match[3] || "0", 10);

  return major * 10000 + minor * 100 + patch;
}

function findVersion(
  requestedVersion: string,
  supportedVersions: ApiVersion[],
): ApiVersion | null {
  return supportedVersions.find((v) => v.version === requestedVersion) || null;
}

function extractVersionFromPath(path: string): string | null {
  const match = path.match(/^\/api\/v(\d+)/);
  return match ? `v${match[1]}` : null;
}

export function apiVersioning(config: VersioningConfig) {
  const {
    defaultVersion,
    supportedVersions,
    headerName = "api-version",
    queryParamName = "version",
  } = config;

  return (req: Request, res: Response, next: NextFunction): void => {
    let requestedVersion: string | null = null;

    requestedVersion = extractVersionFromPath(req.path);

    if (!requestedVersion) {
      requestedVersion = req.headers[headerName] as string;
    }

    if (!requestedVersion) {
      requestedVersion = req.query[queryParamName] as string;
    }

    const version = requestedVersion || defaultVersion;
    const versionInfo = findVersion(version, supportedVersions);

    if (!versionInfo) {
      res.status(400).json({
        error: "Unsupported API version",
        message: `API version '${version}' is not supported`,
        supportedVersions: supportedVersions.map((v) => v.version),
      });
      return;
    }

    req.apiVersion = version;
    res.setHeader("X-API-Version", version);

    if (versionInfo.deprecated) {
      const now = new Date();
      let deprecationMessage = `API version ${version} is deprecated`;

      if (versionInfo.sunsetDate) {
        const daysUntilSunset = Math.ceil(
          (versionInfo.sunsetDate.getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24),
        );

        if (daysUntilSunset <= 0) {
          res.status(410).json({
            error: "API version sunset",
            message: `API version ${version} has been sunset and is no longer available`,
            alternativeVersion:
              versionInfo.alternativeVersion || defaultVersion,
          });
          return;
        }

        deprecationMessage += `. It will be sunset on ${versionInfo.sunsetDate.toISOString()}`;

        if (daysUntilSunset <= DEPRECATION_WARNING_DAYS) {
          deprecationMessage += ` (${daysUntilSunset} days remaining)`;
        }
      }

      if (versionInfo.alternativeVersion) {
        deprecationMessage += `. Please migrate to version ${versionInfo.alternativeVersion}`;
      }

      res.setHeader("Deprecation", "true");
      res.setHeader("Sunset", versionInfo.sunsetDate?.toUTCString() || "");
      res.setHeader(
        "Link",
        `</api/${versionInfo.alternativeVersion || defaultVersion}>; rel="successor-version"`,
      );
      res.setHeader("X-API-Deprecation-Info", deprecationMessage);
    }

    next();
  };
}

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

export function getApiVersionInfo(req: Request): {
  version: string;
  deprecated: boolean;
  sunsetDate?: Date;
} {
  return {
    version: req.apiVersion || "v1",
    deprecated: false,
  };
}

declare global {
  namespace Express {
    interface Request {
      apiVersion?: string;
    }
  }
}
