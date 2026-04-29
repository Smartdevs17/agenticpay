"use strict";
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deprecationMiddleware = void 0;
/**
 * Middleware to add deprecation headers to a response.
 * Follows the draft-ietf-httpapi-deprecation-header and draft-ietf-httpapi-sunset-header.
 *
 * @param options DeprecationOptions
 * @returns Express Middleware
 */
var deprecationMiddleware = function (options) {
    return function (req, res, next) {
        // 1. Add Deprecation header
        // The Deprecation header indicates that the resource is deprecated.
        // It can also include the date when the deprecation started.
        res.setHeader('Deprecation', new Date(options.deprecationDate).toUTCString());
        // 2. Add Sunset header (if provided)
        // The Sunset header indicates when the resource will become unavailable.
        if (options.sunsetDate) {
            res.setHeader('Sunset', new Date(options.sunsetDate).toUTCString());
        }
        // 3. Include alternative info (Link header)
        // The Link header with rel="successor-version" can point to a newer version.
        if (options.alternativeUrl) {
            // If there are existing Link headers, we should append to them.
            var existingLink = res.getHeader('Link');
            var newLink = "<".concat(options.alternativeUrl, ">; rel=\"successor-version\"");
            if (existingLink) {
                if (Array.isArray(existingLink)) {
                    res.setHeader('Link', __spreadArray(__spreadArray([], existingLink, true), [newLink], false));
                }
                else {
                    res.setHeader('Link', ["".concat(existingLink), newLink]);
                }
            }
            else {
                res.setHeader('Link', newLink);
            }
        }
        // 4. Log deprecation
        // This helps server operators identify usage of deprecated endpoints.
        console.warn("[DEPRECATION WARNING] Client ".concat(req.ip, " accessed deprecated endpoint ").concat(req.method, " ").concat(req.originalUrl, ". Deprecated since: ").concat(options.deprecationDate, "."));
        next();
    };
};
exports.deprecationMiddleware = deprecationMiddleware;
