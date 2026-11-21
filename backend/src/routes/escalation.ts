/**
 * Escalation Routes — Issue #646
 *
 * Complete CRUD API for escalation rules, SLA configurations,
 * escalation events, SLA breaches, and analytics.
 *
 * Base path: /api/v1/escalation
 */

import { Router } from 'express';
import { escalationService } from '../services/escalation/escalation.service.js';
import { slaTrackingService } from '../services/escalation/sla-tracking.service.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

export const escalationRouter = Router();

// ═══════════════════════════════════════════════════════════════════════════════
// Escalation Rules
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/escalation/rules
 * Create a new escalation rule
 */
escalationRouter.post(
  '/rules',
  asyncHandler(async (req, res) => {
    const rule = await escalationService.createRule({
      tenantId: req.tenantId || req.body.tenantId,
      ...req.body,
    });
    res.status(201).json({ data: rule });
  }),
);

/**
 * GET /api/v1/escalation/rules
 * List escalation rules for a tenant
 */
escalationRouter.get(
  '/rules',
  asyncHandler(async (req, res) => {
    const issueType = req.query.issueType as string | undefined;
    const rules = await escalationService.getRules(
      req.tenantId || req.query.tenantId as string,
      issueType as any,
    );
    res.json({ data: rules, count: rules.length });
  }),
);

/**
 * GET /api/v1/escalation/rules/:id
 * Get a single escalation rule
 */
escalationRouter.get(
  '/rules/:id',
  asyncHandler(async (req, res) => {
    const rules = await escalationService.getRules(req.tenantId || req.query.tenantId as string);
    const rule = rules.find((r) => r.id === req.params.id);
    if (!rule) throw new AppError(404, 'Escalation rule not found', 'RULE_NOT_FOUND');
    res.json({ data: rule });
  }),
);

/**
 * PUT /api/v1/escalation/rules/:id
 * Update an escalation rule
 */
escalationRouter.put(
  '/rules/:id',
  asyncHandler(async (req, res) => {
    await escalationService.updateRule(
      req.params.id,
      req.tenantId || req.body.tenantId,
      req.body,
    );
    // Fetch and return the updated rule
    const rules = await escalationService.getRules(req.tenantId || req.body.tenantId);
    const updated = rules.find((r) => r.id === req.params.id);
    res.json({ data: updated, message: 'Escalation rule updated' });
  }),
);

/**
 * DELETE /api/v1/escalation/rules/:id
 * Soft-delete an escalation rule
 */
escalationRouter.delete(
  '/rules/:id',
  asyncHandler(async (req, res) => {
    await escalationService.deleteRule(
      req.params.id,
      req.tenantId || req.body.tenantId,
    );
    res.json({ message: 'Escalation rule deleted' });
  }),
);

/**
 * POST /api/v1/escalation/rules/seed
 * Seed default escalation rules for a tenant
 */
