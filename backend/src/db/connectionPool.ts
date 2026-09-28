/**
 * Database Connection Pooling Optimization
 *
 * Configures and monitors Prisma connection pool for optimal performance
 * under varying load conditions.
 */

import { PrismaClient } from "@prisma/client";
import { Logger } from "../config/logger";

const logger = Logger.getLogger("ConnectionPool");

export interface PoolConfig {
  /** Minimum connections to keep open */
  minConnections: number;
  /** Maximum connections to allow */
  maxConnections: number;
  /** Connection timeout in milliseconds */
  connectionTimeout: number;
  /** Idle timeout in milliseconds (when to close idle connections) */
  idleTimeout: number;
  /** Enable connection reuse */
  reuseConnections: boolean;
  /** Enable query timeout enforcement */
  queryTimeout: number;
}

/**
 * Default pool configuration optimized for production.
 * Adjust based on load testing and monitoring.
 */
export const DEFAULT_POOL_CONFIG: PoolConfig = {
  minConnections: 2,
  maxConnections: 20,
  connectionTimeout: 10000, // 10 seconds
  idleTimeout: 300000, // 5 minutes
  reuseConnections: true,
  queryTimeout: 30000, // 30 seconds
};

/**
 * Environment-based pool configuration.
 * Production uses larger pools; development uses smaller ones.
 */
export function getPoolConfigByEnvironment(env: string): PoolConfig {
  switch (env) {
    case "production":
      return {
        minConnections: 5,
        maxConnections: 50,
        connectionTimeout: 15000,
        idleTimeout: 300000,
        reuseConnections: true,
        queryTimeout: 30000,
      };

    case "staging":
      return {
        minConnections: 3,
        maxConnections: 25,
        connectionTimeout: 10000,
        idleTimeout: 300000,
        reuseConnections: true,
        queryTimeout: 30000,
      };

    case "development":
      return {
        minConnections: 1,
        maxConnections: 5,
        connectionTimeout: 10000,
        idleTimeout: 600000, // 10 minutes (don't close idle conns quickly in dev)
        reuseConnections: true,
        queryTimeout: 60000, // 60 seconds (allow slow queries in dev)
      };

    default:
      return DEFAULT_POOL_CONFIG;
  }
}

/**
 * Build Prisma connection string with pool optimization parameters.
 */
export function buildConnectionStringWithPoolConfig(
  baseUrl: string,
  config: PoolConfig
): string {
  // Prisma connection pool parameters
  const params = new URLSearchParams();
  params.set("connection_limit", config.maxConnections.toString());
  params.set("pool_size", config.minConnections.toString());

  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}${params.toString()}`;
}

/**
 * Monitor connection pool health and log statistics.
 */
export class PoolMonitor {
  private prisma: PrismaClient;
  private config: PoolConfig;
  private monitoringInterval?: NodeJS.Timeout;

  constructor(prisma: PrismaClient, config: PoolConfig) {
    this.prisma = prisma;
    this.config = config;
  }

  /**
   * Start monitoring connection pool health.
   */
  startMonitoring(intervalMs: number = 60000): void {
    if (this.monitoringInterval) {
      logger.warn("Monitoring already started");
      return;
    }

    this.monitoringInterval = setInterval(() => {
      this.checkPoolHealth();
    }, intervalMs);

    logger.info(`Connection pool monitoring started (interval: ${intervalMs}ms)`);
  }

  /**
   * Stop monitoring.
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      logger.info("Connection pool monitoring stopped");
    }
  }

  /**
   * Check and log pool health metrics.
   */
  async checkPoolHealth(): Promise<void> {
    try {
      // Execute a simple query to test pool
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      const duration = Date.now() - start;

      logger.debug(`Pool health check: ${duration}ms`);

      // Log warning if pool is under stress
      if (duration > this.config.queryTimeout * 0.5) {
        logger.warn(
          `Pool latency high: ${duration}ms (threshold: ${this.config.queryTimeout}ms)`
        );
      }
    } catch (error) {
      logger.error("Pool health check failed", { error });
    }
  }

  /**
   * Get pool statistics.
   */
  async getPoolStats(): Promise<{
    queryDuration: number;
    config: PoolConfig;
    timestamp: Date;
  }> {
    const start = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    const queryDuration = Date.now() - start;

    return {
      queryDuration,
      config: this.config,
      timestamp: new Date(),
    };
  }
}

/**
 * Graceful pool shutdown with cleanup.
 */
export async function gracefulPoolShutdown(
  prisma: PrismaClient,
  timeout: number = 10000
): Promise<void> {
  logger.info("Initiating graceful connection pool shutdown");

  try {
    // Disconnect with timeout
    await Promise.race([
      prisma.$disconnect(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Pool shutdown timeout")),
          timeout
        )
      ),
    ]);

    logger.info("Connection pool shutdown complete");
  } catch (error) {
    logger.error("Error during pool shutdown", { error });
    throw error;
  }
}

/**
 * Validate pool configuration values.
 */
export function validatePoolConfig(config: PoolConfig): string[] {
  const errors: string[] = [];

  if (config.minConnections < 1) {
    errors.push("minConnections must be at least 1");
  }

  if (config.maxConnections < config.minConnections) {
    errors.push("maxConnections must be >= minConnections");
  }

  if (config.connectionTimeout < 1000) {
    errors.push("connectionTimeout must be at least 1000ms");
  }

  if (config.idleTimeout < 1000) {
    errors.push("idleTimeout must be at least 1000ms");
  }

  if (config.queryTimeout < 1000) {
    errors.push("queryTimeout must be at least 1000ms");
  }

  return errors;
}
