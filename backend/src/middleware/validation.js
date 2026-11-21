"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.validateBody = exports.validateRequest = exports.validateAndSanitize = exports.commonSchemas = void 0;

const zod_1 = require("zod");
const errors_js_1 = require("../types/errors.js");
const sanitize_js_1 = require("./sanitize.js");

exports.commonSchemas = {
  uuid: zod_1.z.string().uuid(),
  id: zod_1.z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/),
  email: zod_1.z.string().trim().email().max(255).transform((value) => value.toLowerCase()),
  pagination: zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).max(1000).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(20),
  }),
  stellarAddress: zod_1.z.string().regex(/^G[A-Z0-9]{55}$/, "Invalid Stellar address format"),
  amount: zod_1.z.coerce.number().positive().finite().max(1_000_000_000),
};

function sanitizeValue(value, options) {
  return sanitize_js_1.InputSanitizer.getInstance().sanitize(value, {
    sqlEscape: false,
    htmlSanitization: false,
    escapeHtml: false,
    ...options,
  });
}

function parseSchema(schema, value, stripUnknown) {
  if (stripUnknown && schema instanceof zod_1.z.ZodObject) {
    return schema.strip().parse(value ?? {});
  }
  return schema.parse(value ?? {});
}

function formatZodError(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "root",
    message: issue.message,
    code: issue.code,
  }));
}

function isZodError(error) {
  return error instanceof zod_1.ZodError ||
    (typeof error === "object" &&
      error !== null &&
      error.name === "ZodError" &&
      Array.isArray(error.errors));
}

function validateAndSanitize(schemas, options = {}) {
  return function validationMiddleware(req, _res, next) {
    try {
      const shouldSanitize = options.sanitize ?? true;

      if (schemas.body) {
        const value = shouldSanitize ? sanitizeValue(req.body ?? {}, options.sanitizer) : req.body;
        req.body = parseSchema(schemas.body, value, options.stripUnknown);
      }

      if (schemas.query) {
        const value = shouldSanitize ? sanitizeValue(req.query ?? {}, options.sanitizer) : req.query;
        req.query = parseSchema(schemas.query, value, options.stripUnknown);
      }

      if (schemas.params) {
        const value = shouldSanitize ? sanitizeValue(req.params ?? {}, options.sanitizer) : req.params;
        req.params = parseSchema(schemas.params, value, options.stripUnknown);
      }

      if (schemas.headers) {
        const headers = Object.fromEntries(
          Object.entries(req.headers).map(([key, value]) => [key.toLowerCase(), value])
        );
        parseSchema(schemas.headers, headers, options.stripUnknown);
      }

      next();
    } catch (error) {
      if (isZodError(error)) {
        return next(new errors_js_1.AppError(
          400,
          "Request validation failed",
          "ERR_VALIDATION_FAILED",
          formatZodError(error)
        ));
      }

      next(error);
    }
  };
}

exports.validateAndSanitize = validateAndSanitize;
exports.validateRequest = validateAndSanitize;
const validateBody = (schema, options) => validateAndSanitize({ body: schema }, options);
exports.validateBody = validateBody;
exports.default = validateAndSanitize;
