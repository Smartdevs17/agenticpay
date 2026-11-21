"use strict";
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
exports.JobScheduler = void 0;
var node_cron_1 = require("node-cron");
var cron_parser_1 = require("cron-parser");
var registry_js_1 = require("./registry.js");
var JobScheduler = /** @class */ (function () {
    function JobScheduler() {
        this.registry = new registry_js_1.JobRegistry();
        this.tasks = new Map();
    }
    JobScheduler.prototype.addJob = function (definition) {
        this.registry.register(definition);
        if (definition.schedule.type === 'cron') {
            this.scheduleCronJob(definition);
        }
        else {
            this.scheduleOneTimeJob(definition);
        }
    };
    JobScheduler.prototype.runJobNow = function (jobId) {
        return this.executeJob(jobId);
    };
    JobScheduler.prototype.pauseJob = function (jobId) {
        var job = this.tasks.get(jobId);
        if (!job || job.paused) {
            return;
        }
        job.paused = true;
        if (job.type === 'cron' && job.task) {
            job.task.stop();
        }
        if (job.type === 'once' && job.timeout) {
            clearTimeout(job.timeout);
            job.timeout = undefined;
        }
        this.registry.updateStatus(jobId, function (status) { return (__assign(__assign({}, status), { status: 'paused' })); });
    };
    JobScheduler.prototype.resumeJob = function (jobId) {
        var job = this.tasks.get(jobId);
        var def = this.registry.getDefinition(jobId);
        if (!job || !def || !job.paused) {
            return;
        }
        job.paused = false;
        if (def.schedule.type === 'cron') {
            this.scheduleCronJob(def, true);
        }
        else {
            this.scheduleOneTimeJob(def, true);
        }
        this.registry.updateStatus(jobId, function (status) { return (__assign(__assign({}, status), { status: 'idle' })); });
    };
    JobScheduler.prototype.getStatuses = function () {
        return this.registry.listStatuses();
    };
    JobScheduler.prototype.stopAll = function () {
        for (var _i = 0, _a = this.tasks.values(); _i < _a.length; _i++) {
            var job = _a[_i];
            if (job.type === 'cron' && job.task) {
                job.task.stop();
            }
            if (job.type === 'once' && job.timeout) {
                clearTimeout(job.timeout);
            }
        }
        for (var _b = 0, _c = this.tasks.keys(); _b < _c.length; _b++) {
            var jobId = _c[_b];
            this.registry.updateStatus(jobId, function (status) { return (__assign(__assign({}, status), { status: 'paused' })); });
        }
        this.tasks.clear();
    };
    JobScheduler.prototype.scheduleCronJob = function (definition, resuming) {
        var _this = this;
        if (resuming === void 0) { resuming = false; }
        var schedule = definition.schedule;
        if (schedule.type !== 'cron') {
            return;
        }
        var task = node_cron_1.default.schedule(schedule.expression, function () {
            void _this.executeJob(definition.id);
        }, { timezone: schedule.timezone, scheduled: true });
        if (!resuming) {
            this.tasks.set(definition.id, { type: 'cron', task: task, paused: false });
        }
        else {
            var existing = this.tasks.get(definition.id);
            if (existing) {
                existing.task = task;
                existing.paused = false;
            }
            else {
                this.tasks.set(definition.id, { type: 'cron', task: task, paused: false });
            }
        }
        this.registry.updateStatus(definition.id, function (status) { return (__assign(__assign({}, status), { nextRunAt: getNextRunAt(schedule), status: 'idle' })); });
    };
    JobScheduler.prototype.scheduleOneTimeJob = function (definition, resuming) {
        var _this = this;
        if (resuming === void 0) { resuming = false; }
        var schedule = definition.schedule;
        if (schedule.type !== 'once') {
            return;
        }
        var delay = Math.max(schedule.runAt.getTime() - Date.now(), 0);
        var timeout = setTimeout(function () {
            void _this.executeJob(definition.id);
        }, delay);
        if (!resuming) {
            this.tasks.set(definition.id, { type: 'once', timeout: timeout, paused: false });
        }
        else {
            var existing = this.tasks.get(definition.id);
            if (existing) {
                existing.timeout = timeout;
                existing.paused = false;
            }
            else {
                this.tasks.set(definition.id, { type: 'once', timeout: timeout, paused: false });
            }
        }
        this.registry.updateStatus(definition.id, function (status) { return (__assign(__assign({}, status), { nextRunAt: schedule.runAt, status: 'idle' })); });
    };
    JobScheduler.prototype.executeJob = function (jobId) {
        return __awaiter(this, void 0, void 0, function () {
            var def, jobEntry, error_1, message_1, job;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        def = this.registry.getDefinition(jobId);
                        if (!def) {
                            return [2 /*return*/];
                        }
                        jobEntry = this.tasks.get(jobId);
                        if (jobEntry === null || jobEntry === void 0 ? void 0 : jobEntry.paused) {
                            return [2 /*return*/];
                        }
                        this.registry.updateStatus(jobId, function (status) { return (__assign(__assign({}, status), { status: 'running', lastRunAt: new Date() })); });
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, 4, 5]);
                        return [4 /*yield*/, def.handler()];
                    case 2:
                        _a.sent();
                        this.registry.updateStatus(jobId, function (status) { return (__assign(__assign({}, status), { status: 'idle', lastSuccessAt: new Date(), lastError: null, nextRunAt: getNextRunAt(def.schedule) })); });
                        return [3 /*break*/, 5];
                    case 3:
                        error_1 = _a.sent();
                        message_1 = error_1 instanceof Error ? error_1.message : 'Unknown error';
                        this.registry.updateStatus(jobId, function (status) { return (__assign(__assign({}, status), { status: 'failed', lastError: message_1, failureCount: status.failureCount + 1, nextRunAt: getNextRunAt(def.schedule) })); });
                        return [3 /*break*/, 5];
                    case 4:
                        if (def.schedule.type === 'once') {
                            job = this.tasks.get(jobId);
                            if (job === null || job === void 0 ? void 0 : job.timeout) {
                                clearTimeout(job.timeout);
                            }
                            this.tasks.delete(jobId);
                            this.registry.updateStatus(jobId, function (status) { return (__assign(__assign({}, status), { nextRunAt: null, status: status.status === 'failed' ? 'failed' : 'idle' })); });
                        }
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    return JobScheduler;
}());
exports.JobScheduler = JobScheduler;
function getNextRunAt(schedule) {
    if (schedule.type === 'once') {
        return schedule.runAt;
    }
    try {
        var interval = cron_parser_1.default.parseExpression(schedule.expression, {
            tz: schedule.timezone,
        });
        return interval.next().toDate();
    }
    catch (_a) {
        return null;
    }
}
