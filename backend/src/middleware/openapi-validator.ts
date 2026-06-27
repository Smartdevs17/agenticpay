import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { API_OPERATIONS, type ApiOperationSchema, pathToRegex } from '@agenticpay/api-spec';
import { ZodError, type ZodTypeAny } from 'zod';
import { AppError } from './errorHandler.js';

const operations = API_OPERATIONS.map((operation) => ({
  operation,
  matcher: pathToRegex(operation.path),
}));

function findOperation(req: Request): { operation: ApiOperationSchema; params: Record<string, string> } | undefined {
  const path = req.originalUrl.split('?')[0];
  for (const { operation, matcher } of operations) {
    if (operation.method !== req.method) return false;
    const match = matcher.regex.exec(path);
    if (!match) continue;
    const params = Object.fromEntries(matcher.params.map((param, index) => [param, decodeURIComponent(match[index + 1] ?? '')]));
    return { operation, params };
  }
  return undefined;
}

function parseTarget(schema: ZodTypeAny | undefined, value: unknown, target: string) {
  if (!schema) return value;
  try {
    return schema.parse(value ?? {});
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AppError(400, 'Request validation failed', 'ERR_VALIDATION_FAILED', {
        target,
        issues: error.errors.map((issue) => ({
          path: issue.path.join('.') || 'root',
          message: issue.message,
        })),
      });
    }
    throw error;
  }
}

function validateResponse(operation: ApiOperationSchema, status: number, body: unknown): void {
  const schema = operation.responses[status] ?? operation.responses[Math.floor(status / 100) * 100];
  if (!schema) return;
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(500, 'Response schema validation failed', 'ERR_INTERNAL', {
      operationId: operation.operationId,
      status,
      issues: result.error.errors.map((issue) => ({
        path: issue.path.join('.') || 'root',
        message: issue.message,
      })),
    });
  }
}

export function openApiValidator(options: { validateResponses?: boolean } = {}): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const match = findOperation(req);
    if (!match) return next();
    const { operation } = match;

    try {
      req.body = parseTarget(operation.request?.body, req.body, 'body');
      req.query = parseTarget(operation.request?.query, req.query, 'query') as typeof req.query;
      req.params = parseTarget(operation.request?.params, { ...req.params, ...match.params }, 'params') as typeof req.params;

      if (operation.deprecated && operation.sunset) {
        res.setHeader('Sunset', operation.sunset);
        res.setHeader('Deprecation', 'true');
      }

      if (options.validateResponses) {
        const originalJson = res.json.bind(res);
        res.json = ((body: unknown) => {
          validateResponse(operation, res.statusCode, body);
          return originalJson(body);
        }) as typeof res.json;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

export function validateResponseAgainstOpenAPI(operationId: string, status: number, body: unknown): void {
  const operation = API_OPERATIONS.find((item) => item.operationId === operationId);
  if (!operation) throw new Error(`Unknown OpenAPI operation: ${operationId}`);
  validateResponse(operation, status, body);
}
