export type GraphQLCostResult = {
  cost: number;
  depth: number;
  nodeCount: number;
};

export type GraphQLCostLimitDecision =
  | { ok: true; result: GraphQLCostResult; remainingBudget?: number }
  | { ok: false; result: GraphQLCostResult; error: { code: string; message: string }; remainingBudget?: number };

export type GraphQLCostLimitOptions = {
  maxDepth: number;
  maxCost: number;
  maxNodeCount: number;
  budgetPerWindow?: {
    windowMs: number;
    maxCost: number;
  };
  whitelist?: {
    persistedQueryIds: Set<string>;
  };
};

const budgetStore = new Map<string, { resetAtMs: number; spentCost: number }>();

function estimateDepth(query: string): number {
  let depth = 0;
  let maxDepth = 0;
  for (const char of query) {
    if (char === '{') {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
    } else if (char === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  return maxDepth;
}

function estimateNodeCount(query: string): number {
  // Rough, parser-free heuristic: count field-like tokens.
  const stripped = query
    .replace(/#[^\n\r]*/g, '')
    .replace(/"([^"\\]|\\.)*"/g, '""')
    .replace(/\s+/g, ' ');
  const matches = stripped.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || [];
  return matches.length;
}

export function calculateQueryCost(query: string): GraphQLCostResult {
  const depth = estimateDepth(query);
  const nodeCount = estimateNodeCount(query);

  // Cost is tuned to penalize depth and selection volume without requiring schema metadata.
  const cost = Math.round(nodeCount + depth * depth * 5);
  return { cost, depth, nodeCount };
}

export function enforceQueryCostLimit(params: {
  query: string;
  userKey: string;
  options: GraphQLCostLimitOptions;
  persistedQueryId?: string;
}): GraphQLCostLimitDecision {
  if (params.persistedQueryId && params.options.whitelist?.persistedQueryIds.has(params.persistedQueryId)) {
    const result = calculateQueryCost(params.query);
    return { ok: true, result };
  }

  const result = calculateQueryCost(params.query);

  if (result.depth > params.options.maxDepth) {
    return {
      ok: false,
      result,
      error: { code: 'QUERY_DEPTH_LIMIT', message: `Query depth ${result.depth} exceeds limit ${params.options.maxDepth}` },
    };
  }

  if (result.nodeCount > params.options.maxNodeCount) {
    return {
      ok: false,
      result,
      error: {
        code: 'QUERY_NODE_LIMIT',
        message: `Query node count ${result.nodeCount} exceeds limit ${params.options.maxNodeCount}`,
      },
    };
  }

  if (result.cost > params.options.maxCost) {
    return {
      ok: false,
      result,
      error: { code: 'QUERY_COST_LIMIT', message: `Query cost ${result.cost} exceeds limit ${params.options.maxCost}` },
    };
  }

  const budget = params.options.budgetPerWindow;
  if (budget) {
    const now = Date.now();
    const existing = budgetStore.get(params.userKey);
    const state = !existing || existing.resetAtMs <= now ? { resetAtMs: now + budget.windowMs, spentCost: 0 } : existing;

    if (state.spentCost + result.cost > budget.maxCost) {
      const remainingBudget = Math.max(0, budget.maxCost - state.spentCost);
      return {
        ok: false,
        result,
        remainingBudget,
        error: { code: 'QUERY_BUDGET_EXCEEDED', message: 'Per-window query budget exceeded' },
      };
    }

    state.spentCost += result.cost;
    budgetStore.set(params.userKey, state);

    return { ok: true, result, remainingBudget: Math.max(0, budget.maxCost - state.spentCost) };
  }

  return { ok: true, result };
}

