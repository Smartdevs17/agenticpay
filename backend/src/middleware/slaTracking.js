"use strict";
/**
 * SLA Tracking Middleware
 * Instruments all requests to track response times and status codes for SLA monitoring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.slaTrackingMiddleware = slaTrackingMiddleware;
var sla_js_1 = require("../services/sla.js");
/**
 * Middleware to track SLA metrics for each request
 */
function slaTrackingMiddleware(req, res, next) {
    var startTime = Date.now();
    var endpoint = "".concat(req.method, " ").concat(req.baseUrl).concat(req.path);
    // Hook into the response finish event
    res.on('finish', function () {
        var responseTimeMs = Date.now() - startTime;
        var statusCode = res.statusCode;
        // Track the request
        sla_js_1.slaTracker.trackRequest(endpoint, responseTimeMs, statusCode, new Date());
    });
    next();
}
