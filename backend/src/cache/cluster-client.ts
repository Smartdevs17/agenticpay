/**
 * Redis Cluster client wrapper with automatic failover and slot management
 */

import {
  createClient,
  RedisClientType,
} from "redis";

export interface ClusterNode {
  host: string;
  port: number;
}

export interface ClusterConfig {
  nodes: ClusterNode[];
  maxRedirections: number;
  retryAttempts: number;
  retryDelay: number;
  enableReadFromReplicas: boolean;
}

export interface ClusterHealth {
  nodeId: string;
  host: string;
  port: number;
  role: "master" | "replica";
  connected: boolean;
  slots: number[];
  memory: {
    used: number;
    max: number;
    percentage: number;
  };
}

export class RedisClusterClient {
  private clients: Map<string, RedisClientType> = new Map();
  private config: ClusterConfig;
  private slotMap: Map<number, string> = new Map(); // slot -> nodeId
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(config: ClusterConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    // Connect to all cluster nodes
    for (const node of this.config.nodes) {
      const nodeId = `${node.host}:${node.port}`;
      const client = createClient({
        socket: {
          host: node.host,
          port: node.port,
          reconnectStrategy: (retries) => {
            if (retries > this.config.retryAttempts) {
              console.error(`Max retries reached for ${nodeId}`);
              return false;
            }
            return this.config.retryDelay * Math.pow(2, retries);
          },
        },
      });

      client.on("error", (err) => {
        console.error(`Redis cluster node ${nodeId} error:`, err);
      });

      await client.connect();
      this.clients.set(nodeId, client);
      console.log(`Connected to Redis cluster node: ${nodeId}`);
    }

    // Build slot map
    await this.updateSlotMap();

    // Start health monitoring
    this.startHealthCheck();
  }

  /**
   * Get client for a specific key using consistent hashing
   */
  private getClientForKey(key: string): RedisClientType {
    const slot = this.calculateSlot(key);
    const nodeId = this.slotMap.get(slot);

    if (nodeId) {
      const client = this.clients.get(nodeId);
      if (client) {
        return client;
      }
    }

    // Fallback to first available client
    const fallbackClient = Array.from(this.clients.values())[0];
    if (!fallbackClient) {
      throw new Error("No Redis cluster nodes available");
    }
    return fallbackClient;
  }

  /**
   * Calculate Redis slot for a key (CRC16 mod 16384)
   */
  private calculateSlot(key: string): number {
    // Extract hashtag if present: key{hashtag}
    const hashtagMatch = key.match(/\{([^}]+)\}/);
    const hashKey = hashtagMatch ? hashtagMatch[1] : key;

