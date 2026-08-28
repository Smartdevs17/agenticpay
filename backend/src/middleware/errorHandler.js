"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotFoundError = exports.ValidationError = exports.DisputeError = exports.ProjectError = exports.AuthError = exports.PaymentError = exports.AppError = void 0;
exports.asyncHandler = asyncHandler;
exports.notFoundHandler = notFoundHandler;
exports.errorHandler = errorHandler;
const error_codes_1 = require("@agenticpay/error-codes");
const errors_1 = require("../types/errors");
Object.defineProperty(exports, "AppError", { enumerable: true, get: function () { return errors_1.AppError; } });
Object.defineProperty(exports, "PaymentError", { enumerable: true, get: function () { return errors_1.PaymentError; } });
Object.defineProperty(exports, "AuthError", { enumerable: true, get: function () { return errors_1.AuthError; } });
Object.defineProperty(exports, "ProjectError", { enumerable: true, get: function () { return errors_1.ProjectError; } });
Object.defineProperty(exports, "DisputeError", { enumerable: true, get: function () { return errors_1.DisputeError; } });
Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function () { return errors_1.ValidationError; } });
Object.defineProperty(exports, "NotFoundError", { enumerable: true, get: function () { return errors_1.NotFoundError; } });
function asyncHandler(handler) {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}
function notFoundHandler(req, _res, next) {
    next(new errors_1.NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
}
function errorHandler(err, req, res, _next) {
    const isAppError = err instanceof errors_1.AppError;
    const statusCode = isAppError ? err.statusCode : 500;
    const code = (0, error_codes_1.resolveErrorCode)(isAppError ? err.code : undefined, statusCode);
    const registered = error_codes_1.ERROR_CODE_REGISTRY[code];
    const isProduction = process.env.NODE_ENV === 'production';
    const message = isAppError
        ? err.message
        : isProduction
            ? 'Internal server error'
            : err instanceof Error
                ? err.message
                : 'Unexpected error';
    const logMethod = registered.httpStatus >= 500 ? console.error : console.warn;
    const logContext = {
        code,
        message,
        statusCode: registered.httpStatus || statusCode,
        ...(isAppError && err.metadata ? { metadata: err.metadata } : {}),
        ...(req.requestId ? { requestId: req.requestId } : {}),
        ...(req.user?.id ? { userId: req.user.id } : {}),
        ...(!isProduction && !isAppError && err instanceof Error && err.stack ? { stack: err.stack } : {}),
    };
    logMethod(`[${code}] ${message}`, logContext);
    if (registered.deprecated && registered.sunsetAt) {
        res.setHeader('Sunset', registered.sunsetAt);
        res.setHeader('Deprecation', 'true');
    }
    res.status(registered.httpStatus || statusCode).json({
        error: {
            code,
            message,
            ...(isAppError && err.details !== undefined ? { details: err.details } : {}),
            ...(req.requestId ? { requestId: req.requestId } : {}),
            ...(!isProduction && !isAppError && err instanceof Error && err.stack
                ? { stack: err.stack }
                : {}),
        },
    });
}
