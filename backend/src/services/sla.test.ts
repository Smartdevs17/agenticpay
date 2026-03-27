import { describe, it, expect, beforeEach, vi } from 'vitest';
import { slaTracker, SLAViolation } from '../services/sla.js';

describe('SLA Tracker', () => {
  beforeEach(() => {
    // Reset tracker before each test
    slaTracker.reset();
  });

  describe('Request Tracking', () => {
    it('should track a successful request', () => {
      slaTracker.trackRequest('/api/v1/test', 100, 200);

      const metrics = slaTracker.getMetrics('/api/v1/test');
      expect(metrics).toBeDefined();
      expect((metrics as any).totalRequests).toBe(1);
      expect((metrics as any).successfulRequests).toBe(1);
      expect((metrics as any).failedRequests).toBe(0);
      expect((metrics as any).averageResponseTime).toBe(100);
    });

    it('should track a failed request', () => {
      slaTracker.trackRequest('/api/v1/test', 50, 500);

      const metrics = slaTracker.getMetrics('/api/v1/test');
      expect((metrics as any).totalRequests).toBe(1);
      expect((metrics as any).successfulRequests).toBe(0);
      expect((metrics as any).failedRequests).toBe(1);
      expect((metrics as any).uptime).toBeLessThan(100);
    });

    it('should calculate average response time', () => {
      slaTracker.trackRequest('/api/v1/test', 100, 200);
      slaTracker.trackRequest('/api/v1/test', 200, 200);
      slaTracker.trackRequest('/api/v1/test', 300, 200);

      const metrics = slaTracker.getMetrics('/api/v1/test');
      expect((metrics as any).averageResponseTime).toBe(200);
      expect((metrics as any).minResponseTime).toBe(100);
      expect((metrics as any).maxResponseTime).toBe(300);
    });

    it('should calculate uptime correctly', () => {
      // 9 successful, 1 failed = 90% uptime
      for (let i = 0; i < 9; i++) {
        slaTracker.trackRequest('/api/v1/test', 100, 200);
      }
      slaTracker.trackRequest('/api/v1/test', 100, 500);

      const metrics = slaTracker.getMetrics('/api/v1/test');
      expect((metrics as any).uptime).toBe(90);
    });
  });

  describe('Violations', () => {
    it('should detect response time violations', () => {
      const config = slaTracker.getConfig();
      const violations: SLAViolation[] = [];

      slaTracker.onViolation((violation) => {
        violations.push(violation);
      });

      // Exceed max response time multiple times
      for (let i = 0; i < 5; i++) {
        slaTracker.trackRequest('/api/v1/test', config.maxResponseTimeMs + 100, 200);
      }

      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some((v) => v.type === 'RESPONSE_TIME')).toBe(true);
    });

    it('should detect error rate violations', () => {
      const violations: SLAViolation[] = [];

      slaTracker.onViolation((violation) => {
        violations.push(violation);
      });

      // Create high error rate: 6 failures, 4 successes = 60% error rate
      for (let i = 0; i < 6; i++) {
        slaTracker.trackRequest('/api/v1/test', 100, 500);
      }
      for (let i = 0; i < 4; i++) {
        slaTracker.trackRequest('/api/v1/test', 100, 200);
      }

      expect(violations.some((v) => v.type === 'ERROR_RATE')).toBe(true);
    });

    it('should detect uptime violations', () => {
      const violations: SLAViolation[] = [];

      slaTracker.onViolation((violation) => {
        violations.push(violation);
      });

      // Create low uptime: 99 failures, 1 success = 1% uptime
      for (let i = 0; i < 99; i++) {
        slaTracker.trackRequest('/api/v1/test', 100, 500);
      }
      slaTracker.trackRequest('/api/v1/test', 100, 200);

      expect(violations.some((v) => v.type === 'UPTIME')).toBe(true);
    });

    it('should set correct severity levels', () => {
      const violations: SLAViolation[] = [];

      slaTracker.onViolation((violation) => {
        violations.push(violation);
      });

      const config = slaTracker.getConfig();

      // Critical: Exceed max response time by 1.5x
      for (let i = 0; i < 5; i++) {
        slaTracker.trackRequest('/api/v1/test', config.maxResponseTimeMs * 1.6, 200);
      }

      const criticalViolations = violations.filter((v) => v.severity === 'CRITICAL');
      expect(criticalViolations.length).toBeGreaterThan(0);
    });
  });

  describe('Violation Listeners', () => {
    it('should notify listeners on violation', () => {
      const listener = vi.fn();
      slaTracker.onViolation(listener);

      const config = slaTracker.getConfig();
      for (let i = 0; i < 5; i++) {
        slaTracker.trackRequest('/api/v1/test', config.maxResponseTimeMs + 100, 200);
      }

      expect(listener).toHaveBeenCalled();
    });

    it('should handle listener errors gracefully', () => {
      const erroringListener = () => {
        throw new Error('Listener error');
      };
      const validListener = vi.fn();

      slaTracker.onViolation(erroringListener);
      slaTracker.onViolation(validListener);

      const config = slaTracker.getConfig();
      // This should not throw, listener errors should be caught
      expect(() => {
        for (let i = 0; i < 5; i++) {
          slaTracker.trackRequest('/api/v1/test', config.maxResponseTimeMs + 100, 200);
        }
      }).not.toThrow();

      expect(validListener).toHaveBeenCalled();
    });
  });

  describe('Reports', () => {
    it('should generate SLA report', () => {
      slaTracker.trackRequest('/api/v1/test', 100, 200);
      slaTracker.trackRequest('/api/v1/test', 150, 200);

      const report = slaTracker.generateReport();
      expect(report).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.violations).toBeDefined();
      expect(report.config).toBeDefined();
      expect(report.reportedAt).toBeDefined();
    });

    it('should generate report for specific endpoint', () => {
      slaTracker.trackRequest('/api/v1/test1', 100, 200);
      slaTracker.trackRequest('/api/v1/test2', 150, 200);

      const report = slaTracker.generateReport('/api/v1/test1');
      const metrics = report.summary as any;
      expect(metrics.endpoint).toBe('/api/v1/test1');
    });
  });

  describe('Configuration', () => {
    it('should get default configuration', () => {
      const config = slaTracker.getConfig();
      expect(config.maxResponseTimeMs).toBe(1000);
      expect(config.maxErrorRatePercent).toBe(5);
      expect(config.minUptimePercent).toBe(99.5);
    });

    it('should update configuration', () => {
      slaTracker.updateConfig({
        maxResponseTimeMs: 2000,
        maxErrorRatePercent: 10,
      });

      const config = slaTracker.getConfig();
      expect(config.maxResponseTimeMs).toBe(2000);
      expect(config.maxErrorRatePercent).toBe(10);
      expect(config.minUptimePercent).toBe(99.5); // unchanged
    });
  });

  describe('Data Retrieval', () => {
    it('should get all metrics', () => {
      slaTracker.trackRequest('/api/v1/test1', 100, 200);
      slaTracker.trackRequest('/api/v1/test2', 100, 200);

      const allMetrics = slaTracker.getMetrics();
      expect(allMetrics instanceof Map).toBe(true);
      expect((allMetrics as Map<string, any>).size).toBe(2);
    });

    it('should get specific endpoint metrics', () => {
      slaTracker.trackRequest('/api/v1/test', 100, 200);

      const metrics = slaTracker.getMetrics('/api/v1/test');
      expect((metrics as any).endpoint).toBe('/api/v1/test');
      expect((metrics as any).totalRequests).toBe(1);
    });

    it('should get violations with limit', () => {
      const violations: SLAViolation[] = [];
      slaTracker.onViolation((violation) => {
        violations.push(violation);
      });

      const config = slaTracker.getConfig();
      for (let i = 0; i < 10; i++) {
        slaTracker.trackRequest('/api/v1/test', config.maxResponseTimeMs + 100, 200);
      }

      const limitedViolations = slaTracker.getViolations(undefined, 5);
      expect(limitedViolations.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Reset', () => {
    it('should reset specific endpoint metrics', () => {
      slaTracker.trackRequest('/api/v1/test1', 100, 200);
      slaTracker.trackRequest('/api/v1/test2', 100, 200);

      slaTracker.reset('/api/v1/test1');

      const metrics1 = slaTracker.getMetrics('/api/v1/test1');
      const metrics2 = slaTracker.getMetrics('/api/v1/test2');

      expect((metrics1 as any).totalRequests).toBe(0);
      expect((metrics2 as any).totalRequests).toBe(1);
    });

    it('should reset all metrics', () => {
      slaTracker.trackRequest('/api/v1/test1', 100, 200);
      slaTracker.trackRequest('/api/v1/test2', 100, 200);

      slaTracker.reset();

      const allMetrics = slaTracker.getMetrics();
      expect((allMetrics as Map<string, any>).size).toBe(0);
    });
  });
});
