"use strict";
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
exports.healthRouter = void 0;
var express_1 = require("express");
var stellar_js_1 = require("../services/stellar.js");
var index_js_1 = require("../jobs/index.js");
exports.healthRouter = (0, express_1.Router)();
var horizonHealthServer = stellar_js_1.server;
/**
 * @openapi
 * /health:
 *   get:
 *     summary: Get service health status
 *     responses:
 *       200:
 *         description: Service is healthy or degraded
 *       503:
 *         description: Service is unhealthy
 */
exports.healthRouter.get('/health', function (_req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var start, checks, stellarCheck, _a, error_1, dependencies, isUnhealthy, isDegraded, overallStatus;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                start = Date.now();
                checks = {
                    stellar: false,
                    openai: false,
                    scheduler: false,
                };
                _b.label = 1;
            case 1:
                _b.trys.push([1, 3, , 4]);
                stellarCheck = horizonHealthServer
                    .root()
                    .then(function () { return true; })
                    .catch(function (err) {
                    var message = err instanceof Error ? err.message : String(err);
                    console.warn('Stellar health check failed:', message);
                    return false;
                });
                // 2. OpenAI Configuration Check
                checks.openai = !!process.env.OPENAI_API_KEY;
                // 3. Scheduler Initialization Check
                checks.scheduler = !!(0, index_js_1.getJobScheduler)();
                // Race Stellar check against a 800ms timeout to keep health check fast
                _a = checks;
                return [4 /*yield*/, Promise.race([
                        stellarCheck,
                        new Promise(function (resolve) { return setTimeout(function () { return resolve(false); }, 800); })
                    ])];
            case 2:
                // Race Stellar check against a 800ms timeout to keep health check fast
                _a.stellar = (_b.sent());
                return [3 /*break*/, 4];
            case 3:
                error_1 = _b.sent();
                console.error('Unexpected error during health check:', error_1);
                return [3 /*break*/, 4];
            case 4:
                dependencies = {
                    stellar: checks.stellar ? 'healthy' : 'unhealthy',
                    openai: checks.openai ? 'healthy' : 'unhealthy',
                    scheduler: checks.scheduler ? 'healthy' : 'unhealthy',
                };
                isUnhealthy = dependencies.stellar === 'unhealthy' || dependencies.scheduler === 'unhealthy';
                isDegraded = dependencies.openai === 'unhealthy';
                overallStatus = 'healthy';
                if (isUnhealthy) {
                    overallStatus = 'unhealthy';
                }
                else if (isDegraded) {
                    overallStatus = 'degraded';
                }
                res.status(overallStatus === 'unhealthy' ? 503 : 200).json({
                    status: overallStatus,
                    service: 'agenticpay-backend',
                    timestamp: new Date().toISOString(),
                    uptime: process.uptime(),
                    dependencies: dependencies,
                    latency_ms: Date.now() - start
                });
                return [2 /*return*/];
        }
    });
}); });
/**
 * @openapi
 * /ready:
 *   get:
 *     summary: Kubernetes readiness probe
 *     responses:
 *       200:
 *         description: Service is ready
 */
exports.healthRouter.get('/ready', function (_req, res) {
    // Application is ready if the router is mounted and responding
    res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString()
    });
});
