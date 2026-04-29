import { Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { FEDERATED_SCHEMA_SDL } from './schema.js';
import { enforceQueryCostLimit } from './plugins/cost-analysis/index.js';
import { persistedQueryRegistry } from './persisted-queries.js';
import { fiatPaymentsService } from '../services/fiat-payments.js';
import { projectsService } from '../services/projects.js';
import { paymentLinksService } from '../services/payment-links.js';

type GraphQLRequest = {
  query?: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  persistedQueryId?: string;
};

type Edge<T> = { cursor: string; node: T };

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function encodeCursor(index: number): string {
  return Buffer.from(`cursor:${index}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor?: string): number {
  if (!cursor) {
    return -1;
  }

  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const indexPart = decoded.split(':')[1];
    const index = Number(indexPart);
    return Number.isFinite(index) ? index : -1;
  } catch {
    return -1;
  }
}

function connectionFromArray<T>(nodes: T[], first?: number, after?: string): {
  edges: Edge<T>[];
  pageInfo: { endCursor: string | null; hasNextPage: boolean };
  totalCount: number;
} {
  const start = decodeCursor(after) + 1;
  const safeFirst = Math.min(Math.max(1, first || DEFAULT_LIMIT), MAX_LIMIT);
  const page = nodes.slice(start, start + safeFirst);
  const edges = page.map((node, idx) => ({ cursor: encodeCursor(start + idx), node }));
  const endCursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
  return {
    edges,
    pageInfo: {
      endCursor,
      hasNextPage: start + safeFirst < nodes.length,
    },
    totalCount: nodes.length,
  };
}

export const graphQLRouter = Router();
export const graphQLWsRouter = Router();

graphQLRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const graphiqlHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GraphiQL - AgenticPay</title>
  </head>
  <body style="margin:0;font-family:sans-serif;background:#0a1324;color:#edf2ff;">
    <main style="max-width:900px;margin:40px auto;padding:24px;background:#12203b;border-radius:14px;">
      <h1>GraphQL Gateway</h1>
      <p>POST queries to <code>/graphql</code> and subscribe to payment events at <code>/graphql/ws</code>.</p>
      <pre style="white-space:pre-wrap;background:#091024;padding:12px;border-radius:8px;">${FEDERATED_SCHEMA_SDL.replace(/</g, '&lt;')}</pre>
    </main>
  </body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(graphiqlHtml);
  })
);

graphQLRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body as GraphQLRequest;
    let query = body.query;
    const persistedQueryId = body.persistedQueryId;

    if (!query && persistedQueryId) {
      const persisted = persistedQueryRegistry.get(persistedQueryId);
      if (!persisted) {
        throw new AppError(404, 'Persisted query not found', 'PERSISTED_QUERY_NOT_FOUND');
      }
      query = persisted.query;
    }

    if (!query) {
      throw new AppError(400, 'GraphQL query is required', 'VALIDATION_ERROR');
    }

    const userKey = (req.headers.authorization as string) || req.ip || 'anonymous';
    const costDecision = enforceQueryCostLimit({
      query,
      userKey,
      persistedQueryId,
      options: {
        maxDepth: 12,
        maxNodeCount: 400,
        maxCost: 800,
        budgetPerWindow: {
          windowMs: 60_000,
          maxCost: 3000,
        },
        whitelist: {
          persistedQueryIds: persistedQueryRegistry.ids(),
        },
      },
    });

    if (!costDecision.ok) {
      throw new AppError(429, costDecision.error.message, costDecision.error.code, {
        cost: costDecision.result,
        remainingBudget: costDecision.remainingBudget,
      });
    }

    if (query.includes('registerPersistedQuery')) {
      const input = body.variables?.input as { id: string; query: string } | undefined;
      if (!input?.id || !input?.query) {
        throw new AppError(400, 'Mutation registerPersistedQuery requires variables.input.id and variables.input.query', 'VALIDATION_ERROR');
      }
      const stored = persistedQueryRegistry.register(input.id, input.query);
      return res.json({
        data: {
          registerPersistedQuery: {
            id: stored.id,
            registeredAt: stored.registeredAt,
          },
        },
      });
    }

    if (query.includes('federationSdl')) {
      return res.json({ data: { federationSdl: FEDERATED_SCHEMA_SDL } });
    }

    if (query.includes('paymentsConnection')) {
      const first = Number(body.variables?.first || DEFAULT_LIMIT);
      const after = typeof body.variables?.after === 'string' ? body.variables.after : undefined;
      const payments = fiatPaymentsService.listPayments();
      return res.json({ data: { paymentsConnection: connectionFromArray(payments, first, after) } });
    }

    if (query.includes('projectsConnection')) {
      const first = Number(body.variables?.first || DEFAULT_LIMIT);
      const after = typeof body.variables?.after === 'string' ? body.variables.after : undefined;
      const projects = projectsService.listProjects({ includeArchived: true });
      return res.json({ data: { projectsConnection: connectionFromArray(projects, first, after) } });
    }

    if (query.includes('paymentLinksConnection')) {
      const first = Number(body.variables?.first || DEFAULT_LIMIT);
      const after = typeof body.variables?.after === 'string' ? body.variables.after : undefined;
      const links = paymentLinksService.list({ includeExpired: true });
      return res.json({ data: { paymentLinksConnection: connectionFromArray(links, first, after) } });
    }

    res.json({ data: {} });
  })
);

graphQLWsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const emit = () => {
      const latest = fiatPaymentsService.listPayments()[0];
      if (latest) {
        const payload = {
          paymentEvents: {
            paymentId: latest.id,
            eventType: latest.status,
            timestamp: latest.updatedAt,
          },
        };
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ paymentEvents: null })}\n\n`);
      }
    };

    emit();
    const interval = setInterval(emit, 10_000);

    _req.on('close', () => {
      clearInterval(interval);
      res.end();
    });
  })
);