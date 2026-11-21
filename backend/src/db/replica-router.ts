/**
 * Database read replica router with automatic query classification
 * Routes read queries to replicas and writes to primary
 */

import { PrismaClient } from '@prisma/client';

export interface ReplicaConfig {
  host: string;
  port: number;
  enabled: boolean;
  maxLag: number; // milliseconds
}

export interface ReplicationStatus {
  replica: string;
  healthy: boolean;
  lag: number;
  lastCheck: Date;
}

export class ReplicaRouter {
  private primary: PrismaClient;
  private replicas: Map<string, PrismaClient> = new Map();
  private replicaHealth: Map<string, ReplicationStatus> = new Map();
  private currentReplicaIndex = 0;
  private sessionStickiness: Map<string, string> = new Map(); // sessionId -> replicaId
  private config: {
    maxReplicationLag: number;
    healthCheckInterval: number;
    enableStickiness: boolean;
  };

  constructor(
    primaryUrl: string,
    replicaUrls: string[],
    config?: Partial<typeof ReplicaRouter.prototype.config>
  ) {
    this.primary = new PrismaClient({
      datasources: { db: { url: primaryUrl } },
    });

    this.config = {
      maxReplicationLag: 5000, // 5 seconds
      healthCheckInterval: 30000, // 30 seconds
      enableStickiness: true,
      ...config,
    };

    // Initialize replicas
    replicaUrls.forEach((url, index) => {
      const replicaId = `replica-${index}`;
      const replica = new PrismaClient({
        datasources: { db: { url } },
      });
      this.replicas.set(replicaId, replica);
      this.replicaHealth.set(replicaId, {
        replica: replicaId,
        healthy: true,
        lag: 0,
        lastCheck: new Date(),
      });
    });

    this.startHealthChecks();
  }

  /**
   * Classify query type based on operation
   */
  private isReadQuery(operation: string): boolean {
    const readOperations = [
      'findUnique',
      'findFirst',
      'findMany',
      'count',
      'aggregate',
      'groupBy',
    ];
    return readOperations.includes(operation);
  }

  /**
   * Get healthy replica using round-robin
   */
  private getHealthyReplica(sessionId?: string): PrismaClient | null {
    // Check session stickiness
    if (sessionId && this.config.enableStickiness) {
      const stickyReplica = this.sessionStickiness.get(sessionId);
      if (stickyReplica) {
        const replica = this.replicas.get(stickyReplica);
        const health = this.replicaHealth.get(stickyReplica);
        if (replica && health?.healthy) {
          return replica;
        }
      }
    }

    const healthyReplicas = Array.from(this.replicas.entries()).filter(
      ([id, _]) => {
        const health = this.replicaHealth.get(id);
        return health?.healthy && health.lag < this.config.maxReplicationLag;
      }
    );

    if (healthyReplicas.length === 0) {
      return null;
    }

    // Round-robin selection
    const [replicaId, replica] =
      healthyReplicas[this.currentReplicaIndex % healthyReplicas.length];
    this.currentReplicaIndex++;

    // Store session stickiness
    if (sessionId && this.config.enableStickiness) {
      this.sessionStickiness.set(sessionId, replicaId);
    }

    return replica;
  }

  /**
   * Route query to appropriate database
   */
  async route<T>(
    operation: string,
    model: string,
    args: any,
    sessionId?: string,
    forcePrimary = false
  ): Promise<T> {
    const isRead = this.isReadQuery(operation);

    // Always use primary for writes or when forced
    if (!isRead || forcePrimary) {
      // @ts-ignore
      return this.primary[model][operation](args);
    }

    // Try replica for reads
    const replica = this.getHealthyReplica(sessionId);
    if (replica) {
      try {
        // @ts-ignore
        return await replica[model][operation](args);
      } catch (error) {
        console.warn('Replica query failed, falling back to primary', error);
      }
    }

    // Fallback to primary
    // @ts-ignore
    return this.primary[model][operation](args);
  }

  /**
   * Check replication lag for a replica
   */
  private async checkReplicationLag(
    replicaId: string,
    replica: PrismaClient
  ): Promise<number> {
    try {
      // Query replication status
      const result = await replica.$queryRaw<
        Array<{ lag_seconds: number }>
      >`SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) AS lag_seconds`;

      const lagMs = result[0]?.lag_seconds * 1000 || 0;
      return lagMs;
    } catch (error) {
      console.error(`Failed to check replication lag for ${replicaId}`, error);
      return Infinity;
    }
  }

  /**
   * Health check for all replicas
   */
  private async performHealthCheck() {
    for (const [replicaId, replica] of this.replicas.entries()) {
      try {
        const lag = await this.checkReplicationLag(replicaId, replica);
        const healthy = lag < this.config.maxReplicationLag;

        this.replicaHealth.set(replicaId, {
          replica: replicaId,
          healthy,
          lag,
          lastCheck: new Date(),
        });

        if (!healthy) {
          console.warn(
            `Replica ${replicaId} unhealthy: lag=${lag}ms, threshold=${this.config.maxReplicationLag}ms`
          );
        }
      } catch (error) {
        console.error(`Health check failed for ${replicaId}`, error);
        this.replicaHealth.set(replicaId, {
          replica: replicaId,
          healthy: false,
          lag: Infinity,
          lastCheck: new Date(),
        });
      }
    }
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks() {
    setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);

    // Initial health check
    this.performHealthCheck();
  }

  /**
   * Get replication status for monitoring
   */
  getReplicationStatus(): ReplicationStatus[] {
    return Array.from(this.replicaHealth.values());
  }

  /**
   * Get primary client (for explicit primary queries)
   */
  getPrimary(): PrismaClient {
    return this.primary;
  }

  /**
   * Disconnect all clients
   */
  async disconnect() {
    await this.primary.$disconnect();
    for (const replica of this.replicas.values()) {
      await replica.$disconnect();
    }
  }
}

/**
 * Prisma middleware for automatic query routing
 */
export function createReplicaMiddleware(router: ReplicaRouter) {
  return async (params: any, next: any) => {
    const { model, action, args } = params;

    // Extract session ID from context if available
    const sessionId = args?.sessionId;

    // Check if write occurred in this session (use primary)
    const forcePrimary = args?.forcePrimary || false;

    // Route the query
    return router.route(action, model, args, sessionId, forcePrimary);
  };
}
