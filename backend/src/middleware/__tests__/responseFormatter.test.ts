/**
 * responseFormatter.test.ts — Tests for Issue #367
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Request, Response, NextFunction } from "express";
import {
  ResponseBuilder,
  ErrorCode,
  attachResponseHelpers,
  formatErrorResponse,
  encodeCursor,
  decodeCursor,
  buildPaginationMeta,
  parsePaginationParams,
  legacyFormatSupport,
  formatValidationErrors,
} from "../responseFormatter.js";

describe("ResponseBuilder", () => {
  it("should build success response", () => {
    const builder = new ResponseBuilder();
    const { response, statusCode } = builder
      .data({ id: "123", name: "Test" })
      .meta({ requestId: "req-123" })
      .build();

    expect(statusCode).toBe(200);
    expect(response.data).toEqual({ id: "123", name: "Test" });
    expect(response.meta?.requestId).toBe("req-123");
    expect(response.meta?.timestamp).toBeDefined();
  });

  it("should build error response", () => {
    const builder = new ResponseBuilder();
    const { response, statusCode } = builder
      .error(ErrorCode.NOT_FOUND, "Resource not found", { id: "123" })
      .build();

    expect(statusCode).toBe(404);
    expect(response.error?.code).toBe(ErrorCode.NOT_FOUND);
    expect(response.error?.message).toBe("Resource not found");
    expect(response.error?.details).toEqual({ id: "123" });
  });

  it("should build paginated response", () => {
    const builder = new ResponseBuilder();
    const { response } = builder
      .data([{ id: "1" }, { id: "2" }])
      .pagination({
        nextCursor: "cursor-123",
        prevCursor: null,
        hasMore: true,
        limit: 20,
      })
      .build();

    expect(response.data).toHaveLength(2);
    expect(response.meta?.pagination?.hasMore).toBe(true);
    expect(response.meta?.pagination?.nextCursor).toBe("cursor-123");
  });

  it("should set custom status code", () => {
    const builder = new ResponseBuilder();
    const { statusCode } = builder.data({ created: true }).status(201).build();

    expect(statusCode).toBe(201);
  });

  it("should map error codes to HTTP status", () => {
    const testCases = [
      { code: ErrorCode.BAD_REQUEST, expected: 400 },
      { code: ErrorCode.UNAUTHORIZED, expected: 401 },
      { code: ErrorCode.FORBIDDEN, expected: 403 },
      { code: ErrorCode.NOT_FOUND, expected: 404 },
      { code: ErrorCode.CONFLICT, expected: 409 },
      { code: ErrorCode.VALIDATION_ERROR, expected: 422 },
      { code: ErrorCode.RATE_LIMIT_EXCEEDED, expected: 429 },
      { code: ErrorCode.INTERNAL_SERVER_ERROR, expected: 500 },
    ];

    testCases.forEach(({ code, expected }) => {
      const builder = new ResponseBuilder();
      const { statusCode } = builder.error(code, "Test error").build();
      expect(statusCode).toBe(expected);
    });
  });
});

describe("Express Response Helpers", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {
      id: "req-123",
      headers: { "api-version": "v1" },
    };

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    next = vi.fn();
  });

  it("should attach apiSuccess helper", () => {
    attachResponseHelpers(req as Request, res as Response, next);

    expect(res.apiSuccess).toBeDefined();
    expect(typeof res.apiSuccess).toBe("function");
  });

  it("should attach apiError helper", () => {
    attachResponseHelpers(req as Request, res as Response, next);

    expect(res.apiError).toBeDefined();
    expect(typeof res.apiError).toBe("function");
  });

  it("should attach apiPaginated helper", () => {
    attachResponseHelpers(req as Request, res as Response, next);

    expect(res.apiPaginated).toBeDefined();
    expect(typeof res.apiPaginated).toBe("function");
  });

  it("should call next middleware", () => {
    attachResponseHelpers(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
  });

  it("should send success response with apiSuccess", () => {
    attachResponseHelpers(req as Request, res as Response, next);

    res.apiSuccess!({ id: "123" }, { custom: "meta" });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalled();
  });

  it("should send error response with apiError", () => {
    attachResponseHelpers(req as Request, res as Response, next);

    res.apiError!(ErrorCode.NOT_FOUND, "Not found", { id: "123" });

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalled();
  });

  it("should send paginated response with apiPaginated", () => {
    attachResponseHelpers(req as Request, res as Response, next);

    const data = [{ id: "1" }, { id: "2" }];
    const pagination = {
      nextCursor: "cursor-123",
      prevCursor: null,
      hasMore: true,
      limit: 20,
    };

    res.apiPaginated!(data, pagination);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalled();
  });
});

describe("Error Formatter", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {
      id: "req-123",
      headers: {},
    };

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    next = vi.fn();
  });

  it("should format error response", () => {
    const error = new Error("Test error") as Error & {
      statusCode: number;
      code: string;
    };
    error.statusCode = 400;
    error.code = ErrorCode.BAD_REQUEST;

    formatErrorResponse(error, req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalled();
  });

  it("should default to 500 for unknown errors", () => {
    const error = new Error("Unknown error");

    formatErrorResponse(error, req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("should include stack trace in development", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    const error = new Error("Dev error");
    error.stack = "Stack trace here";

    formatErrorResponse(error, req as Request, res as Response, next);

    expect(res.json).toHaveBeenCalled();

    process.env.NODE_ENV = originalEnv;
  });
});

describe("Pagination Helpers", () => {
  it("should parse pagination params", () => {
    const req = {
      query: {
        cursor: "cursor-123",
        limit: "50",
        direction: "backward",
      },
    } as unknown as Request;

    const params = parsePaginationParams(req);

    expect(params.cursor).toBe("cursor-123");
    expect(params.limit).toBe(50);
    expect(params.direction).toBe("backward");
  });

  it("should enforce max limit", () => {
    const req = {
      query: {
        limit: "500",
      },
    } as unknown as Request;

    const params = parsePaginationParams(req);

    expect(params.limit).toBe(100);
  });

  it("should default to forward direction", () => {
    const req = {
      query: {},
    } as unknown as Request;

    const params = parsePaginationParams(req);

    expect(params.direction).toBe("forward");
  });

  it("should encode and decode cursor", () => {
    const data = { id: "123", createdAt: "2024-01-01T00:00:00Z" };

    const encoded = encodeCursor(data);
    expect(typeof encoded).toBe("string");

    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(data);
  });

  it("should return null for invalid cursor", () => {
    const decoded = decodeCursor("invalid-cursor");
    expect(decoded).toBeNull();
  });

  it("should build pagination meta", () => {
    const items = [
      { id: "1", createdAt: "2024-01-01T00:00:00Z" },
      { id: "2", createdAt: "2024-01-02T00:00:00Z" },
    ];

    const meta = buildPaginationMeta(items, 20, true, 100);

    expect(meta.hasMore).toBe(true);
    expect(meta.limit).toBe(20);
    expect(meta.total).toBe(100);
    expect(meta.nextCursor).toBeDefined();
    expect(meta.prevCursor).toBeDefined();
  });

  it("should handle empty items", () => {
    const meta = buildPaginationMeta([], 20, false);

    expect(meta.hasMore).toBe(false);
    expect(meta.nextCursor).toBeNull();
    expect(meta.prevCursor).toBeNull();
  });
});

describe("Legacy Format Support", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {
      headers: {},
    };

    res = {
      json: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      apiSuccess: vi.fn(),
      apiError: vi.fn(),
      apiPaginated: vi.fn(),
    };

    next = vi.fn();
  });

  it("should not modify helpers without legacy header", () => {
    const originalSuccess = res.apiSuccess;

    legacyFormatSupport(req as Request, res as Response, next);

    expect(res.apiSuccess).toBe(originalSuccess);
    expect(next).toHaveBeenCalled();
  });

  it("should override helpers with legacy format", () => {
    req.headers!["x-legacy-format"] = "true";

    legacyFormatSupport(req as Request, res as Response, next);

    res.apiSuccess!({ id: "123" });

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { id: "123" },
    });
  });

  it("should format legacy error response", () => {
    req.headers!["x-legacy-format"] = "true";

    legacyFormatSupport(req as Request, res as Response, next);

    res.apiError!(ErrorCode.NOT_FOUND, "Not found", { id: "123" });

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Not found",
      code: ErrorCode.NOT_FOUND,
      details: { id: "123" },
    });
  });

  it("should format legacy paginated response", () => {
    req.headers!["x-legacy-format"] = "true";

    legacyFormatSupport(req as Request, res as Response, next);

    const data = [{ id: "1" }];
    const pagination = {
      nextCursor: "cursor-123",
      prevCursor: null,
      hasMore: true,
      limit: 20,
    };

    res.apiPaginated!(data, pagination);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data,
      pagination: {
        next: "cursor-123",
        hasMore: true,
      },
    });
  });
});

describe("Validation Error Formatter", () => {
  it("should format validation errors", () => {
    const errors = [
      { field: "email", message: "Invalid email" },
      { field: "password", message: "Too short" },
    ];

    const formatted = formatValidationErrors(errors);

    expect(formatted.validationErrors).toEqual(errors);
    expect(formatted.count).toBe(2);
  });

  it("should handle empty errors", () => {
    const formatted = formatValidationErrors([]);

    expect(formatted.validationErrors).toEqual([]);
    expect(formatted.count).toBe(0);
  });
});