    return this.crc16(hashKey) % 16384;
  }

  /**
   * CRC16 implementation for Redis cluster
   */
  private crc16(str: string): number {
    const crcTable = [
      0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50a5, 0x60c6, 0x70e7, 0x8108,
      0x9129, 0xa14a, 0xb16b, 0xc18c, 0xd1ad, 0xe1ce, 0xf1ef,
    ];

    let crc = 0;
    for (let i = 0; i < str.length; i++) {
      const byte = str.charCodeAt(i);
      crc =
        ((crc << 4) ^ crcTable[((crc >> 12) ^ (byte >> 4)) & 0x0f]) & 0xffff;
      crc =
        ((crc << 4) ^ crcTable[((crc >> 12) ^ (byte & 0x0f)) & 0x0f]) & 0xffff;
    }
    return crc;
  }

  /**
   * Update slot map from cluster info
   */
  private async updateSlotMap(): Promise<void> {
    const firstClient = Array.from(this.clients.values())[0];
    if (!firstClient) return;

    try {
      // Get cluster slots information
      const clusterSlots: any = await firstClient.sendCommand([
        "CLUSTER",
        "SLOTS",
      ]);

      this.slotMap.clear();

      for (const slotRange of clusterSlots) {
        const [startSlot, endSlot, master] = slotRange;
        const nodeId = `${master[0]}:${master[1]}`;

        for (let slot = startSlot; slot <= endSlot; slot++) {
          this.slotMap.set(slot, nodeId);
        }
      }

      console.log(`Updated slot map: ${this.slotMap.size} slots mapped`);
    } catch (error) {
      console.error("Failed to update slot map:", error);
    }
  }

  /**
   * Execute command with automatic redirection handling
   */
  private async executeWithRedirection<T>(
    key: string,
    command: (client: RedisClientType) => Promise<T>,
  ): Promise<T> {
    let attempts = 0;
    let client = this.getClientForKey(key);

    while (attempts < this.config.maxRedirections) {
      try {
        return await command(client);
      } catch (error: any) {
        // Handle MOVED redirection
        if (error.message?.includes("MOVED")) {
          const [, , newHost, newPort] = error.message.split(" ");
          const newNodeId = `${newHost}:${newPort}`;
          const newClient = this.clients.get(newNodeId);

          if (newClient) {
            client = newClient;
            await this.updateSlotMap();
          }
        }
        // Handle ASK redirection
        else if (error.message?.includes("ASK")) {
          const [, , newHost, newPort] = error.message.split(" ");
          const newNodeId = `${newHost}:${newPort}`;
          const newClient = this.clients.get(newNodeId);

          if (newClient) {
            await newClient.sendCommand(["ASKING"]);
            client = newClient;
          }
        } else {
          throw error;
        }

        attempts++;
      }
    }

    throw new Error("Max redirections exceeded");
  }

  /**
   * Get value by key
   */
  async get(key: string): Promise<string | null> {
    return this.executeWithRedirection(key, (client) => client.get(key));
  }

  /**
   * Set value by key
   */
  async set(
    key: string,
    value: string,
    options?: { EX?: number },
  ): Promise<void> {
    await this.executeWithRedirection(key, (client) =>
      options?.EX
        ? client.setEx(key, options.EX, value)
        : client.set(key, value),
    );
  }

  /**
   * Delete key
   */
  async del(key: string): Promise<number> {
    return this.executeWithRedirection(key, (client) => client.del(key));
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<number> {
    return this.executeWithRedirection(key, (client) => client.exists(key));
  }

  /**
   * Set expiration on key
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    return this.executeWithRedirection(key, (client) =>
      client.expire(key, seconds),
    );
  }

  /**
   * Increment value
   */
  async incr(key: string): Promise<number> {
    return this.executeWithRedirection(key, (client) => client.incr(key));
  }

  /**
   * Batch operations within same slot (using hashtags)
   */
  async pipeline(
    operations: Array<{ key: string; op: string; args: any[] }>,
  ): Promise<any[]> {
    // Group operations by slot
    const slotGroups = new Map<number, typeof operations>();

    for (const operation of operations) {
      const slot = this.calculateSlot(operation.key);
      if (!slotGroups.has(slot)) {
        slotGroups.set(slot, []);
      }
      slotGroups.get(slot)!.push(operation);
    }

    // Execute pipelines per slot
    const results = await Promise.all(
      Array.from(slotGroups.values()).map(async (ops) => {
        const client = this.getClientForKey(ops[0].key);
        const multi = client.multi();

        for (const op of ops) {
          // @ts-ignore
          multi[op.op](...op.args);
        }

        return multi.exec();
      }),
    );

    return results.flat();
  }

  /**
   * Health check for all cluster nodes
   */
  async getClusterHealth(): Promise<ClusterHealth[]> {
    const health: ClusterHealth[] = [];

    for (const [nodeId, client] of this.clients.entries()) {
      try {
        const info: any = await client.info("memory");
        const [host, port] = nodeId.split(":");

        const usedMemory = this.parseInfoValue(info, "used_memory");
        const maxMemory =
          this.parseInfoValue(info, "maxmemory") || usedMemory * 2;

        health.push({
          nodeId,
          host,
          port: parseInt(port),
          role: "master", // Simplified
          connected: client.isReady,
          slots: Array.from(this.slotMap.entries())
            .filter(([, id]) => id === nodeId)
            .map(([slot]) => slot),
          memory: {
            used: usedMemory,
            max: maxMemory,
            percentage: (usedMemory / maxMemory) * 100,
          },
        });
      } catch (error) {
        console.error(`Health check failed for ${nodeId}:`, error);
      }
    }

    return health;
  }

  private parseInfoValue(info: string, key: string): number {
    const match = info.match(new RegExp(`${key}:(\\d+)`));
    return match ? parseInt(match[1]) : 0;
  }

  /**
   * Start periodic health checks
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      const health = await this.getClusterHealth();
      console.log("Cluster health:", JSON.stringify(health, null, 2));

      // Check for unhealthy nodes
      for (const node of health) {
        if (!node.connected) {
          console.warn(`Node ${node.nodeId} is disconnected`);
        }
        if (node.memory.percentage > 90) {
          console.warn(
            `Node ${node.nodeId} memory usage is high: ${node.memory.percentage.toFixed(2)}%`,
          );
        }
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Gracefully disconnect all clients
   */
  async disconnect(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    for (const [nodeId, client] of this.clients.entries()) {
      try {
        await client.quit();
        console.log(`Disconnected from ${nodeId}`);
      } catch (error) {
        console.error(`Error disconnecting from ${nodeId}:`, error);
      }
    }

    this.clients.clear();
    this.slotMap.clear();
  }
}

/**
 * Create Redis cluster client instance
 */
export function createRedisCluster(config: ClusterConfig): RedisClusterClient {
  return new RedisClusterClient(config);
}
