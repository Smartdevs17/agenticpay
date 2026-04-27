import { Request, Response, NextFunction } from 'express';

/**
 * Options for the deprecation middleware.
 */
interface DeprecationOptions {
  /**
   * The date when the endpoint was deprecated (ISO 8601 format, e.g., '2023-12-31').
   */
  deprecationDate: string;
  /**
   * The date when the endpoint will be removed (ISO 8601 format, e.g., '2024-06-30').
   */
  sunsetDate?: string;
  /**
   * URL to the new endpoint or documentation.
   */
  alternativeUrl?: string;
}

/**
 * Middleware to add deprecation headers to a response.
 * Follows the draft-ietf-httpapi-deprecation-header and draft-ietf-httpapi-sunset-header.
 * 
 * @param options DeprecationOptions
 * @returns Express Middleware
 */
export const deprecationMiddleware = (options: DeprecationOptions) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // 1. Add Deprecation header
    // The Deprecation header indicates that the resource is deprecated.
    // It can also include the date when the deprecation started.
    res.setHeader('Deprecation', new Date(options.deprecationDate).toUTCString());

    // 2. Add Sunset header (if provided)
    // The Sunset header indicates when the resource will become unavailable.
    if (options.sunsetDate) {
      res.setHeader('Sunset', new Date(options.sunsetDate).toUTCString());
    }

    // 3. Include alternative info (Link header)
    // The Link header with rel="successor-version" can point to a newer version.
    if (options.alternativeUrl) {
      // If there are existing Link headers, we should append to them.
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

    // 4. Log deprecation
    // This helps server operators identify usage of deprecated endpoints.
    console.warn(`[DEPRECATION WARNING] Client ${req.ip} accessed deprecated endpoint ${req.method} ${req.originalUrl}. Deprecated since: ${options.deprecationDate}.`);

    next();
  };
};
