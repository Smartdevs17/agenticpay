"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = exports.validateRequest = void 0;

const zod_1 = require("zod");
const errors_js_1 = require("../types/errors.js");

function formatIssues(issues) {
  return issues.map((err) => ({
    path: err.path.join(".") || "root",
    message: err.message,
  }));
}

function isZodError(error) {
  return error instanceof zod_1.ZodError ||
    (typeof error === "object" &&
      error !== null &&
      error.name === "ZodError" &&
      Array.isArray(error.errors));
}

const validateRequest = (targets) => {
  return function validateRequestMiddleware(req, _res, next) {
    try {
      if (targets.body) req.body = targets.body.parse(req.body ?? {});
      if (targets.query) req.query = targets.query.parse(req.query ?? {});
      if (targets.params) req.params = targets.params.parse(req.params ?? {});
      next();
    } catch (error) {
      if (isZodError(error)) {
        return next(new errors_js_1.AppError(
          400,
          "Request validation failed",
          "ERR_VALIDATION_FAILED",
          formatIssues(error.errors)
        ));
      }
      next(error);
    }
  };
};

exports.validateRequest = validateRequest;
const validate = (schema) => (0, exports.validateRequest)({ body: schema });
exports.validate = validate;
exports.default = validate;
