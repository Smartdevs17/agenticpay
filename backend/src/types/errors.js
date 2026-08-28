"use strict";
/**
 * types/errors.ts — Issue #719
 *
 * Structured error types with error codes. `AppError` is the single base
 * every domain error extends, so `err instanceof AppError` — the check
 * `middleware/errorHandler.ts` uses to decide whether to trust an error's
 * statusCode/code/details or fall back to a generic 500 — recognizes all of
 * them uniformly. Before this change each domain error (PaymentError,
 * AuthError, ProjectError, DisputeError, NotFoundError, ValidationError)
 * extended `Error` directly, so throwing one anywhere in the app would have
 * been silently downgraded to an opaque 500 response by the central error
 * handler, discarding its statusCode/code/details.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValidationError = exports.NotFoundError = exports.DisputeError = exports.ProjectError = exports.AuthError = exports.PaymentError = exports.AppError = void 0;
class AppError extends Error {
    constructor(statusCode, message, code = 'INTERNAL_SERVER_ERROR', details, metadata) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.metadata = metadata;
    }
}
exports.AppError = AppError;
class PaymentError extends AppError {
    constructor(message, code = 'PAYMENT_ERROR', statusCode = 400, metadata) {
        super(statusCode, message, code, undefined, metadata);
        this.name = 'PaymentError';
    }
}
exports.PaymentError = PaymentError;
class AuthError extends AppError {
    constructor(message, code = 'AUTH_ERROR', statusCode = 401, metadata) {
        super(statusCode, message, code, undefined, metadata);
        this.name = 'AuthError';
    }
}
exports.AuthError = AuthError;
class ProjectError extends AppError {
    constructor(message, code = 'PROJECT_ERROR', statusCode = 400, metadata) {
        super(statusCode, message, code, undefined, metadata);
        this.name = 'ProjectError';
    }
}
exports.ProjectError = ProjectError;
class DisputeError extends AppError {
    constructor(message, code = 'DISPUTE_ERROR', statusCode = 400, metadata) {
        super(statusCode, message, code, undefined, metadata);
        this.name = 'DisputeError';
    }
}
exports.DisputeError = DisputeError;
class NotFoundError extends AppError {
    constructor(message, code = 'NOT_FOUND', statusCode = 404, metadata) {
        super(statusCode, message, code, undefined, metadata);
        this.name = 'NotFoundError';
    }
}
exports.NotFoundError = NotFoundError;
class ValidationError extends AppError {
    constructor(message, code = 'VALIDATION_ERROR', statusCode = 422, metadata) {
        super(statusCode, message, code, undefined, metadata);
        this.name = 'ValidationError';
    }
}
exports.ValidationError = ValidationError;
