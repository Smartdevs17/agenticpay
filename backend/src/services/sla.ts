/**
 * SLA Tracking Service
 * Tracks and monitors service level agreements including response times, uptime, and violations
 */

export interface SLAMetrics {
  endpoint: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  averageResponseTime: number;
  startTime: Date;
  endTime?: Date;
  uptime: number; // percentage
  violations: SLAViolation[];
}

export interface SLAViolation {
  timestamp: Date;
  endpoint: string;
  type: 'RESPONSE_TIME' | 'ERROR_RATE' | 'UPTIME';
  threshold: number;
  actual: number;
  severity: 'WARNING' | 'CRITICAL';
}

export interface SLAConfig {
  maxResponseTimeMs: number;
  maxErrorRatePercent: number;
  minUptimePercent: number;
  aggregationIntervalMs: number;
}

const DEFAULT_SLA_CONFIG: SLAConfig = {
  maxResponseTimeMs: 1000, // 1 second
  maxErrorRatePercent: 5, // 5% error rate
  minUptimePercent: 99.5, // 99.5% uptime SLA
  aggregationIntervalMs: 60 * 1000, // 1 minute
};

class SLATracker {
  private metrics: Map<string, SLAMetrics> = new Map();
  private config: SLAConfig;
  private violations: SLAViolation[] = [];
  private violationListeners: ((violation: SLAViolation) => void)[] = [];

  constructor(config: Partial<SLAConfig> = {}) {
    this.config = { ...DEFAULT_SLA_CONFIG, ...config };
  }

  /**
   * Track a request response time
   */
  trackRequest(
    endpoint: string,
    responseTimeMs: number,
    statusCode: number,
    timestamp: Date = new Date()
  ): void {
    let metrics = this.metrics.get(endpoint);

    if (!metrics) {
      metrics = {
        endpoint,
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
    } else {
      metrics.failedRequests += 1;
    }

    // Update response time stats
    metrics.totalResponseTime += responseTimeMs;
    metrics.minResponseTime = Math.min(metrics.minResponseTime, responseTimeMs);
    metrics.maxResponseTime = Math.max(metrics.maxResponseTime, responseTimeMs);
    metrics.averageResponseTime = metrics.totalResponseTime / metrics.totalRequests;

    // Update uptime
    const errorRate = (metrics.failedRequests / metrics.totalRequests) * 100;
    metrics.uptime = Math.max(0, 100 - errorRate);

    // Check SLA violations
    this.checkViolations(endpoint, metrics);
  }

  /**
   * Check if metrics violate SLA thresholds
   */
  private checkViolations(endpoint: string, metrics: SLAMetrics): void {
    const now = new Date();

    // Check response time violation
    if (metrics.averageResponseTime > this.config.maxResponseTimeMs) {
      const violation: SLAViolation = {
        timestamp: now,
        endpoint,
        type: 'RESPONSE_TIME',
        threshold: this.config.maxResponseTimeMs,
        actual: metrics.averageResponseTime,
        severity:
          metrics.averageResponseTime >
          this.config.maxResponseTimeMs * 1.5
            ? 'CRITICAL'
            : 'WARNING',
      };
      this.violations.push(violation);
      metrics.violations.push(violation);
      this.notifyViolation(violation);
    }

    // Check error rate violation
    const errorRate = (metrics.failedRequests / metrics.totalRequests) * 100;
    if (errorRate > this.config.maxErrorRatePercent) {
      const violation: SLAViolation = {
        timestamp: now,
        endpoint,
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
      const violation: SLAViolation = {
        timestamp: now,
        endpoint,
        type: 'UPTIME',
        threshold: this.config.minUptimePercent,
        actual: metrics.uptime,
        severity: metrics.uptime < this.config.minUptimePercent * 0.95 ? 'CRITICAL' : 'WARNING',
      };
      this.violations.push(violation);
      metrics.violations.push(violation);
      this.notifyViolation(violation);
    }
  }

  /**
   * Register a listener for SLA violations
   */
  onViolation(callback: (violation: SLAViolation) => void): void {
    this.violationListeners.push(callback);
  }

  /**
   * Notify all listeners of a violation
   */
  private notifyViolation(violation: SLAViolation): void {
    this.violationListeners.forEach((listener) => {
      try {
        listener(violation);
      } catch (error) {
        console.error('Error in SLA violation listener:', error);
      }
    });
  }

  /**
   * Get metrics for a specific endpoint
   */
  getMetrics(endpoint?: string): SLAMetrics | Map<string, SLAMetrics> {
    if (endpoint) {
      return (
        this.metrics.get(endpoint) || {
          endpoint,
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
        }
      );
    }
    return this.metrics;
  }

  /**
   * Get all violations
   */
  getViolations(endpoint?: string, limit?: number): SLAViolation[] {
    let filtered = endpoint
      ? this.violations.filter((v) => v.endpoint === endpoint)
      : this.violations;

    if (limit) {
      filtered = filtered.slice(-limit);
    }

    return filtered;
  }

  /**
   * Generate SLA report
   */
  generateReport(endpoint?: string): {
    summary: SLAMetrics | Map<string, SLAMetrics>;
    violations: SLAViolation[];
    config: SLAConfig;
    reportedAt: Date;
  } {
    return {
      summary: this.getMetrics(endpoint),
      violations: this.getViolations(endpoint),
      config: this.config,
      reportedAt: new Date(),
    };
  }

  /**
   * Reset metrics for an endpoint (or all endpoints)
   */
  reset(endpoint?: string): void {
    if (endpoint) {
      this.metrics.delete(endpoint);
      this.violations = this.violations.filter((v) => v.endpoint !== endpoint);
    } else {
      this.metrics.clear();
      this.violations = [];
    }
  }

  /**
   * Get configuration
   */
  getConfig(): SLAConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SLAConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Export singleton instance
export const slaTracker = new SLATracker();
