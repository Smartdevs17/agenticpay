/**
 * PrismaReplicaClient — Issue #881
 *
 * Wraps a primary PrismaClient and one-or-more replica PrismaClients,
 * routing Prisma model operations transparently:
 *
 *   - write operations (create, update, upsert, delete, …) → primary
 *   - read operations (findUnique, findFirst, findMany, count, …)  → replica
 *     (with automatic fallback to primary when all replicas are unhealthy)
 *
 * Usage:
 *
 *   const client = new PrismaReplicaClient(primaryUrl, replicaUrls);
 *
 *   // Transparent model access (picks primary or replica automatically)
 *   const user = await client.proxy.user.findUnique({ where: { id } });
 *   await client.proxy.payment.create({ data: … });
 *
 *   // Explicit control
 *   const readClient  = client.getReadClient(sessionId?);
 *   const writeClient = client.getPrimaryClient();
 *
 *   // Lifecycle
 *   client.startHealthChecks();
 *   await client.disconnect();
 */

import { PrismaClient } from "@prisma/client";
import {
  ReadReplicaRouter,
  buildReplicaUrls,
  type ReadReplicaRouterOptions,
} from "../config/database.js";

// ── Prisma operation classification ─────────────────────────────────────────

/**
 * Prisma model operations that are safe to run on a read replica.
 * All other operations (create, update, upsert, delete, executeRaw*, …)
 * are routed to the primary.
 */
export const READ_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

export function isReadOperation(operation: string): boolean {
  return READ_OPERATIONS.has(operation);
}

// ── PrismaReplicaClient ──────────────────────────────────────────────────────

export interface PrismaReplicaClientOptions extends ReadReplicaRouterOptions {
  /**
   * If true the class runs a real PostgreSQL query against each replica to
   * measure actual WAL-replay lag and feed it into the router.
   * Defaults to false (lag probe is a no-op returning 0).
   */
  enableLagProbe?: boolean;
}

export class PrismaReplicaClient {
  private readonly primary: PrismaClient;
  private readonly replicaClients: Map<string, PrismaClient> = new Map();
  readonly router: ReadReplicaRouter;

  /** Transparent Proxy that routes model operations to the correct client. */
  readonly proxy: PrismaClient;

  constructor(
    primaryUrl: string = process.env.DATABASE_URL ?? "",
    replicaUrls: string[] = buildReplicaUrls(),
    router?: ReadReplicaRouter,
    options: PrismaReplicaClientOptions = {},
  ) {
    this.primary = new PrismaClient({
      datasources: { db: { url: primaryUrl } },
    });

    for (const url of replicaUrls) {
      this.replicaClients.set(
        url,
        new PrismaClient({ datasources: { db: { url } } }),
      );
    }

    if (router) {
      this.router = router;
    } else {
      const lagProbe = options.enableLagProbe
        ? this.buildLagProbe()
        : undefined;
      this.router = new ReadReplicaRouter(replicaUrls, primaryUrl, undefined, {
        ...options,
        lagProbe,
      });
    }

    this.proxy = this.buildProxy();
  }

  // ── Public helpers ──────────────────────────────────────────────────────────

  /**
   * Return the Prisma client for the next read, optionally pinned to a
   * session.  Falls back to primary when no healthy replica is available.
   */
  getReadClient(sessionId?: string): PrismaClient {
    const selection = this.router.select("SELECT 1", sessionId);
    if (selection.source === "replica") {
      return this.replicaClients.get(selection.url) ?? this.primary;
    }
    return this.primary;
  }

  /** Always returns the primary client (for writes or explicit primary reads). */
  getPrimaryClient(): PrismaClient {
    return this.primary;
  }

  /** Start background health-check polling.  Safe to call multiple times. */
  startHealthChecks(): void {
    this.router.startHealthChecks();
  }

  /** Stop background health-check polling (call on graceful shutdown). */
  stopHealthChecks(): void {
    this.router.stopHealthChecks();
  }

