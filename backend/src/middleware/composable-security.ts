/**
 * #730: Composable Security Middleware Chains
 * 
 * Implements a flexible, composable middleware chain system for security
 * that allows combining multiple security checks in a declarative way.
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';

export type SecurityMiddleware = RequestHandler;
export type SecurityContext = {
  req: Request;
  res: Response;
  next: NextFunction;
  metadata: Map<string, any>;
};

/**
 * Middleware chain configuration
 */
export interface ChainConfig {
  name: string;
  middlewares: SecurityMiddleware[];
  stopOnError?: boolean; // Default: true
  parallel?: boolean; // Default: false
  timeout?: number; // milliseconds
}

/**
 * Composable middleware chain builder
 */
export class MiddlewareChain {
  private middlewares: SecurityMiddleware[] = [];
  private name: string;
  private stopOnError: boolean = true;
  private parallel: boolean = false;
  private timeout?: number;

  constructor(name: string = 'default') {
    this.name = name;
  }

  /**
   * Add middleware to the chain
   */
  use(middleware: SecurityMiddleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Add multiple middlewares
   */
  useMany(middlewares: SecurityMiddleware[]): this {
    this.middlewares.push(...middlewares);
    return this;
  }

  /**
   * Configure chain behavior
   */
  configure(options: { stopOnError?: boolean; parallel?: boolean; timeout?: number }): this {
    if (options.stopOnError !== undefined) this.stopOnError = options.stopOnError;
    if (options.parallel !== undefined) this.parallel = options.parallel;
    if (options.timeout !== undefined) this.timeout = options.timeout;
    return this;
  }

  /**
   * Build the composed middleware
   */
  build(): SecurityMiddleware {
    if (this.parallel) {
      return this.buildParallel();
    }
    return this.buildSequential();
  }

  /**
   * Build sequential middleware chain
   */
  private buildSequential(): SecurityMiddleware {
    return (req: Request, res: Response, next: NextFunction) => {
      let index = 0;
      const metadata = new Map<string, any>();

      const executeNext = (err?: any): void => {
        if (err) {
          if (this.stopOnError) {
            return next(err);
          }
          // Continue to next middleware even on error
        }

        if (index >= this.middlewares.length) {
          return next();
        }

        const middleware = this.middlewares[index++];
        
        try {
          if (this.timeout) {
            const timeoutId = setTimeout(() => {
              next(new Error(`Middleware chain '${this.name}' timed out`));
            }, this.timeout);

            middleware(req, res, (err?: any) => {
              clearTimeout(timeoutId);
              executeNext(err);
            });
          } else {
            middleware(req, res, executeNext);
          }
        } catch (error) {
          if (this.stopOnError) {
            next(error);
          } else {
            executeNext();
          }
        }
      };

      executeNext();
    };
  }

  /**
   * Build parallel middleware chain (all execute simultaneously)
   */
  private buildParallel(): SecurityMiddleware {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const promises = this.middlewares.map((middleware) => {
          return new Promise<void>((resolve, reject) => {
            middleware(req, res, (err?: any) => {
              if (err && this.stopOnError) {
                reject(err);
              } else {
                resolve();
              }
            });
          });
        });

        if (this.timeout) {
          await Promise.race([
            Promise.all(promises),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Middleware chain '${this.name}' timed out`)), this.timeout)
            ),
          ]);
        } else {
          await Promise.all(promises);
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  }

  /**
   * Create a conditional chain that only executes if condition is met
   */
  static conditional(condition: (req: Request) => boolean, chain: SecurityMiddleware): SecurityMiddleware {
    return (req: Request, res: Response, next: NextFunction) => {
      if (condition(req)) {
        return chain(req, res, next);
      }
      next();
    };
  }

  /**
   * Create a rate-limited chain
   */
  static rateLimit(chain: SecurityMiddleware, options: { maxPerMinute: number }): SecurityMiddleware {
    const requests = new Map<string, number[]>();
    
    return (req: Request, res: Response, next: NextFunction) => {
      const key = req.ip || 'unknown';
      const now = Date.now();
      const windowStart = now - 60000; // 1 minute window

      const userRequests = requests.get(key) || [];
      const recentRequests = userRequests.filter((time) => time > windowStart);

      if (recentRequests.length >= options.maxPerMinute) {
        return res.status(429).json({ error: 'Too many requests' });
      }

      recentRequests.push(now);
      requests.set(key, recentRequests);

      chain(req, res, next);
    };
  }
}

/**
 * Pre-built security chain configurations
 */
export class SecurityChains {
  /**
   * Basic security chain for public endpoints
   */
  static basic(): MiddlewareChain {
    return new MiddlewareChain('basic-security')
      .configure({ stopOnError: true, parallel: false });
  }

  /**
   * Strict security chain for sensitive operations
   */
  static strict(): MiddlewareChain {
    return new MiddlewareChain('strict-security')
      .configure({ stopOnError: true, parallel: false, timeout: 5000 });
  }

  /**
   * Authentication chain
   */
  static auth(): MiddlewareChain {
    return new MiddlewareChain('auth-chain')
      .configure({ stopOnError: true, parallel: false });
  }

  /**
   * API security chain
   */
  static api(): MiddlewareChain {
    return new MiddlewareChain('api-security')
      .configure({ stopOnError: true, parallel: false });
  }

  /**
   * Admin security chain
   */
  static admin(): MiddlewareChain {
    return new MiddlewareChain('admin-security')
      .configure({ stopOnError: true, parallel: false, timeout: 3000 });
  }
}

/**
 * Example usage:
 * 
 * // Basic chain
 * const basicChain = SecurityChains.basic()
 *   .use(helmet())
 *   .use(cors())
 *   .use(rateLimit())
 *   .build();
 * 
 * // Strict chain for sensitive endpoints
 * const strictChain = SecurityChains.strict()
 *   .use(requireAuth)
 *   .use(validateCSRF)
 *   .use(checkPermissions)
 *   .use(auditLog)
 *   .build();
 * 
 * // Conditional chain
 * const conditionalChain = MiddlewareChain.conditional(
 *   (req) => req.path.startsWith('/admin'),
 *   adminSecurityChain
 * );
 * 
 * app.use('/api', basicChain);
 * app.use('/api/admin', strictChain);
 */

/**
 * Middleware composer utility
 */
export function composeMiddleware(...middlewares: SecurityMiddleware[]): SecurityMiddleware {
  return new MiddlewareChain('composed')
    .useMany(middlewares)
    .build();
}

/**
 * Create middleware groups for different security levels
 */
export function createSecurityLevels() {
  return {
    public: new MiddlewareChain('public'),
    authenticated: new MiddlewareChain('authenticated'),
    admin: new MiddlewareChain('admin'),
    superAdmin: new MiddlewareChain('super-admin'),
  };
}
