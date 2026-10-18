import { Request, Response, NextFunction } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    apiVersion?: string;
  }
}

function normalizeVersionValue(value?: string | string[]): string | undefined {
  if (!value) {
    return undefined;
  }

  const rawVersion = Array.isArray(value) ? value[0] : value;
  const versionString = rawVersion?.toString().trim();

  if (!versionString) {
    return undefined;
  }

  if (/^v?\d+$/i.test(versionString)) {
    return `v${versionString.replace(/^v/i, '')}`;
  }

  const mimeVersionMatch = versionString.match(/v(?<version>\d+)(?:\+|;|$)/i);
  if (mimeVersionMatch?.groups?.version) {
    return `v${mimeVersionMatch.groups.version}`;
  }

  const parameterVersionMatch = versionString.match(/version\s*=\s*"?(\d+)"?/i);
  if (parameterVersionMatch) {
    return `v${parameterVersionMatch[1]}`;
  }

  return undefined;
}

export const versionMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const headerVersion =
    normalizeVersionValue(req.headers['api-version']) ||
    normalizeVersionValue(req.headers['x-api-version']) ||
    normalizeVersionValue(req.headers['accept-version']) ||
    normalizeVersionValue(req.headers['content-type']) ||
    normalizeVersionValue(req.headers['accept']);

  let version = 'v1';

  if (headerVersion) {
    version = headerVersion;
  } else {
    const match = req.originalUrl.match(/^\/api\/(v\d+)\//);
    if (match) {
      version = match[1];
    }
  }

  req.apiVersion = version;
  res.setHeader('X-API-Version', version);

  const info = versionRegistry.get(version);
  if (info?.deprecated) {
    res.setHeader('Deprecation', 'true');
    if (info.sunsetDate) {
      res.setHeader('Sunset', new Date(info.sunsetDate).toUTCString());
    }
    if (info.alternativeVersion) {
      res.setHeader('Link', `</api/${info.alternativeVersion}/>; rel="successor-version"`);
    }
  }

  next();
};

export interface ApiVersion {
  version: string;
  description?: string;
  changelogUrl?: string;
  alternativeVersion?: string;
  deprecated: boolean;
  sunsetDate?: string;
  registeredAt: string;
}

export interface RegisterVersionInput {
  version: string;
  description?: string;
  changelogUrl?: string;
  alternativeVersion?: string;
}

const versionRegistry = new Map<string, ApiVersion>();

function compareVersions(a: string, b: string): number {
  return Number(a.replace(/^v/, '')) - Number(b.replace(/^v/, ''));
}

export function registerVersion(input: RegisterVersionInput): ApiVersion {
  const existing = versionRegistry.get(input.version);
  const info: ApiVersion = {
    ...existing,
    ...input,
    deprecated: existing?.deprecated ?? false,
    sunsetDate: existing?.sunsetDate,
    registeredAt: existing?.registeredAt ?? new Date().toISOString(),
  };
  versionRegistry.set(info.version, info);
  return info;
}

export function getVersion(version: string): ApiVersion | undefined {
  return versionRegistry.get(version);
}

export function listVersions(): ApiVersion[] {
  return Array.from(versionRegistry.values()).sort((a, b) => compareVersions(a.version, b.version));
}

export function deprecateVersion(version: string, sunsetDate: Date, alternativeVersion?: string): ApiVersion {
  const info = versionRegistry.get(version);
  if (!info) {
    throw new Error(`Version '${version}' is not registered.`);
  }
  info.deprecated = true;
  info.sunsetDate = sunsetDate.toISOString();
  if (alternativeVersion) {
    info.alternativeVersion = alternativeVersion;
  }
  return info;
}
