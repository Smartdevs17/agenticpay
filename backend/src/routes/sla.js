"use strict";
/**
 * SLA Routes
 * API endpoints for retrieving SLA metrics, reports, and violations
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.slaRouter = void 0;
var express_1 = require("express");
var sla_js_1 = require("../services/sla.js");
var errorHandler_js_1 = require("../middleware/errorHandler.js");
exports.slaRouter = (0, express_1.Router)();
/**
 * GET /api/v1/sla/metrics/:endpoint?
 * Get SLA metrics for a specific endpoint or all endpoints
 */
exports.slaRouter.get('/metrics', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var endpoint, metrics;
    return __generator(this, function (_a) {
        endpoint = req.query.endpoint;
        metrics = sla_js_1.slaTracker.getMetrics(endpoint);
        res.json({
            data: metrics,
            timestamp: new Date(),
        });
        return [2 /*return*/];
    });
}); }));
/**
 * GET /api/v1/sla/metrics/:endpoint
 * Get SLA metrics for a specific endpoint
 */
exports.slaRouter.get('/metrics/:endpoint', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var endpoint, decodedEndpoint, metrics;
    return __generator(this, function (_a) {
        endpoint = req.params.endpoint;
        decodedEndpoint = decodeURIComponent(endpoint);
        metrics = sla_js_1.slaTracker.getMetrics(decodedEndpoint);
        if (!metrics || (typeof metrics !== 'string' && metrics.totalRequests === 0)) {
            throw new errorHandler_js_1.AppError(404, "No metrics found for endpoint: ".concat(decodedEndpoint), 'NO_METRICS_FOUND');
        }
        res.json({
            data: metrics,
            timestamp: new Date(),
        });
        return [2 /*return*/];
    });
}); }));
/**
 * GET /api/v1/sla/violations
 * Get SLA violations
 */
exports.slaRouter.get('/violations', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var endpoint, limit, violations;
    return __generator(this, function (_a) {
        endpoint = req.query.endpoint;
        limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
        violations = sla_js_1.slaTracker.getViolations(endpoint, limit);
        res.json({
            data: violations,
            count: violations.length,
            timestamp: new Date(),
        });
        return [2 /*return*/];
    });
}); }));
/**
 * GET /api/v1/sla/violations/:endpoint
 * Get SLA violations for a specific endpoint
 */
exports.slaRouter.get('/violations/:endpoint', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var endpoint, decodedEndpoint, limit, violations;
    return __generator(this, function (_a) {
        endpoint = req.params.endpoint;
        decodedEndpoint = decodeURIComponent(endpoint);
        limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
        violations = sla_js_1.slaTracker.getViolations(decodedEndpoint, limit);
        res.json({
            data: violations,
            count: violations.length,
            timestamp: new Date(),
        });
        return [2 /*return*/];
    });
}); }));
/**
 * GET /api/v1/sla/report
 * Generate comprehensive SLA report
 */
exports.slaRouter.get('/report', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var endpoint, report;
    return __generator(this, function (_a) {
        endpoint = req.query.endpoint;
        report = sla_js_1.slaTracker.generateReport(endpoint);
        res.json({
            report: report,
            timestamp: new Date(),
        });
        return [2 /*return*/];
    });
}); }));
/**
 * GET /api/v1/sla/config
 * Get current SLA configuration
 */
exports.slaRouter.get('/config', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var config;
    return __generator(this, function (_a) {
        config = sla_js_1.slaTracker.getConfig();
        res.json({
            config: config,
            timestamp: new Date(),
        });
        return [2 /*return*/];
    });
}); }));
/**
 * POST /api/v1/sla/config
 * Update SLA configuration
 */
exports.slaRouter.post('/config', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, maxResponseTimeMs, maxErrorRatePercent, minUptimePercent, aggregationIntervalMs, update;
    return __generator(this, function (_b) {
        _a = req.body, maxResponseTimeMs = _a.maxResponseTimeMs, maxErrorRatePercent = _a.maxErrorRatePercent, minUptimePercent = _a.minUptimePercent, aggregationIntervalMs = _a.aggregationIntervalMs;
        update = {};
        if (maxResponseTimeMs !== undefined)
            update.maxResponseTimeMs = maxResponseTimeMs;
        if (maxErrorRatePercent !== undefined)
            update.maxErrorRatePercent = maxErrorRatePercent;
        if (minUptimePercent !== undefined)
            update.minUptimePercent = minUptimePercent;
        if (aggregationIntervalMs !== undefined)
            update.aggregationIntervalMs = aggregationIntervalMs;
        if (Object.keys(update).length === 0) {
            throw new errorHandler_js_1.AppError(400, 'At least one configuration parameter must be provided', 'INVALID_REQUEST');
        }
        sla_js_1.slaTracker.updateConfig(update);
        res.json({
            config: sla_js_1.slaTracker.getConfig(),
            message: 'SLA configuration updated',
            timestamp: new Date(),
        });
        return [2 /*return*/];
    });
}); }));
/**
 * DELETE /api/v1/sla/metrics/:endpoint?
 * Clear metrics for a specific endpoint or all endpoints
 */
exports.slaRouter.delete('/metrics', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var endpoint, decodedEndpoint;
    return __generator(this, function (_a) {
        endpoint = req.query.endpoint;
        decodedEndpoint = endpoint ? decodeURIComponent(endpoint) : undefined;
        sla_js_1.slaTracker.reset(decodedEndpoint);
        res.json({
            message: decodedEndpoint ? "Metrics cleared for ".concat(decodedEndpoint) : 'All metrics cleared',
            timestamp: new Date(),
        });
        return [2 /*return*/];
    });
}); }));
