"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
exports.asyncHandler = asyncHandler;
exports.notFoundHandler = notFoundHandler;
exports.errorHandler = errorHandler;
var AppError = /** @class */ (function (_super) {
    __extends(AppError, _super);
    function AppError(statusCode, message, code, details) {
        if (code === void 0) { code = 'INTERNAL_SERVER_ERROR'; }
        var _this = _super.call(this, message) || this;
        _this.name = 'AppError';
        _this.statusCode = statusCode;
        _this.code = code;
        _this.details = details;
        return _this;
    }
    return AppError;
}(Error));
exports.AppError = AppError;
function asyncHandler(handler) {
    return function (req, res, next) {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}
function notFoundHandler(req, _res, next) {
    next(new AppError(404, "Route not found: ".concat(req.method, " ").concat(req.originalUrl), 'NOT_FOUND'));
}
function errorHandler(err, _req, res, _next) {
    var isAppError = err instanceof AppError;
    var statusCode = isAppError ? err.statusCode : 500;
    var code = isAppError ? err.code : 'INTERNAL_SERVER_ERROR';
    var isProduction = process.env.NODE_ENV === 'production';
    var message = isAppError
        ? err.message
        : isProduction
            ? 'Internal server error'
            : err instanceof Error
                ? err.message
                : 'Unexpected error';
    var logMethod = statusCode >= 500 ? console.error : console.warn;
    logMethod("[".concat(code, "] ").concat(message), err);
    res.status(statusCode).json({
        error: __assign(__assign({ code: code, message: message, status: statusCode }, (isAppError && err.details !== undefined ? { details: err.details } : {})), (!isProduction && !isAppError && err instanceof Error && err.stack
            ? { stack: err.stack }
            : {})),
    });
}
