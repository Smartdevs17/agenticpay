/**
 * Database Connection Pool Monitoring Service
 * Provides real-time monitoring of PgBouncer and Prisma connection pools,
 * leak detection, exhaustion handling, and performance metrics.
 */

import {
  poolMetrics,
  connectionLeaseManager,
  poolExhaustionManager,
  getPgBouncerConfig,
  buildPoolConfig,
} from '../config/database.js';

export interface PoolHealthReport {
  status: 'healthy' | 'degraded' | 'critical';
  activeConnections: number;
  idleConnections: number;
  utilizationPercent: number;
  poolSize: {
    min: number;
    max: number;
  };
  leaks: {
    detected: number;
    threshold: number;
  };
  exhaustion: {
    events: number;
    lastOccurrence?: string;
  };
  recommendations: string[];
}

class PoolMonitor {
  private lastExhaustionTime: number = 0;
  private exhaustionCount: number = 0;
  private reportInterval?: NodeJS.Timeout;
  private checkInterval?: NodeJS.Timeout;

  /**
   * Initialize pool monitoring
   */
  initialize(): void {
    // Start health checks
    this.startHealthChecks();

    // Start periodic reporting
    this.startReporting();

    // Register exhaustion handlers
    this.registerExhaustionHandlers();
  }

  /**
   * Register handlers for pool exhaustion events
   */
  private registerExhaustionHandlers(): void {
    poolExhaustionManager.registerHandler({
      onExhaustion: () => {
        this.exhaustionCount++;
        this.lastExhaustionTime = Date.now();
        console.warn(`[Pool Monitor] Exhaustion event #${this.exhaustionCount}`);
        this.alertExhaustion();
      },
      onRecovery: () => {
        console.log(`[Pool Monitor] Pool recovered after ${this.exhaustionCount} exhaustion events`);
        this.resetExhaustionCounter();
      },
      backoffMs: 100,
      maxBackoffMs: 10000,
    });
  }

  /**
   * Start health checks every 30 seconds
   */
  private startHealthChecks(): void {
    this.checkInterval = setInterval(() => {
      const health = this.getHealthReport();

      if (health.status === 'critical') {
        console.error(`[Pool Monitor] CRITICAL: ${health.recommendations.join(', ')}`);
      } else if (health.status === 'degraded') {
        console.warn(`[Pool Monitor] DEGRADED: ${health.recommendations.join(', ')}`);
      }
    }, 30000);
  }

  /**
   * Start periodic reporting every 5 minutes
   */
  private startReporting(): void {
    this.reportInterval = setInterval(() => {
      const report = this.getHealthReport();
      console.log(`[Pool Monitor Report]`, JSON.stringify(report, null, 2));
    }, 300000);
  }

  /**
   * Get comprehensive health report
   */
  getHealthReport(): PoolHealthReport {
    const metrics = poolMetrics.snapshot();
    const pgBouncerConfig = getPgBouncerConfig();
    const poolConfig = buildPoolConfig(process.env.NODE_ENV);

    const utilizationPercent = (metrics.activeConnections / metrics.maxConnections) * 100;

    // Determine health status
    let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
    const recommendations: string[] = [];

    if (utilizationPercent > 90) {
      status = 'critical';
      recommendations.push('Critical pool utilization (>90%), consider increasing max connections');
    } else if (utilizationPercent > 75) {
      status = 'degraded';
      recommendations.push('High pool utilization (>75%), monitor closely');
    }

    if (metrics.poolExhaustionCount > 0) {
      status = status === 'healthy' ? 'degraded' : status;
      recommendations.push(`Pool exhaustion occurred ${metrics.poolExhaustionCount} times`);
    }

    if (metrics.leakedConnectionsDetected > 0) {
      status = 'critical';
      recommendations.push(`${metrics.leakedConnectionsDetected} connection leaks detected`);
    }

    if (metrics.connectionLeaseErrors > 0) {
      status = status === 'healthy' ? 'degraded' : status;
      recommendations.push(`${metrics.connectionLeaseErrors} connection errors occurred`);
    }

    if (metrics.waitingClients > poolConfig.max * 0.5) {
      recommendations.push('High number of waiting clients, increase pool size or optimize queries');
    }

    if (recommendations.length === 0 && status === 'healthy') {
      recommendations.push('Pool operating normally');
    }

    return {
      status,
      activeConnections: metrics.activeConnections,
      idleConnections: metrics.idleConnections,
      utilizationPercent,
      poolSize: {
        min: metrics.minConnections,
        max: metrics.maxConnections,
      },
      leaks: {
        detected: metrics.leakedConnectionsDetected,
        threshold: 5,
      },
      exhaustion: {
        events: this.exhaustionCount,
        lastOccurrence: this.lastExhaustionTime ? new Date(this.lastExhaustionTime).toISOString() : undefined,
      },
      recommendations,
    };
  }

  /**
   * Get detailed metrics
   */
  getMetrics() {
    return poolMetrics.snapshot();
  }

  /**
   * Alert on pool exhaustion
   */
  private alertExhaustion(): void {
    const health = this.getHealthReport();
    console.error(`[Pool Monitor Alert] ${health.recommendations.join(', ')}`);

    // Could send to alerting service here
    // notifyOps({ severity: 'critical', message: `Pool exhaustion: ${health.recommendations.join(', ')}` });
  }

  /**
   * Reset exhaustion counter
   */
  private resetExhaustionCounter(): void {
    this.exhaustionCount = 0;
  }

  /**
   * Check for connection leaks
   */
  async detectLeaks(): Promise<number> {
    const activeLeases = connectionLeaseManager.getActiveLeaseCount();
    console.log(`[Pool Monitor] Active connection leases: ${activeLeases}`);
    return activeLeases;
  }

  /**
   * Get PgBouncer configuration
   */
  getPgBouncerConfig() {
    return getPgBouncerConfig();
  }

  /**
   * Shutdown monitoring
   */
  shutdown(): void {
    if (this.reportInterval) clearInterval(this.reportInterval);
    if (this.checkInterval) clearInterval(this.checkInterval);
  }
}

// Singleton instance
let poolMonitorInstance: PoolMonitor | null = null;

export function getPoolMonitor(): PoolMonitor {
  if (!poolMonitorInstance) {
    poolMonitorInstance = new PoolMonitor();
    poolMonitorInstance.initialize();
  }
  return poolMonitorInstance;
}

export { PoolMonitor };
