/**
 * agentContext.ts — Issue #1634
 *
 * Express middleware that exposes the request-scoped capability loader and a
 * token budget to downstream handlers. Both live on the request object, so
 * two requests can never observe each other's cached capabilities or spend.
 */

import {
  RequestScopedAgentLoader,
  type AgentCapability,
  type AgentLoaderOptions,
} from '../lib/agentLoader.js';

export interface TokenBudget {
  readonly limit: number;
  readonly spent: number;
  readonly remaining: number;
  spend(tokens: number): void;
}

export interface AgentRequestContext {
  readonly agentId: string;
  capabilities(): Promise<readonly AgentCapability[]>;
  budget: TokenBudget;
}

interface AgentRequest extends Record<string, unknown> {
  agentContext?: AgentRequestContext;
}

export interface AgentContextOptions extends AgentLoaderOptions {
  agentIdOf(req: AgentRequest): string | undefined;
  tokenLimit?: number;
}

const DEFAULT_TOKEN_LIMIT = 10_000;

function createBudget(limit: number): TokenBudget {
  let spent = 0;
  return {
    limit,
    get spent() {
      return spent;
    },
    get remaining() {
      return Math.max(0, limit - spent);
    },
    spend(tokens: number) {
      if (!Number.isFinite(tokens) || tokens < 0) {
        throw new Error('Token spend must be a non-negative number');
      }
      if (spent + tokens > limit) {
        throw new Error(`Agent token budget exceeded: ${spent + tokens} > ${limit}`);
      }
      spent += tokens;
    },
  };
}

/**
 * Installs `req.agentContext`. An unauthenticated request leaves it unset so
 * handlers can distinguish "no agent" from "agent with zero capabilities".
 */
export function agentContext(
  loader: RequestScopedAgentLoader,
  options: AgentContextOptions,
) {
  return (req: AgentRequest, _res: unknown, next: () => void): void => {
    const agentId = options.agentIdOf(req);
    if (agentId) {
      req.agentContext = {
        agentId,
        capabilities: () => loader.load(req, agentId),
        budget: createBudget(options.tokenLimit ?? DEFAULT_TOKEN_LIMIT),
      };
    }
    next();
  };
}

export function getAgentContext(req: AgentRequest): AgentRequestContext {
  if (!req.agentContext) {
    throw new Error('Agent context is not initialised for this request');
  }
  return req.agentContext;
}
