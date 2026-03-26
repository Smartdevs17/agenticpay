import { Request, Response, NextFunction } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    apiVersion?: string;
  }
}

export const versionMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const headerVersion = req.headers['api-version'] || req.headers['x-api-version'] || req.headers['accept-version'];
  let version = 'v1';

  if (headerVersion) {
    version = `v${headerVersion.toString().replace(/^v/i, '')}`;
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
