"use strict";
/**
 * Queue Routes
 * API endpoints for managing message queue and monitoring jobs
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
exports.queueRouter = void 0;
var express_1 = require("express");
var queue_js_1 = require("../services/queue.js");
var queue_producers_js_1 = require("../services/queue-producers.js");
var errorHandler_js_1 = require("../middleware/errorHandler.js");
exports.queueRouter = (0, express_1.Router)();
var allowedStatuses = ['pending', 'processing', 'completed', 'failed', 'retrying'];
function getParamAsString(param) {
    return Array.isArray(param) ? param[0] : param;
}
/**
 * POST /api/v1/queue/email
 * Queue an email to be sent asynchronously
 */
exports.queueRouter.post('/email', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, to, subject, body, html, from, job;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _a = req.body, to = _a.to, subject = _a.subject, body = _a.body, html = _a.html, from = _a.from;
                if (!to || !subject || !body) {
                    throw new errorHandler_js_1.AppError(400, 'Missing required fields: to, subject, body', 'INVALID_REQUEST');
                }
                return [4 /*yield*/, (0, queue_producers_js_1.queueEmail)({ to: to, subject: subject, body: body, html: html, from: from })];
            case 1:
                job = _b.sent();
                res.status(202).json({
                    message: 'Email queued for delivery',
                    jobId: job.id,
                    status: job.status,
                    queue: job.queue,
                });
                return [2 /*return*/];
        }
    });
}); }));
/**
 * POST /api/v1/queue/notification
 * Queue a notification to be delivered asynchronously
 */
exports.queueRouter.post('/notification', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, userId, type, title, message, metadata, job;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _a = req.body, userId = _a.userId, type = _a.type, title = _a.title, message = _a.message, metadata = _a.metadata;
                if (!userId || !type || !title || !message) {
                    throw new errorHandler_js_1.AppError(400, 'Missing required fields: userId, type, title, message', 'INVALID_REQUEST');
                }
                return [4 /*yield*/, (0, queue_producers_js_1.queueNotification)({ userId: userId, type: type, title: title, message: message, metadata: metadata })];
            case 1:
                job = _b.sent();
                res.status(202).json({
                    message: 'Notification queued for delivery',
                    jobId: job.id,
                    status: job.status,
                    queue: job.queue,
                });
                return [2 /*return*/];
        }
    });
}); }));
/**
 * POST /api/v1/queue/webhook
 * Queue a webhook call to be delivered asynchronously
 */
exports.queueRouter.post('/webhook', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, url, _b, method, headers, body, timeout, job;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                _a = req.body, url = _a.url, _b = _a.method, method = _b === void 0 ? 'POST' : _b, headers = _a.headers, body = _a.body, timeout = _a.timeout;
                if (!url) {
                    throw new errorHandler_js_1.AppError(400, 'Missing required field: url', 'INVALID_REQUEST');
                }
                return [4 /*yield*/, (0, queue_producers_js_1.queueWebhook)({ url: url, method: method, headers: headers, body: body, timeout: timeout })];
            case 1:
                job = _c.sent();
                res.status(202).json({
                    message: 'Webhook queued for delivery',
                    jobId: job.id,
                    status: job.status,
                    queue: job.queue,
                });
                return [2 /*return*/];
        }
    });
}); }));
/**
 * GET /api/v1/queue/jobs
 * Get all queued jobs or filter by queue/status
 */
exports.queueRouter.get('/jobs', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var queue, status, jobs;
    return __generator(this, function (_a) {
        queue = req.query.queue;
        status = req.query.status;
        jobs = queue_js_1.messageQueue.getAllJobs();
        if (queue) {
            jobs = queue_js_1.messageQueue.getJobsByQueue(queue);
        }
        else if (status) {
            if (!allowedStatuses.includes(status)) {
                throw new errorHandler_js_1.AppError(400, "Invalid status: ".concat(status), 'INVALID_REQUEST');
            }
            jobs = queue_js_1.messageQueue.getJobsByStatus(status);
        }
        res.json({
            data: jobs,
            count: jobs.length,
            timestamp: new Date(),
        });
        return [2 /*return*/];
    });
}); }));
/**
 * GET /api/v1/queue/jobs/:jobId
 * Get a specific job by ID
 */
exports.queueRouter.get('/jobs/:jobId', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var jobId, job;
    return __generator(this, function (_a) {
        jobId = getParamAsString(req.params.jobId);
        job = queue_js_1.messageQueue.getJob(jobId);
        if (!job) {
            throw new errorHandler_js_1.AppError(404, "Job not found: ".concat(jobId), 'JOB_NOT_FOUND');
        }
        res.json({
            data: job,
            timestamp: new Date(),
        });
        return [2 /*return*/];
    });
}); }));
/**
 * POST /api/v1/queue/jobs/:jobId/retry
 * Retry a failed job
 */
exports.queueRouter.post('/jobs/:jobId/retry', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var jobId, retried;
    return __generator(this, function (_a) {
        jobId = getParamAsString(req.params.jobId);
        retried = queue_js_1.messageQueue.retryJob(jobId);
        if (!retried) {
            throw new errorHandler_js_1.AppError(400, 'Job cannot be retried', 'INVALID_STATE');
        }
        res.json({
            message: 'Job scheduled for retry',
            jobId: jobId,
            timestamp: new Date(),
        });
        return [2 /*return*/];
    });
}); }));
/**
 * DELETE /api/v1/queue/jobs/:jobId
 * Delete a job
 */
exports.queueRouter.delete('/jobs/:jobId', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var jobId, deleted;
    return __generator(this, function (_a) {
        jobId = getParamAsString(req.params.jobId);
        deleted = queue_js_1.messageQueue.deleteJob(jobId);
        if (!deleted) {
            throw new errorHandler_js_1.AppError(404, "Job not found: ".concat(jobId), 'JOB_NOT_FOUND');
        }
        res.json({
            message: 'Job deleted',
            jobId: jobId,
            timestamp: new Date(),
        });
        return [2 /*return*/];
    });
}); }));
/**
 * GET /api/v1/queue/stats
 * Get queue statistics
 */
exports.queueRouter.get('/stats', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var stats;
    return __generator(this, function (_a) {
        stats = queue_js_1.messageQueue.getStats();
        res.json({
            data: stats,
            timestamp: new Date(),
        });
        return [2 /*return*/];
    });
}); }));
/**
 * DELETE /api/v1/queue/clear
 * Clear jobs by status
 */
exports.queueRouter.delete('/clear', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var status, cleared;
    return __generator(this, function (_a) {
        status = req.query.status;
        if (!status) {
            throw new errorHandler_js_1.AppError(400, 'Status query parameter is required', 'INVALID_REQUEST');
        }
        if (!allowedStatuses.includes(status)) {
            throw new errorHandler_js_1.AppError(400, "Invalid status: ".concat(status), 'INVALID_REQUEST');
        }
        cleared = queue_js_1.messageQueue.clearByStatus(status);
        res.json({
            message: "Cleared ".concat(cleared, " jobs with status: ").concat(status),
            cleared: cleared,
            timestamp: new Date(),
        });
        return [2 /*return*/];
    });
}); }));
