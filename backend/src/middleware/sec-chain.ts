/**
 * #730: Composable Security Middleware Chains
 * Flexible, composable middleware system for security
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';

export type Middleware = RequestHandler;

export class Chain {
  private mw: Middleware[] = [];
  private name: string;

  constructor(name: string = 'default') {
    this.name = name;
  }

  use(middleware: Middleware): this {
    this.mw.push(middleware);
    return this;
  }

  build(): Middleware {
    return (req: Request, res: Response, next: NextFunction) => {
      let i = 0;
      const exec = (err?: any): void => {
        if (err) return next(err);
        if (i >= this.mw.length) return next();
        const m = this.mw[i++];
        try {
          m(req, res, exec);
        } catch (e) {
          next(e);
        }
      };
      exec();
    };
  }

  static compose(...middlewares: Middleware[]): Middleware {
    return new Chain('composed').use(...middlewares).build();
  }
}
