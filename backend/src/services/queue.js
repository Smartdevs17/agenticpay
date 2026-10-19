"use strict";
/**
 * Message Queue Service
 * Manages async task processing with retry logic and state management
 */
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
exports.messageQueue = void 0;
var DEFAULT_CONFIG = {
    maxAttempts: 3,
    retryDelayMs: 1000, // 1 second
    retryBackoffMultiplier: 2, // exponential backoff
    maxRetryDelayMs: 60 * 1000, // 1 minute max
    pollIntervalMs: 1000, // 1 second
    batchSize: 10,
};
/**
 * In-memory message queue implementation
 * Suitable for single-instance deployments; use Redis for distributed systems
 */
var MessageQueue = /** @class */ (function () {
    function MessageQueue(config) {
        if (config === void 0) { config = {}; }
        this.jobs = new Map();
        this.processors = new Map();
        this.isRunning = false;
        this.config = __assign(__assign({}, DEFAULT_CONFIG), config);
    }
    /**
     * Register a job processor for a queue
     */
    MessageQueue.prototype.registerProcessor = function (queue, processor) {
        this.processors.set(queue, processor);
    };
    /**
     * Queue a new job
     */
    MessageQueue.prototype.enqueue = function (queue, data, maxAttempts) {
        return __awaiter(this, void 0, void 0, function () {
            var job;
            return __generator(this, function (_a) {
                job = {
                    id: this.generateJobId(),
                    queue: queue,
                    data: data,
                    status: 'pending',
                    attempts: 0,
                    maxAttempts: maxAttempts || this.config.maxAttempts,
                    createdAt: new Date(),
                };
                this.jobs.set(job.id, job);
                console.log("Job enqueued: ".concat(JSON.stringify(job)));
                return [2 /*return*/, job];
            });
        });
    };
    /**
     * Get a job by ID
     */
    MessageQueue.prototype.getJob = function (jobId) {
        return this.jobs.get(jobId);
    };
    /**
     * Get all jobs
     */
    MessageQueue.prototype.getAllJobs = function () {
        return Array.from(this.jobs.values());
    };
    /**
     * Get jobs by queue
     */
    MessageQueue.prototype.getJobsByQueue = function (queue) {
        return Array.from(this.jobs.values()).filter(function (job) { return job.queue === queue; });
    };
    /**
     * Get jobs by status
     */
    MessageQueue.prototype.getJobsByStatus = function (status) {
        return Array.from(this.jobs.values()).filter(function (job) { return job.status === status; });
    };
    /**
     * Start processing jobs
     */
    MessageQueue.prototype.start = function () {
        var _this = this;
        if (this.isRunning) {
            console.warn('Queue processor already running');
            return;
        }
        this.isRunning = true;
        console.log('Message queue processor started');
        this.processingInterval = setInterval(function () {
            _this.processJobs();
        }, this.config.pollIntervalMs);
    };
    /**
     * Stop processing jobs
     */
    MessageQueue.prototype.stop = function () {
        if (!this.isRunning) {
            return;
        }
        this.isRunning = false;
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
        }
        console.log('Message queue processor stopped');
    };
    /**
     * Process pending and retryable jobs
     */
    MessageQueue.prototype.processJobs = function () {
        return __awaiter(this, void 0, void 0, function () {
            var now_1, jobsToProcess, _i, jobsToProcess_1, job, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.isRunning) {
                            return [2 /*return*/];
                        }
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 6, , 7]);
                        now_1 = new Date();
                        jobsToProcess = Array.from(this.jobs.values())
                            .filter(function (job) {
                            return (job.status === 'pending' ||
                                (job.status === 'retrying' && job.nextRetryAt && job.nextRetryAt <= now_1)) &&
                                job.attempts < job.maxAttempts;
                        })
                            .slice(0, this.config.batchSize);
                        _i = 0, jobsToProcess_1 = jobsToProcess;
                        _a.label = 2;
                    case 2:
                        if (!(_i < jobsToProcess_1.length)) return [3 /*break*/, 5];
                        job = jobsToProcess_1[_i];
                        return [4 /*yield*/, this.processJob(job)];
                    case 3:
                        _a.sent();
                        _a.label = 4;
                    case 4:
                        _i++;
                        return [3 /*break*/, 2];
                    case 5: return [3 /*break*/, 7];
                    case 6:
                        error_1 = _a.sent();
                        console.error('Error in job processing loop:', error_1);
                        return [3 /*break*/, 7];
                    case 7: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Process a single job
     */
    MessageQueue.prototype.processJob = function (job) {
        return __awaiter(this, void 0, void 0, function () {
            var processor, error_2, delayMs;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        processor = this.processors.get(job.queue);
                        if (!processor) {
                            console.warn("No processor registered for queue: ".concat(job.queue));
                            job.status = 'failed';
                            job.lastError = "No processor found for queue: ".concat(job.queue);
                            return [2 /*return*/];
                        }
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        job.status = 'processing';
                        job.attempts += 1;
                        return [4 /*yield*/, processor(job)];
                    case 2:
                        _a.sent();
                        job.status = 'completed';
                        job.completedAt = new Date();
                        job.processedAt = new Date();
                        console.log("Job completed: ".concat(job.id));
                        return [3 /*break*/, 4];
                    case 3:
                        error_2 = _a.sent();
                        job.lastError = error_2 instanceof Error ? error_2.message : String(error_2);
                        job.processedAt = new Date();
                        if (job.attempts < job.maxAttempts) {
                            delayMs = Math.min(this.config.retryDelayMs * Math.pow(this.config.retryBackoffMultiplier, job.attempts - 1), this.config.maxRetryDelayMs);
                            job.status = 'retrying';
                            job.nextRetryAt = new Date(Date.now() + delayMs);
                            console.log("Job scheduled for retry: ".concat(job.id, " in ").concat(delayMs, "ms"));
                        }
                        else {
                            // Max retries exceeded
                            job.status = 'failed';
                            console.error("Job failed after ".concat(job.attempts, " attempts: ").concat(job.id), job.lastError);
                        }
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Retry a failed job
     */
    MessageQueue.prototype.retryJob = function (jobId) {
        var job = this.jobs.get(jobId);
        if (!job) {
            return false;
        }
        if (job.status !== 'failed') {
            return false;
        }
        job.status = 'pending';
        job.attempts = 0;
        job.nextRetryAt = undefined;
        return true;
    };
    /**
     * Delete a job
     */
    MessageQueue.prototype.deleteJob = function (jobId) {
        return this.jobs.delete(jobId);
    };
    /**
     * Clear jobs by status
     */
    MessageQueue.prototype.clearByStatus = function (status) {
        var count = 0;
        for (var _i = 0, _a = this.jobs.entries(); _i < _a.length; _i++) {
            var _b = _a[_i], jobId = _b[0], job = _b[1];
            if (job.status === status) {
                this.jobs.delete(jobId);
                count++;
            }
        }
        return count;
    };
    /**
     * Get queue statistics
     */
    MessageQueue.prototype.getStats = function () {
        var jobs = Array.from(this.jobs.values());
        return {
            total: jobs.length,
            pending: jobs.filter(function (j) { return j.status === 'pending'; }).length,
            processing: jobs.filter(function (j) { return j.status === 'processing'; }).length,
            completed: jobs.filter(function (j) { return j.status === 'completed'; }).length,
            failed: jobs.filter(function (j) { return j.status === 'failed'; }).length,
            retrying: jobs.filter(function (j) { return j.status === 'retrying'; }).length,
        };
    };
    /**
     * Generate a unique job ID
     */
    MessageQueue.prototype.generateJobId = function () {
        return "job-".concat(Date.now(), "-").concat(Math.random().toString(36).substr(2, 9));
    };
    /**
     * Get configuration
     */
    MessageQueue.prototype.getConfig = function () {
        return __assign({}, this.config);
    };
    /**
     * Update configuration
     */
    MessageQueue.prototype.updateConfig = function (config) {
        this.config = __assign(__assign({}, this.config), config);
    };
    return MessageQueue;
}());
// Export singleton instance
exports.messageQueue = new MessageQueue();
