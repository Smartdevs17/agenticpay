import { Request, Response, NextFunction } from 'express';
import { logger } from './logger.js';

export interface DeprecationOptions {
  deprecationDate: string;
  sunsetDate?: string;
  alternativeUrl?: string;
}

export const deprecationMiddleware = (options: DeprecationOptions) => {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Deprecation', new Date(options.deprecationDate).toUTCString());

    if (options.sunsetDate) {
      res.setHeader('Sunset', new Date(options.sunsetDate).toUTCString());
    }

    if (options.alternativeUrl) {
      const existingLink = res.getHeader('Link');
      const newLink = `<${options.alternativeUrl}>; rel="successor-version"`;

      if (existingLink) {
        if (Array.isArray(existingLink)) {
          res.setHeader('Link', [...existingLink, newLink]);
        } else {
          res.setHeader('Link', [`${existingLink}`, newLink]);
        }
      } else {
        res.setHeader('Link', newLink);
      }
    }

    logger.warn({ ip: req.ip, method: req.method, url: req.originalUrl, deprecationDate: options.deprecationDate }, 'Deprecated endpoint accessed');

    next();
  };
};
