import type { Request, Response, NextFunction, RequestHandler } from 'express';

export type MiddlewareFunction = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;

export interface MiddlewareChain {
  use: (...fns: MiddlewareFunction[]) => MiddlewareChain;
  execute: (req: Request, res: Response, next: NextFunction) => void;
}

export function composeMiddleware(...middleware: MiddlewareFunction[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    let index = 0;

    const dispatch = (err?: unknown): void => {
      if (err) {
        next(err);
        return;
      }

      if (index >= middleware.length) {
        next();
        return;
      }

      const fn = middleware[index++];

      try {
        const result = fn(req, res, dispatch);
        if (result instanceof Promise) {
          result.catch(dispatch);
        }
      } catch (error) {
        dispatch(error);
      }
    };

    dispatch();
  };
}

export function createMiddlewareChain(): MiddlewareChain {
  const stack: MiddlewareFunction[] = [];

  return {
    use: (...fns: MiddlewareFunction[]) => {
      stack.push(...fns);
      return createMiddlewareChainFromStack(stack);
    },
    execute: (req: Request, res: Response, next: NextFunction) => {
      composeMiddleware(...stack)(req, res, next);
    },
  };
}

function createMiddlewareChainFromStack(stack: MiddlewareFunction[]): MiddlewareChain {
  return {
    use: (...fns: MiddlewareFunction[]) => {
      stack.push(...fns);
      return createMiddlewareChainFromStack(stack);
    },
    execute: (req: Request, res: Response, next: NextFunction) => {
      composeMiddleware(...stack)(req, res, next);
    },
  };
}
