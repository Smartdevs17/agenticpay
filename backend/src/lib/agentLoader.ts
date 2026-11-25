/**
 * agentLoader.ts — Issue #1634
 *
 * Request-scoped batching/cache for agent capability lookups. Multiple
 * middleware layers in the same request often ask for the same agent's
 * capabilities; without this loader each layer triggers a fresh DB/RPC read.
 * The cache is keyed by the request object itself, so nothing leaks across
 * requests and no manual cleanup is required.
 */

export type CapabilityRisk = 'low' | 'medium' | 'high';

export interface AgentCapability {
  id: string;
  name: string;
  description?: string;
  risk: CapabilityRisk;
  costPerCall?: number;
}

/** Backend lookup seam; implement with Prisma, HTTP client, or a test fake. */
export interface CapabilitySource {
  load(agentId: string): Promise<readonly AgentCapability[]>;
}

export interface AgentLoaderLogEvent {
  event: 'agent.capabilities.load';
  agentId: string;
  cacheHit: boolean;
  durationMs: number;
}

export interface AgentLoaderOptions {
  logger?: (event: AgentLoaderLogEvent) => void;
}

function defaultLogger(event: AgentLoaderLogEvent): void {
  console.info(JSON.stringify(event));
}

export class RequestScopedAgentLoader {
  private readonly scopes = new WeakMap<object, Map<string, Promise<readonly AgentCapability[]>>>();

  constructor(
    private readonly source: CapabilitySource,
    private readonly logger: (event: AgentLoaderLogEvent) => void = defaultLogger,
  ) {}

  /**
   * Returns capabilities for `agentId`, sharing one lookup with every caller
   * in the same request. Rejections are removed so a later request can retry.
   */
  load(request: object, agentId: string): Promise<readonly AgentCapability[]> {
    let scope = this.scopes.get(request);
    if (!scope) {
      scope = new Map();
      this.scopes.set(request, scope);
    }

    const cached = scope.get(agentId);
    if (cached) return cached;

    const startedAt = Date.now();
    const promise = this.source.load(agentId).then(
      (capabilities) => {
        this.logger({
          event: 'agent.capabilities.load',
          agentId,
          cacheHit: false,
          durationMs: Date.now() - startedAt,
        });
        return capabilities;
      },
      (error: unknown) => {
        const currentScope = this.scopes.get(request);
        if (currentScope?.get(agentId) === promise) currentScope.delete(agentId);
        throw error;
      },
    );

    scope.set(agentId, promise);
    return promise;
  }

  /** Clears one request's cached promises. Usually unnecessary; useful in tests. */
  clear(request: object): void {
    this.scopes.delete(request);
  }
}
