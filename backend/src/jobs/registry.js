"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobRegistry = void 0;
var JobRegistry = /** @class */ (function () {
    function JobRegistry() {
        this.statuses = new Map();
        this.definitions = new Map();
    }
    JobRegistry.prototype.register = function (definition) {
        if (this.definitions.has(definition.id)) {
            throw new Error("Job with id ".concat(definition.id, " already exists"));
        }
        this.definitions.set(definition.id, definition);
        this.statuses.set(definition.id, {
            id: definition.id,
            name: definition.name,
            schedule: definition.schedule,
            status: 'idle',
            lastRunAt: null,
            lastSuccessAt: null,
            lastError: null,
            failureCount: 0,
            nextRunAt: null,
        });
    };
    JobRegistry.prototype.getDefinition = function (jobId) {
        return this.definitions.get(jobId);
    };
    JobRegistry.prototype.getStatus = function (jobId) {
        return this.statuses.get(jobId);
    };
    JobRegistry.prototype.updateStatus = function (jobId, updater) {
        var current = this.statuses.get(jobId);
        if (!current) {
            return;
        }
        this.statuses.set(jobId, updater(current));
    };
    JobRegistry.prototype.listStatuses = function () {
        return Array.from(this.statuses.values());
    };
    return JobRegistry;
}());
exports.JobRegistry = JobRegistry;