  /** Disconnect all PrismaClient instances. */
  async disconnect(): Promise<void> {
    await this.primary.$disconnect();
    await Promise.allSettled(
      [...this.replicaClients.values()].map((c) => c.$disconnect()),
    );
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Build a Proxy that intercepts model property accesses on PrismaClient.
   *
   * `client.proxy.user.findMany(…)` works exactly like a normal Prisma call,
   * but the underlying client is chosen per-operation at call time.
   */
  private buildProxy(): PrismaClient {
    const self = this;

    return new Proxy(this.primary, {
      get(target: PrismaClient, modelProp: string | symbol): unknown {
        // Pass through non-string or Prisma system props ($connect, $disconnect,
        // $transaction, Symbol.toPrimitive, etc.).
        if (
          typeof modelProp !== "string" ||
          modelProp.startsWith("$") ||
          modelProp.startsWith("_")
        ) {
          return Reflect.get(target, modelProp, target);
        }

        const primaryDelegate = Reflect.get(target, modelProp, target) as
          | Record<string, unknown>
          | undefined;
        if (!primaryDelegate || typeof primaryDelegate !== "object") {
          return primaryDelegate;
        }

        // Wrap the model delegate to intercept individual operations.
        return new Proxy(primaryDelegate, {
          get(modelTarget: Record<string, unknown>, opProp: string | symbol) {
            if (typeof opProp !== "string") {
              return Reflect.get(modelTarget, opProp, modelTarget);
            }

            const original = modelTarget[opProp];
            if (typeof original !== "function") {
              return Reflect.get(modelTarget, opProp, modelTarget);
            }

            return (...args: unknown[]) => {
              // Write operations always go to primary.
              if (!isReadOperation(opProp)) {
                return original.apply(modelTarget, args);
              }

              // Read: ask the router where to send this query.
              const selection = self.router.select("SELECT 1");
              if (selection.source === "primary") {
                return original.apply(modelTarget, args);
              }

              const replicaClient = self.replicaClients.get(selection.url);
              if (!replicaClient) {
                return original.apply(modelTarget, args);
              }

              const replicaDelegate = Reflect.get(
                replicaClient,
                modelProp,
                replicaClient,
              ) as Record<string, unknown> | undefined;

              if (!replicaDelegate) {
                return original.apply(modelTarget, args);
              }

              const replicaOp = replicaDelegate[opProp];
              if (typeof replicaOp !== "function") {
                return original.apply(modelTarget, args);
              }

              // Execute on replica; on failure, mark unhealthy and fall back.
              return (replicaOp.apply(replicaDelegate, args) as Promise<unknown>).catch(
                (err: unknown) => {
                  self.router.updateHealth(selection.url, { healthy: false });
                  console.warn(
                    `[PrismaReplicaClient] Replica ${selection.url} failed on ` +
                    `${String(modelProp)}.${opProp}, falling back to primary:`,
                    err,
                  );
                  return original.apply(modelTarget, args);
                },
              );
            };
          },
        });
      },
    });
  }

  /**
   * Build a lag-probe that queries pg_last_xact_replay_timestamp() on each
   * replica to measure actual WAL replay lag.
   */
  private buildLagProbe(): (url: string) => Promise<number> {
    return async (url: string): Promise<number> => {
      const client = this.replicaClients.get(url);
      if (!client) return 0;

      const rows = await client.$queryRaw<Array<{ lag_ms: number | null }>>`
        SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000 AS lag_ms
      `;
      const raw = rows[0]?.lag_ms;
      return typeof raw === "number" && !isNaN(raw) ? Math.max(0, raw) : 0;
    };
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance: PrismaReplicaClient | null = null;

/** Returns (or lazily creates) the application-wide PrismaReplicaClient. */
export function getPrismaReplicaClient(): PrismaReplicaClient {
  if (!_instance) {
    _instance = new PrismaReplicaClient();
  }
  return _instance;
}

/** Replace the singleton — useful in tests. */
export function setPrismaReplicaClient(client: PrismaReplicaClient | null): void {
  _instance = client;
}
