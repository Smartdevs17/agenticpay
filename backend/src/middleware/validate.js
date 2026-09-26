"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = void 0;
var zod_1 = require("zod");
/**
 * Reusable middleware to validate the request body against a Zod schema.
 * Returns a 400 Bad Request with detailed errors if validation fails.
 */
var validate = function (schema) {
    return function validateMiddleware(req, res, next) {
        try {
            schema.parse(req.body);
            next();
        }
        catch (error) {
            if (error instanceof zod_1.ZodError) {
                return res.status(400).json({
                    message: 'Validation failed',
                    errors: error.errors.map(function (err) { return ({
                        path: err.path.join('.'),
                        message: err.message,
                    }); }),
                });
            }
            next(error);
        }
    };
};
exports.validate = validate;
