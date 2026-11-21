/**
 * PII audit report endpoints (#668)
 *
 * GET /api/v1/pii/audit          - paginated PII detection log
 * GET /api/v1/pii/audit/report   - aggregate report by endpoint/piiType
 */
import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';

const router = Router();

// GET /api/v1/pii/audit
router.get('/audit', async (req: Request, res: Response) => {
  try {
    const { endpoint, piiType, tenantId, limit = '50', offset = '0' } =
      req.query as Record<string, string | undefined>;

    const where = {
      ...(endpoint ? { endpoint } : {}),
      ...(piiType ? { piiType } : {}),
      ...(tenantId ? { tenantId } : {}),
    };

    const take = Math.min(Number(limit) || 50, 200);
    const skip = Number(offset) || 0;

    const [logs, total] = await Promise.all([
      prisma.piiAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        select: {
          id: true,
          endpoint: true,
          method: true,
          fieldPath: true,
          piiType: true,
          action: true,
          level: true,
          tenantId: true,
          requestId: true,
          createdAt: true,
        },
      }),
      prisma.piiAuditLog.count({ where }),
    ]);

    res.json({ data: logs, total, limit: take, offset: skip });
  } catch {
    res.status(500).json({ error: 'Failed to fetch PII audit logs' });
  }
});

// GET /api/v1/pii/audit/report
router.get('/audit/report', async (_req: Request, res: Response) => {
  try {
    const [byEndpoint, byType] = await Promise.all([
      prisma.piiAuditLog.groupBy({
        by: ['endpoint', 'method'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 20,
      }),
      prisma.piiAuditLog.groupBy({
        by: ['piiType'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
    ]);

    res.json({
      data: {
        topEndpoints: byEndpoint.map((r) => ({
          endpoint: r.endpoint,
          method: r.method,
          detections: r._count.id,
        })),
        byPiiType: byType.map((r) => ({
          piiType: r.piiType,
          detections: r._count.id,
        })),
      },
    });
  } catch {
    res.status(500).json({ error: 'Failed to generate PII report' });
  }
});

export default router;
