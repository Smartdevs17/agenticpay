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

  next();
};
