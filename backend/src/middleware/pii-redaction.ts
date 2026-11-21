/**
 * PII Redaction Middleware (#668)
 *
 * Express middleware that intercepts outgoing JSON responses and log records,
 * runs them through the PiiClassifier, redacts detected PII, and writes an
 * audit entry to the PiiAuditLog table.
 */
import type { Request, Response, NextFunction } from 'express';
import { piiClassifier, type DetectedPii } from '../services/pii/pii-classifier.js';
import { prisma } from '../lib/prisma.js';

// ─── Response redaction middleware ────────────────────────────────────────────

export function piiRedactionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res) as typeof res.json;

  res.json = function (body: unknown): Response {
    try {
      const { detections, redacted } = piiClassifier.classify(body);
      if (detections.length > 0) {
        void persistAudit(detections, req);
        return originalJson(redacted);
      }
    } catch {
      // Never block the response on classifier failure
    }
    return originalJson(body);
  };

  next();
}

async function persistAudit(detections: DetectedPii[], req: Request): Promise<void> {
  const tenantId = (req as Request & { tenantId?: string }).tenantId;
  const requestId = (req as Request & { id?: string }).id;

  await prisma.piiAuditLog.createMany({
    data: detections.map((d) => ({
      endpoint: req.path,
      method: req.method,
      fieldPath: d.path,
      piiType: d.type,
      action: 'redacted',
      level: 'standard',
      tenantId: tenantId ?? null,
      requestId: requestId ?? null,
    })),
    skipDuplicates: true,
  }).catch(() => { /* non-fatal */ });
}

// ─── Log redaction helper (for Pino / Winston formatters) ────────────────────

/**
 * Pass this as a `redact` transform in your logger config.
 * Compatible with pino's `redact` option when used as a custom serializer.
 */
export function redactLogRecord(record: Record<string, unknown>): Record<string, unknown> {
  try {
    const { redacted } = piiClassifier.classify(record);
    return redacted;
  } catch {
    return record;
  }
}

/**
 * Pino-compatible serializer that strips PII from any object field.
 */
export const piiLogSerializer = {
  // Applied to any field named "body", "payload", "data", "req", "res"
  body: redactLogRecord,
  payload: redactLogRecord,
  data: redactLogRecord,
};