escalationRouter.post(
  '/rules/seed',
  asyncHandler(async (req, res) => {
    const tenantId = req.tenantId || req.body.tenantId;
    if (!tenantId) throw new AppError(400, 'tenantId is required', 'MISSING_TENANT_ID');
    await escalationService.seedDefaultRules(tenantId);
    res.status(201).json({ message: 'Default escalation rules seeded' });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// SLA Configurations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/escalation/sla
 * List SLA configs for a tenant
 */
escalationRouter.get(
  '/sla',
  asyncHandler(async (req, res) => {
    const issueType = req.query.issueType as string | undefined;
    const slas = await slaTrackingService.getSLAs(
      req.tenantId || req.query.tenantId as string,
      issueType as any,
    );
    res.json({ data: slas, count: slas.length });
  }),
);

/**
 * PUT /api/v1/escalation/sla
 * Create or update an SLA configuration
 */
escalationRouter.put(
  '/sla',
  asyncHandler(async (req, res) => {
    const sla = await slaTrackingService.upsertSLA({
      tenantId: req.tenantId || req.body.tenantId,
      ...req.body,
    });
    res.json({ data: sla });
  }),
);

/**
 * DELETE /api/v1/escalation/sla/:id
 * Soft-delete an SLA config
 */
escalationRouter.delete(
  '/sla/:id',
  asyncHandler(async (req, res) => {
    await slaTrackingService.deleteSLA(
      req.params.id,
      req.tenantId || req.body.tenantId,
    );
    res.json({ message: 'SLA configuration deleted' });
  }),
);

/**
 * POST /api/v1/escalation/sla/check
 * Check SLA compliance for an issue
 */
escalationRouter.post(
  '/sla/check',
  asyncHandler(async (req, res) => {
    const { tenantId, issueId, issueType, severity, createdAt, lastResponseAt, resolvedAt } = req.body;

    if (!tenantId || !issueId || !issueType || !severity || !createdAt) {
      throw new AppError(400, 'Missing required fields', 'VALIDATION_ERROR');
    }

    const result = await slaTrackingService.checkSLA(
      tenantId,
      issueId,
      issueType,
      severity,
      {
        createdAt: new Date(createdAt),
        lastResponseAt: lastResponseAt ? new Date(lastResponseAt) : undefined,
        resolvedAt: resolvedAt ? new Date(resolvedAt) : undefined,
      },
    );

    res.json({ data: result });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// Escalation Events
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/escalation/events
 * List escalation events
 */
escalationRouter.get(
  '/events',
  asyncHandler(async (req, res) => {
    const { issueId, issueType, limit } = req.query;
    const events = await escalationService.getEvents(
      req.tenantId || req.query.tenantId as string,
      {
        issueId: issueId as string,
        issueType: issueType as any,
        limit: limit ? parseInt(limit as string, 10) : undefined,
      },
    );
    res.json({ data: events, count: events.length });
  }),
);

/**
 * GET /api/v1/escalation/events/:id
 * Get a single escalation event
 */
escalationRouter.get(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const event = await escalationService.getEvent(req.params.id);
    if (!event) throw new AppError(404, 'Escalation event not found', 'EVENT_NOT_FOUND');
    res.json({ data: event });
  }),
);

/**
 * POST /api/v1/escalation/events/:id/acknowledge
 * Acknowledge an escalation event
 */
escalationRouter.post(
  '/events/:id/acknowledge',
  asyncHandler(async (req, res) => {
    const event = await escalationService.acknowledgeEvent(
      req.params.id,
      req.body.acknowledgedBy || 'unknown',
    );
    res.json({ data: event });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// SLA Breaches
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/escalation/breaches
 * List SLA breaches
 */
escalationRouter.get(
  '/breaches',
  asyncHandler(async (req, res) => {
    const { issueId, issueType, status, limit } = req.query;
    const breaches = await slaTrackingService.getBreaches(
      req.tenantId || req.query.tenantId as string,
      {
        issueId: issueId as string,
        issueType: issueType as any,
        status: status as any,
        limit: limit ? parseInt(limit as string, 10) : undefined,
      },
    );
    res.json({ data: breaches, count: breaches.length });
  }),
);

/**
 * POST /api/v1/escalation/breaches/:id/resolve
 * Resolve an SLA breach
 */
escalationRouter.post(
  '/breaches/:id/resolve',
  asyncHandler(async (req, res) => {
    const breach = await slaTrackingService.resolveBreach(req.params.id);
    res.json({ data: breach });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// Escalation Evaluation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/escalation/evaluate
 * Evaluate whether an issue should be escalated
 */
escalationRouter.post(
  '/evaluate',
  asyncHandler(async (req, res) => {
    const { tenantId, issueId, issueType, severity, currentLevel, createdAt, lastResponseAt, resolvedAt, metadata } = req.body;

    if (!tenantId || !issueId || !issueType || !severity || !currentLevel || !createdAt) {
      throw new AppError(400, 'Missing required fields', 'VALIDATION_ERROR');
    }

    const result = await escalationService.evaluateEscalation({
      issueId,
      tenantId,
      issueType,
      severity,
      currentLevel,
      createdAt: new Date(createdAt),
      lastResponseAt: lastResponseAt ? new Date(lastResponseAt) : undefined,
      resolvedAt: resolvedAt ? new Date(resolvedAt) : undefined,
      metadata,
    });

    res.json({ data: result });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// Analytics
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/escalation/analytics
 * Get escalation analytics
 */
escalationRouter.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const { issueType, period, limit } = req.query;
    const analytics = await slaTrackingService.getAnalytics(
      req.tenantId || req.query.tenantId as string,
      {
        issueType: issueType as any,
        period: period as 'daily' | 'weekly' | 'monthly',
        limit: limit ? parseInt(limit as string, 10) : undefined,
      },
    );
    res.json({ data: analytics, count: analytics.length });
  }),
);

/**
 * POST /api/v1/escalation/analytics/aggregate
 * Trigger analytics aggregation
 */
escalationRouter.post(
  '/analytics/aggregate',
  asyncHandler(async (req, res) => {
    const tenantId = req.tenantId || req.body.tenantId;
    const period = (req.body.period || 'daily') as 'daily' | 'weekly' | 'monthly';

    if (!tenantId) throw new AppError(400, 'tenantId is required', 'MISSING_TENANT_ID');

    await slaTrackingService.aggregateAnalytics(tenantId, period);
    res.json({ message: `Analytics aggregated for ${period}` });
  }),
);

/**
 * GET /api/v1/escalation/dashboard
 * Dashboard summary with key metrics
 */
escalationRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const tenantId = req.tenantId || req.query.tenantId as string;

    if (!tenantId) throw new AppError(400, 'tenantId is required', 'MISSING_TENANT_ID');

    const [
      activeRules,
      slaConfigs,
      recentEvents,
      activeBreaches,
      analytics,
    ] = await Promise.all([
      escalationService.getRules(tenantId).then((r) => r.filter((x) => x.isActive)),
      slaTrackingService.getSLAs(tenantId),
      escalationService.getEvents(tenantId, { limit: 20 }),
      slaTrackingService.getBreaches(tenantId, { status: 'breached' }),
      slaTrackingService.getAnalytics(tenantId, { limit: 7 }),
    ]);

    const breachRate = analytics.length > 0
      ? analytics.reduce((sum, a) => sum + (100 - a.slaCompliancePct), 0) / analytics.length
      : 0;

    res.json({
      data: {
        summary: {
          activeRules: activeRules.length,
          slaConfigs: slaConfigs.length,
          totalEvents: recentEvents.length,
          activeBreaches: activeBreaches.length,
          averageBreachRate: Math.round(breachRate * 100) / 100,
        },
        recentEvents,
        activeBreaches,
        analytics: analytics.slice(0, 7),
      },
    });
  }),
);
