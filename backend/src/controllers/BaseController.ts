/**
 * BaseController.ts — Issue #366
 *
 * Base controller class that handles HTTP concerns only
 * Controllers should not contain business logic
 */

import { Request, Response, NextFunction } from "express";
import { ErrorCode } from "../middleware/responseFormatter.js";

export abstract class BaseController {
  /**
   * Execute controller action with error handling
   */
  protected async execute(
    req: Request,
    res: Response,
    next: NextFunction,
    action: (req: Request, res: Response) => Promise<void>,
  ): Promise<void> {
    try {
      await action(req, res);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Extract pagination params from request
   */
  protected getPaginationParams(req: Request): {
    cursor?: string;
    limit: number;
  } {
    return {
      cursor: req.query.cursor as string | undefined,
      limit: Math.min(parseInt(req.query.limit as string) || 20, 100),
    };
  }

  /**
   * Extract user from request
   */
  protected getUser(req: Request): {
    id: string;
    tenantId: string;
    role: string;
  } {
    const user = (
      req as Request & { user?: { id: string; tenantId: string; role: string } }
    ).user;
    if (!user) {
      throw new Error("User not authenticated");
    }
    return user;
  }

  /**
   * Validate required fields
   */
  protected validateRequired(
    data: Record<string, unknown>,
    fields: string[],
  ): void {
    const missing = fields.filter((field) => !data[field]);
    if (missing.length > 0) {
      const error = new Error(
        `Missing required fields: ${missing.join(", ")}`,
      ) as Error & {
        statusCode: number;
        code: string;
        details: Record<string, unknown>;
      };
      error.statusCode = 400;
      error.code = ErrorCode.VALIDATION_ERROR;
      error.details = { missingFields: missing };
      throw error;
    }
  }
}
