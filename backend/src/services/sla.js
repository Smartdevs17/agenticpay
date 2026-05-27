"use strict";
/**
 * SLA Tracking Service
 * Tracks and monitors service level agreements including response times, uptime, and violations
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.slaTracker = void 0;
var DEFAULT_SLA_CONFIG = {
    maxResponseTimeMs: 1000, // 1 second
    maxErrorRatePercent: 5, // 5% error rate
    minUptimePercent: 99.5, // 99.5% uptime SLA
    aggregationIntervalMs: 60 * 1000, // 1 minute
};
var SLATracker = /** @class */ (function () {
    function SLATracker(config) {
        if (config === void 0) { config = {}; }
        this.metrics = new Map();
        this.violations = [];
        this.violationListeners = [];
        this.config = __assign(__assign({}, DEFAULT_SLA_CONFIG), config);
    }
    /**
     * Track a request response time
     */
    SLATracker.prototype.trackRequest = function (endpoint, responseTimeMs, statusCode, timestamp) {
        if (timestamp === void 0) { timestamp = new Date(); }
        var metrics = this.metrics.get(endpoint);
        if (!metrics) {
            metrics = {
                endpoint: endpoint,
                totalRequests: 0,
                successfulRequests: 0,
                failedRequests: 0,
                totalResponseTime: 0,
                minResponseTime: Infinity,
                maxResponseTime: 0,
                averageResponseTime: 0,
                startTime: timestamp,
                uptime: 100,
                violations: [],
            };
            this.metrics.set(endpoint, metrics);
        }
        // Update counters
        metrics.totalRequests += 1;
        if (statusCode >= 200 && statusCode < 300) {
            metrics.successfulRequests += 1;
        }
        else {
            metrics.failedRequests += 1;
        }
        // Update response time stats
        metrics.totalResponseTime += responseTimeMs;
        metrics.minResponseTime = Math.min(metrics.minResponseTime, responseTimeMs);
        metrics.maxResponseTime = Math.max(metrics.maxResponseTime, responseTimeMs);
        metrics.averageResponseTime = metrics.totalResponseTime / metrics.totalRequests;
        // Update uptime
        var errorRate = (metrics.failedRequests / metrics.totalRequests) * 100;
        metrics.uptime = Math.max(0, 100 - errorRate);
        // Check SLA violations
        this.checkViolations(endpoint, metrics);
    };
    /**
     * Check if metrics violate SLA thresholds
     */
    SLATracker.prototype.checkViolations = function (endpoint, metrics) {
        var now = new Date();
        // Check response time violation
        if (metrics.averageResponseTime > this.config.maxResponseTimeMs) {
            var violation = {
                timestamp: now,
                endpoint: endpoint,
                type: 'RESPONSE_TIME',
                threshold: this.config.maxResponseTimeMs,
                actual: metrics.averageResponseTime,
                severity: metrics.averageResponseTime >
                    this.config.maxResponseTimeMs * 1.5
                    ? 'CRITICAL'
                    : 'WARNING',
            };
            this.violations.push(violation);
            metrics.violations.push(violation);
            this.notifyViolation(violation);
        }
        // Check error rate violation
        var errorRate = (metrics.failedRequests / metrics.totalRequests) * 100;
        if (errorRate > this.config.maxErrorRatePercent) {
            var violation = {
                timestamp: now,
                endpoint: endpoint,
                type: 'ERROR_RATE',
                threshold: this.config.maxErrorRatePercent,
                actual: errorRate,
                severity: errorRate > this.config.maxErrorRatePercent * 1.5 ? 'CRITICAL' : 'WARNING',
            };
            this.violations.push(violation);
            metrics.violations.push(violation);
            this.notifyViolation(violation);
        }
        // Check uptime violation
        if (metrics.uptime < this.config.minUptimePercent) {
            var violation = {
                timestamp: now,
                endpoint: endpoint,
                type: 'UPTIME',
                threshold: this.config.minUptimePercent,
                actual: metrics.uptime,
                severity: metrics.uptime < this.config.minUptimePercent * 0.95 ? 'CRITICAL' : 'WARNING',
            };
            this.violations.push(violation);
            metrics.violations.push(violation);
            this.notifyViolation(violation);
        }
    };
    /**
     * Register a listener for SLA violations
     */
    SLATracker.prototype.onViolation = function (callback) {
        this.violationListeners.push(callback);
    };
    /**
     * Notify all listeners of a violation
     */
    SLATracker.prototype.notifyViolation = function (violation) {
        this.violationListeners.forEach(function (listener) {
            try {
                listener(violation);
            }
            catch (error) {
                console.error('Error in SLA violation listener:', error);
            }
        });
    };
    /**
     * Get metrics for a specific endpoint
     */
    SLATracker.prototype.getMetrics = function (endpoint) {
        if (endpoint) {
            return (this.metrics.get(endpoint) || {
                endpoint: endpoint,
                totalRequests: 0,
                successfulRequests: 0,
                failedRequests: 0,
                totalResponseTime: 0,
                minResponseTime: 0,
                maxResponseTime: 0,
                averageResponseTime: 0,
                startTime: new Date(),
                uptime: 100,
                violations: [],
            });
        }
        return this.metrics;
    };
    /**
     * Get all violations
     */
    SLATracker.prototype.getViolations = function (endpoint, limit) {
        var filtered = endpoint
            ? this.violations.filter(function (v) { return v.endpoint === endpoint; })
            : this.violations;
        if (limit) {
            filtered = filtered.slice(-limit);
        }
        return filtered;
    };
    /**
     * Generate SLA report
     */
    SLATracker.prototype.generateReport = function (endpoint) {
        return {
            summary: this.getMetrics(endpoint),
            violations: this.getViolations(endpoint),
            config: this.config,
            reportedAt: new Date(),
        };
    };
    /**
     * Reset metrics for an endpoint (or all endpoints)
     */
    SLATracker.prototype.reset = function (endpoint) {
        if (endpoint) {
            this.metrics.delete(endpoint);
            this.violations = this.violations.filter(function (v) { return v.endpoint !== endpoint; });
        }
        else {
            this.metrics.clear();
            this.violations = [];
        }
    };
    /**
     * Get configuration
     */
    SLATracker.prototype.getConfig = function () {
        return __assign({}, this.config);
    };
    /**
     * Update configuration
     */
    SLATracker.prototype.updateConfig = function (config) {
        this.config = __assign(__assign({}, this.config), config);
    };
    return SLATracker;
}());
// Export singleton instance
exports.slaTracker = new SLATracker();
