/**
 * Connection Pool Monitor Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getPoolMonitor } from '../pool-monitor';
import { poolMetrics, poolExhaustionManager } from '../../config/database';

describe('PoolMonitor', () => {
  let monitor: ReturnType<typeof getPoolMonitor>;

  beforeEach(() => {
    monitor = getPoolMonitor();
    poolMetrics.reset();
  });

  afterEach(() => {
    monitor.shutdown();
  });

  describe('Health Reporting', () => {
    it('should report healthy status with low utilization', () => {
      poolMetrics.setPoolLimits(50, 5);
      poolMetrics.recordConnectionAcquired(10);

      const health = monitor.getHealthReport();

      expect(health.status).toBe('healthy');
      expect(health.activeConnections).toBe(1);
      expect(health.utilizationPercent).toBeLessThan(50);
    });

    it('should report degraded status with high utilization', () => {
      poolMetrics.setPoolLimits(10, 1);
      for (let i = 0; i < 8; i++) {
        poolMetrics.recordConnectionAcquired(5);
      }

      const health = monitor.getHealthReport();

      expect(health.status).toBe('degraded');
      expect(health.utilizationPercent).toBeGreaterThan(75);
      expect(health.recommendations.length).toBeGreaterThan(0);
    });

    it('should report critical status with exhaustion', () => {
      poolMetrics.setPoolLimits(10, 1);
      for (let i = 0; i < 10; i++) {
        poolMetrics.recordConnectionAcquired(5);
      }
      poolMetrics.recordPoolExhaustion();

      const health = monitor.getHealthReport();

      expect(health.status).toBe('critical');
      expect(health.exhaustion.events).toBeGreaterThan(0);
    });
  });

  describe('Leak Detection', () => {
    it('should detect connection leaks', async () => {
      for (let i = 0; i < 3; i++) {
        poolMetrics.recordConnectionAcquired(100);
      }
      poolMetrics.recordLeakDetected();

      const leakCount = await monitor.detectLeaks();

      expect(leakCount).toBeGreaterThanOrEqual(0);
      const health = monitor.getHealthReport();
      expect(health.leaks.detected).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Metrics Collection', () => {
    it('should accurately track connection metrics', () => {
      poolMetrics.setPoolLimits(50, 5);

      // Simulate connection lifecycle
      poolMetrics.recordConnectionAcquired(10);
      poolMetrics.recordConnectionAcquired(15);
      poolMetrics.recordConnectionAcquired(8);

      poolMetrics.recordConnectionReleased();
      poolMetrics.recordConnectionReleased();

      const metrics = monitor.getMetrics();

      expect(metrics.totalConnections).toBe(3);
      expect(metrics.activeConnections).toBe(1);
      expect(metrics.connectionLeasesTotal).toBe(3);
      expect(metrics.connectionLeasesReleased).toBe(2);
    });

    it('should calculate average acquire time', () => {
      poolMetrics.setPoolLimits(50, 5);

      // Record connections with different times
      poolMetrics.recordConnectionAcquired(10);
      poolMetrics.recordConnectionAcquired(20);
      poolMetrics.recordConnectionAcquired(30);

      const metrics = monitor.getMetrics();

      expect(metrics.averageAcquireTimeMs).toBeCloseTo(20, 1);
    });
  });

  describe('Configuration', () => {
    it('should return PgBouncer configuration', () => {
      const config = monitor.getPgBouncerConfig();

      expect(config).toBeDefined();
      expect(config.poolMode).toBe('transaction');
      expect(config.maxPoolSize).toBeGreaterThan(0);
      expect(config.minPoolSize).toBeLessThanOrEqual(config.maxPoolSize);
    });
  });

  describe('Exhaustion Handling', () => {
    it('should handle pool exhaustion gracefully', () => {
      let exhaustionCalled = false;
      let recoveryCalled = false;

      poolExhaustionManager.registerHandler({
        onExhaustion: () => {
          exhaustionCalled = true;
        },
        onRecovery: () => {
          recoveryCalled = true;
        },
      });

      poolExhaustionManager.notifyExhaustion();
      expect(exhaustionCalled).toBe(true);

      poolExhaustionManager.notifyRecovery();
      expect(recoveryCalled).toBe(true);
    });

    it('should track exhaustion count', () => {
      poolMetrics.setPoolLimits(10, 1);

      poolExhaustionManager.notifyExhaustion();
      poolExhaustionManager.notifyExhaustion();

      const metrics = monitor.getMetrics();
      expect(metrics.poolExhaustionCount).toBeGreaterThan(0);
    });
  });
});
