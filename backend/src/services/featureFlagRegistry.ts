/**
 * featureFlagRegistry.ts — Persistent feature-flag service.
 *
 * Database-backed feature flags with targeting rules, gradual rollout,
 * A/B experiments, exposure analytics, and stale-flag detection.
 *
 * Distinct from the legacy in-memory `featureFlags` registry in
 * `./featureFlags.ts` — the two coexist: legacy is used by the
 * `/api/v1/flags` mount while this service powers `/api/v1/feature-flags`.
 *
 * Design notes:
 *  - Hot path uses in-process LRU + deterministic MD5-bucket hashing so
 *    repeated calls for the same identifier return the same result.
 *  - Exposure recording is fire-and-forget (`setImmediate`) so
 *    evaluation latency stays < 1 ms p99.
 *  - Rules are evaluated in priority DESC order; first enabled match wins.
 *  - Gradual rollouts mutate the flag's percentage rule on each tick.
 */

import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const TargetingRuleSchema = z.object({
  type: z.enum(['percentage', 'user_segment', 'environment', 'user_attribute', 'allowlist']),
  priority: z.number().int().min(0).default(0),
  conditions: z.record(z.unknown()),
  enabled: z.boolean().default(true),
});

export const CreateFlagSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'key must be kebab-case').min(1).max(64),
  name: z.string().min(1).max(128),
  description: z.string().max(500).optional(),
  type: z.enum(['boolean', 'string', 'number', 'json']).default('boolean'),
  defaultValue: z.unknown(),
  status: z.enum(['draft', 'active', 'paused', 'archived']).default('draft'),
  environment: z.string().default('all'),
  ownerEmail: z.string().email().optional(),
  expiresAt: z.coerce.date().optional(),
  rules: z.array(TargetingRuleSchema).optional(),
});

export const UpdateFlagSchema = CreateFlagSchema.partial().omit({ key: true, rules: true }).extend({
  rules: z.array(TargetingRuleSchema).optional(),
});

export const CreateScheduleSchema = z.object({
  startPercentage: z.number().int().min(0).max(100),
  endPercentage: z.number().int().min(0).max(100),
  incrementPercent: z.number().int().min(1).max(100),
  incrementInterval: z.string().min(1),
});

export const CreateExperimentSchema = z.object({
  name: z.string().min(1).max(128),
  hypothesis: z.string().max(500).optional(),
  primaryMetric: z.string().max(64).optional(),
  variants: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        name: z.string().min(1).max(128),
        value: z.unknown(),
        bucketWeight: z.number().int().min(0).max(100),
        isControl: z.boolean().optional(),
      }),
    )
    .min(2),
});

export type CreateFlagInput = z.infer<typeof CreateFlagSchema>;

// ─── Public types ────────────────────────────────────────────────────────────

export interface FlagEvaluationContext {
  identifier: string;
  environment?: string;
  attributes?: Record<string, unknown>;
}

export type FlagEvaluationReason =
  | 'rule_match'
  | 'default'
  | 'archived'
  | 'disabled'
  | 'environment_mismatch'
  | 'not_found';

export interface FlagEvaluationResult<T = unknown> {
  key: string;
  value: T;
  reason: FlagEvaluationReason;
  ruleId?: string;
  variant?: string;
}

// ─── LRU in-process cache ────────────────────────────────────────────────────

class LRUCache<K, V> {
  private readonly map = new Map<K, { value: V; expiresAt: number }>();

  constructor(private readonly maxSize: number, private readonly ttlMs: number) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    if (this.map.size > this.maxSize) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

interface FlagRecord {
  id: string;
  tenantId: string;
  key: string;
  type: string;
  defaultValue: unknown;
  status: string;
  environment: string;
  archivedAt: Date | null;
  rules: Array<{
    id: string;
    type: string;
    priority: number;
    enabled: boolean;
    conditions: Prisma.JsonValue;
  }>;
}

const FLAG_CACHE = new LRUCache<string, FlagRecord>(5_000, 60_000); // 1 min
const EVAL_CACHE = new LRUCache<string, FlagEvaluationResult>(10_000, 30_000); // 30 s
const TENANT = process.env.FF_DEFAULT_TENANT ?? 'default';

// ─── Hash helpers ────────────────────────────────────────────────────────────

function hashToBucket(input: string, divisor: number): number {
  const hash = createHash('md5').update(input).digest();
  return hash.readUInt32BE(0) % divisor;
}

function evalCacheKey(flagKey: string, ctx: FlagEvaluationContext): string {
  const attrHash = ctx.attributes
    ? createHash('md5').update(JSON.stringify(ctx.attributes)).digest('hex').slice(0, 16)
    : '-';
  const env = ctx.environment ?? 'all';
  return `flag:${flagKey}|env:${env}|id:${ctx.identifier}|attrs:${attrHash}`;
}

function compareAttribute(op: string, actual: unknown, target: unknown): boolean {
  switch (op) {
    case 'eq':
      return actual === target;
    case 'neq':
      return actual !== target;
    case 'in':
      return Array.isArray(target) && (target as unknown[]).includes(actual);
    case 'not_in':
      return Array.isArray(target) && !(target as unknown[]).includes(actual);
    case 'gt':
      return typeof actual === 'number' && typeof target === 'number' && (actual as number) > (target as number);
    case 'gte':
      return typeof actual === 'number' && typeof target === 'number' && (actual as number) >= (target as number);
    case 'lt':
      return typeof actual === 'number' && typeof target === 'number' && (actual as number) < (target as number);
    case 'lte':
      return typeof actual === 'number' && typeof target === 'number' && (actual as number) <= (target as number);
    case 'contains':
      return typeof actual === 'string' && typeof target === 'string' && (actual as string).includes(target);
    case 'starts_with':
      return typeof actual === 'string' && typeof target === 'string' && (actual as string).startsWith(target);
    case 'exists':
      return actual !== undefined && actual !== null;
    default:
      return false;
  }
}

// ─── Rule evaluation ─────────────────────────────────────────────────────────

async function evaluateRule(
  rule: FlagRecord['rules'][number],
  flag: FlagRecord,
  ctx: FlagEvaluationContext,
  segmentResolver: (id: string, ctx: FlagEvaluationContext) => Promise<boolean>,
): Promise<{ matched: boolean; value: unknown }> {
  if (!rule.enabled) return { matched: false, value: undefined };

  switch (rule.type) {
    case 'allowlist': {
      const ids = Array.isArray((rule.conditions as { identifiers?: unknown })?.identifiers)
        ? ((rule.conditions as { identifiers: unknown[] }).identifiers as string[])
        : [];
      return { matched: ids.includes(ctx.identifier), value: true };
    }
    case 'percentage': {
      const pct = Math.max(0, Math.min(100, Number((rule.conditions as { percentage?: number })?.percentage ?? 0)));
      const bucket = hashToBucket(`${flag.key}:${ctx.identifier}`, 100);
      return { matched: bucket < pct, value: true };
    }
    case 'environment': {
      const envs = Array.isArray((rule.conditions as { environments?: unknown })?.environments)
        ? ((rule.conditions as { environments: unknown[] }).environments as string[])
        : [];
      const matched =
        !!ctx.environment && (envs.includes(ctx.environment) || envs.includes('all'));
      return { matched, value: true };
    }
    case 'user_segment': {
      const segmentId = (rule.conditions as { segmentId?: string })?.segmentId;
      if (!segmentId) return { matched: false, value: undefined };
      const matched = await segmentResolver(segmentId, ctx);
      const variantValue =
        (rule.conditions as { variantValue?: unknown })?.variantValue ?? flag.defaultValue;
      return { matched, value: variantValue };
    }
    case 'user_attribute': {
      const attr = String((rule.conditions as { attribute?: string })?.attribute ?? '');
      const op = String((rule.conditions as { operator?: string })?.operator ?? 'eq');
      const target = (rule.conditions as { value?: unknown })?.value;
      const actual = ctx.attributes?.[attr];
      const matched = compareAttribute(op, actual, target);
      const variantValue =
        (rule.conditions as { variantValue?: unknown })?.variantValue ?? flag.defaultValue;
      return { matched, value: variantValue };
    }
    default:
      return { matched: false, value: undefined };
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class FeatureFlagRegistry {
  invalidateCache(flagKey?: string): void {
    if (flagKey) {
      FLAG_CACHE.delete(`flag:${flagKey}`);
      EVAL_CACHE.clear();
    } else {
      FLAG_CACHE.clear();
      EVAL_CACHE.clear();
    }
  }

  // ── Flag CRUD ────────────────────────────────────────────────────────────

  async createFlag(input: CreateFlagInput, actor: string, tenantId: string = TENANT): Promise<FlagRecord> {
    const parsed = CreateFlagSchema.parse(input);
    const flag = await prisma.$transaction(async (tx) => {
      const created = await tx.featureFlag.create({
        data: {
          tenantId,
          key: parsed.key,
          name: parsed.name,
          description: parsed.description ?? null,
          type: parsed.type,
          defaultValue: parsed.defaultValue as Prisma.InputJsonValue,
          status: parsed.status,
          environment: parsed.environment,
          ownerEmail: parsed.ownerEmail ?? null,
          expiresAt: parsed.expiresAt ?? null,
        },
      });
      if (parsed.rules && parsed.rules.length) {
        await tx.featureFlagRule.createMany({
          data: [...parsed.rules]
            .sort((a, b) => b.priority - a.priority)
            .map((rule) => ({
              flagId: created.id,
              type: rule.type,
              priority: rule.priority,
              conditions: rule.conditions as Prisma.InputJsonValue,
              enabled: rule.enabled,
            })),
        });
      }
      await tx.featureFlagAuditLog.create({
        data: {
          flagId: created.id,
          actor,
          action: 'created',
          after: { key: parsed.key, status: parsed.status } as Prisma.InputJsonValue,
        },
      });
      return tx.featureFlag.findUnique({
        where: { id: created.id },
        include: { rules: { orderBy: { priority: 'desc' } } },
      });
    });
    if (!flag) throw new Error('flag_create_failed');
    FLAG_CACHE.delete(`flag:${parsed.key}`);
    return flag as unknown as FlagRecord;
  }

  async listFlags(
    opts: { tenantId?: string; status?: string; environment?: string; limit?: number; offset?: number } = {},
  ): Promise<{ flags: FlagRecord[]; total: number; limit: number; offset: number }> {
    const tenantId = opts.tenantId ?? TENANT;
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const where: Prisma.FeatureFlagWhereInput = { tenantId, archivedAt: null };
    if (opts.status) where.status = opts.status as Prisma.FeatureFlagWhereInput['status'];
    if (opts.environment) {
      const envFilter: Prisma.StringFilter = { in: [opts.environment, 'all'] };
      where.environment = envFilter;
    }
    const [flags, total] = await Promise.all([
      prisma.featureFlag.findMany({
        where,
        take: limit,
        skip: offset,
        include: { rules: { orderBy: { priority: 'desc' } } },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.featureFlag.count({ where }),
    ]);
    return { flags: flags as unknown as FlagRecord[], total, limit, offset };
  }

  async getFlagByKey(key: string, opts: { includeRules?: boolean; tenantId?: string } = {}): Promise<FlagRecord | null> {
    const tenantId = opts.tenantId ?? TENANT;
    const cacheKey = `flag:${tenantId}:${key}`;
    const cached = FLAG_CACHE.get(cacheKey);
    if (
      cached &&
      cached.id &&
      cached.tenantId === tenantId &&
      (!opts.includeRules || cached.rules)
    ) {
      return cached;
    }
    const flag = await prisma.featureFlag.findFirst({
      where: { key, tenantId, archivedAt: null },
      include: { rules: opts.includeRules ? { orderBy: { priority: 'desc' } } : false },
    });
    if (flag) FLAG_CACHE.set(cacheKey, flag as unknown as FlagRecord);
    return (flag as unknown as FlagRecord) ?? null;
  }

  async updateFlag(
    key: string,
    updates: z.infer<typeof UpdateFlagSchema>,
    actor: string,
    tenantId: string = TENANT,
  ): Promise<FlagRecord> {
    const flag = await prisma.$transaction(async (tx) => {
      const existing = await tx.featureFlag.findFirst({ where: { key, tenantId, archivedAt: null } });
      if (!existing) throw new Error(`flag_not_found:${key}`);
      const updated = await tx.featureFlag.update({
        where: { id: existing.id },
        data: {
          name: updates.name ?? existing.name,
          description: updates.description ?? existing.description,
          defaultValue:
            updates.defaultValue !== undefined
              ? (updates.defaultValue as Prisma.InputJsonValue)
              : (existing.defaultValue as Prisma.InputJsonValue),
          status: (updates.status as Prisma.FeatureFlagUpdateInput['status']) ?? existing.status,
          environment: updates.environment ?? existing.environment,
          ownerEmail: updates.ownerEmail ?? existing.ownerEmail,
          expiresAt: updates.expiresAt ?? existing.expiresAt,
          version: { increment: 1 },
        },
      });
      if (updates.rules) {
        await tx.featureFlagRule.deleteMany({ where: { flagId: existing.id } });
        if (updates.rules.length) {
          await tx.featureFlagRule.createMany({
            data: [...updates.rules]
              .sort((a, b) => b.priority - a.priority)
              .map((rule) => ({
                flagId: existing.id,
                type: rule.type,
                priority: rule.priority,
                conditions: rule.conditions as Prisma.InputJsonValue,
                enabled: rule.enabled,
              })),
          });
        }
      }
      await tx.featureFlagAuditLog.create({
        data: {
          flagId: existing.id,
          actor,
          action: 'updated',
          before: { status: existing.status } as Prisma.InputJsonValue,
          after: { status: updated.status } as Prisma.InputJsonValue,
        },
      });
      return tx.featureFlag.findUnique({
        where: { id: existing.id },
        include: { rules: { orderBy: { priority: 'desc' } } },
      });
    });
    if (!flag) throw new Error('flag_update_failed');
    FLAG_CACHE.delete(`flag:${key}`);
    EVAL_CACHE.clear();
    return flag as unknown as FlagRecord;
  }

  async deleteFlag(
    key: string,
    actor: string,
    opts: { hard?: boolean; tenantId?: string } = {},
  ): Promise<void> {
    const tenantId = opts.tenantId ?? TENANT;
    const existing = await prisma.featureFlag.findFirst({ where: { key, tenantId } });
    if (!existing) throw new Error(`flag_not_found:${key}`);
    if (opts.hard) {
      await prisma.featureFlag.delete({ where: { id: existing.id } });
    } else {
      await prisma.featureFlag.update({
        where: { id: existing.id },
        data: { status: 'archived', archivedAt: new Date() },
      });
      await prisma.featureFlagAuditLog.create({
        data: {
          flagId: existing.id,
          actor,
          action: 'archived',
          before: { status: existing.status } as Prisma.InputJsonValue,
        },
      });
    }
    FLAG_CACHE.delete(`flag:${key}`);
    EVAL_CACHE.clear();
  }

  async addRule(
    flagKey: string,
    rule: z.infer<typeof TargetingRuleSchema>,
    actor: string,
    tenantId: string = TENANT,
  ): Promise<{ id: string }> {
    const flag = await this.getFlagByKey(flagKey, { tenantId });
    if (!flag) throw new Error(`flag_not_found:${flagKey}`);
    const created = await prisma.featureFlagRule.create({
      data: {
        flagId: flag.id,
        type: rule.type,
        priority: rule.priority,
        conditions: rule.conditions as Prisma.InputJsonValue,
        enabled: rule.enabled,
      },
    });
    await prisma.featureFlagAuditLog.create({
      data: {
        flagId: flag.id,
        actor,
        action: 'rule_added',
        after: { ruleId: created.id, type: rule.type } as Prisma.InputJsonValue,
      },
    });
    FLAG_CACHE.delete(`flag:${flagKey}`);
    EVAL_CACHE.clear();
    return { id: created.id };
  }

  async removeRule(ruleId: string, actor: string): Promise<void> {
    const rule = await prisma.featureFlagRule.findUnique({ where: { id: ruleId } });
    if (!rule) return;
    await prisma.featureFlagRule.delete({ where: { id: ruleId } });
    const flag = await prisma.featureFlag.findUnique({ where: { id: rule.flagId } });
    if (flag) {
      await prisma.featureFlagAuditLog.create({
        data: {
          flagId: rule.flagId,
          actor,
          action: 'rule_removed',
          before: { ruleId, type: rule.type } as Prisma.InputJsonValue,
        },
      });
      FLAG_CACHE.delete(`flag:${flag.key}`);
    }
    EVAL_CACHE.clear();
  }

  // ── Segments ─────────────────────────────────────────────────────────────

  async createSegment(input: {
    tenantId?: string;
    name: string;
    description?: string;
    conditions: Array<{ attribute: string; operator?: string; value?: unknown }>;
    matchType?: 'all' | 'any';
  }): Promise<{ id: string; name: string }> {
    const created = await prisma.userSegment.create({
      data: {
        tenantId: input.tenantId ?? TENANT,
        name: input.name,
        description: input.description ?? null,
        conditions: input.conditions as Prisma.InputJsonValue,
        matchType: input.matchType ?? 'all',
      },
    });
    return { id: created.id, name: created.name };
  }

  async listSegments(tenantId?: string): Promise<Array<{ id: string; name: string; description: string | null }>> {
    const rows = await prisma.userSegment.findMany({
      where: { tenantId: tenantId ?? TENANT, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, description: true },
    });
    return rows;
  }

  private async evaluateSegment(
    segmentId: string,
    ctx: FlagEvaluationContext,
  ): Promise<boolean> {
    const seg = await prisma.userSegment.findUnique({ where: { id: segmentId } });
    if (!seg) return false;
    const conds = Array.isArray(seg.conditions) ? (seg.conditions as Array<{ attribute: string; operator?: string; value?: unknown }>) : [];
    const results = conds.map((c) => {
      const op = c.operator ?? 'eq';
      return compareAttribute(op, ctx.attributes?.[c.attribute], c.value);
    });
    return seg.matchType === 'any' ? results.some(Boolean) : results.every(Boolean);
  }

  // ── Schedules (gradual rollout) ──────────────────────────────────────────

  async createSchedule(
    input: z.infer<typeof CreateScheduleSchema> & { flagKey: string; createdBy: string; tenantId?: string },
  ): Promise<{ id: string; status: string }> {
    if (input.startPercentage > input.endPercentage) throw new Error('invalid_percentage_range');
    const flag = await this.getFlagByKey(input.flagKey, { tenantId: input.tenantId });
    if (!flag) throw new Error(`flag_not_found:${input.flagKey}`);
    const created = await prisma.rolloutSchedule.create({
      data: {
        flagId: flag.id,
        startPercentage: input.startPercentage,
        endPercentage: input.endPercentage,
        currentPercentage: input.startPercentage,
        incrementPercent: input.incrementPercent,
        incrementInterval: input.incrementInterval,
        status: 'pending',
        createdBy: input.createdBy,
      },
    });
    return { id: created.id, status: created.status };
  }

  async startSchedule(scheduleId: string): Promise<{ id: string; status: string }> {
    const sched = await prisma.rolloutSchedule.findUnique({ where: { id: scheduleId } });
    if (!sched) throw new Error('schedule_not_found');
    const next = new Date(Date.now() + 60_000);
    const updated = await prisma.rolloutSchedule.update({
      where: { id: scheduleId },
      data: { status: 'active', startedAt: new Date(), nextIncrementAt: next },
    });
    await this.applySchedulePercentage(sched.flagId, sched.currentPercentage);
    return { id: updated.id, status: updated.status };
  }

  async pauseSchedule(scheduleId: string, reason: string): Promise<{ id: string; status: string }> {
    const updated = await prisma.rolloutSchedule.update({
      where: { id: scheduleId },
      data: { status: 'paused', pausedReason: reason },
    });
    return { id: updated.id, status: updated.status };
  }

  async resumeSchedule(scheduleId: string): Promise<{ id: string; status: string }> {
    const updated = await prisma.rolloutSchedule.update({
      where: { id: scheduleId },
      data: { status: 'active', pausedReason: null, nextIncrementAt: new Date(Date.now() + 60_000) },
    });
    return { id: updated.id, status: updated.status };
  }

  async runScheduledRollouts(now: Date = new Date()): Promise<number> {
    const due = await prisma.rolloutSchedule.findMany({
      where: { status: 'active', nextIncrementAt: { lte: now } },
      include: { flag: true },
    });
    let applied = 0;
    for (const sched of due) {
      const newPct = Math.min(sched.endPercentage, sched.currentPercentage + sched.incrementPercent);
      if (newPct === sched.currentPercentage) {
        await prisma.rolloutSchedule.update({
          where: { id: sched.id },
          data: { status: 'completed', completedAt: now },
        });
        continue;
      }
      await prisma.$transaction([
        prisma.featureFlagRule.deleteMany({ where: { flagId: sched.flagId, type: 'percentage' } }),
        prisma.featureFlagRule.create({
          data: {
            flagId: sched.flagId,
            type: 'percentage',
            priority: 10,
            conditions: { percentage: newPct } as Prisma.InputJsonValue,
            enabled: true,
          },
        }),
        prisma.rolloutSchedule.update({
          where: { id: sched.id },
          data: { currentPercentage: newPct, nextIncrementAt: addDuration(sched.incrementInterval, now) },
        }),
      ]);
      FLAG_CACHE.delete(`flag:${sched.flag.key}`);
      EVAL_CACHE.clear();
      applied++;
    }
    return applied;
  }

  private async applySchedulePercentage(flagId: string, percentage: number): Promise<void> {
    await prisma.$transaction([
      prisma.featureFlagRule.deleteMany({ where: { flagId, type: 'percentage' } }),
      prisma.featureFlagRule.create({
        data: {
          flagId,
          type: 'percentage',
          priority: 10,
          conditions: { percentage } as Prisma.InputJsonValue,
          enabled: true,
        },
      }),
    ]);
  }

  // ── A/B experiments ─────────────────────────────────────────────────────

  async createExperiment(
    input: z.infer<typeof CreateExperimentSchema> & { flagKey: string; createdBy: string; tenantId?: string },
  ): Promise<{ id: string; variants: Array<{ id: string; key: string }> }> {
    const flag = await this.getFlagByKey(input.flagKey, { tenantId: input.tenantId });
    if (!flag) throw new Error(`flag_not_found:${input.flagKey}`);
    const totalWeight = input.variants.reduce((s, v) => s + v.bucketWeight, 0);
    if (totalWeight !== 100) throw new Error('variant_weights_must_sum_to_100');
    const created = await prisma.experiment.create({
      data: {
        flagId: flag.id,
        name: input.name,
        hypothesis: input.hypothesis ?? null,
        status: 'draft',
        primaryMetric: input.primaryMetric ?? null,
        createdBy: input.createdBy,
        variants: {
          create: input.variants.map((v) => ({
            key: v.key,
            name: v.name,
            value: v.value as Prisma.InputJsonValue,
            bucketWeight: v.bucketWeight,
            isControl: v.isControl ?? false,
          })),
        },
      },
      include: { variants: true },
    });
    return {
      id: created.id,
      variants: created.variants.map((v) => ({ id: v.id, key: v.key })),
    };
  }

  async startExperiment(experimentId: string): Promise<{ id: string; status: string }> {
    const updated = await prisma.experiment.update({
      where: { id: experimentId },
      data: { status: 'running', startedAt: new Date() },
    });
    return { id: updated.id, status: updated.status };
  }

  async abortExperiment(experimentId: string, reason: string): Promise<{ id: string; status: string }> {
    const updated = await prisma.experiment.update({
      where: { id: experimentId },
      data: { status: 'aborted', endedAt: new Date(), hypothesis: reason },
    });
    return { id: updated.id, status: updated.status };
  }

  async assignVariant(
    experimentId: string,
    identifier: string,
  ): Promise<{ variant: { id: string; key: string; value: unknown }; assignment: { id: string } }> {
    const existing = await prisma.experimentAssignment.findUnique({
      where: { experimentId_identifier: { experimentId, identifier } },
      include: { variant: true },
    });
    if (existing) {
      return {
        variant: { id: existing.variant.id, key: existing.variant.key, value: existing.variant.value },
        assignment: { id: existing.id },
      };
    }
    const variants = await prisma.experimentVariant.findMany({
      where: { experimentId },
      orderBy: { key: 'asc' },
    });
    if (!variants.length) throw new Error('experiment_has_no_variants');
    const cumulative: Array<{ v: (typeof variants)[number]; upper: number }> = [];
    let acc = 0;
    for (const v of variants) {
      acc += v.bucketWeight;
      cumulative.push({ v, upper: acc });
    }
    const bucket = hashToBucket(`${experimentId}:${identifier}`, 100) + 1; // 1..100
    const chosen =
      cumulative.find((c) => bucket <= c.upper) ?? cumulative[cumulative.length - 1];
    const assignment = await prisma.experimentAssignment.create({
      data: { experimentId, variantId: chosen.v.id, identifier },
    });
    return {
      variant: { id: chosen.v.id, key: chosen.v.key, value: chosen.v.value },
      assignment: { id: assignment.id },
    };
  }

  async recordExposure(experimentId: string, identifier: string): Promise<void> {
    await prisma.experimentAssignment.updateMany({
      where: { experimentId, identifier, exposed: false },
      data: { exposed: true, firstExposedAt: new Date() },
    });
  }

  async getExperimentResults(experimentId: string): Promise<
    Array<{
      key: string;
      name: string;
      isControl: boolean;
      bucketWeight: number;
      totalAssignments: number;
      exposedAssignments: number;
      exposureRate: number;
    }>
  > {
    const variants = await prisma.experimentVariant.findMany({
      where: { experimentId },
      include: { assignments: { select: { id: true, exposed: true } } },
    });
    return variants.map((v) => ({
      key: v.key,
      name: v.name,
      isControl: v.isControl,
      bucketWeight: v.bucketWeight,
      totalAssignments: v.assignments.length,
      exposedAssignments: v.assignments.filter((a) => a.exposed).length,
      exposureRate: v.assignments.length === 0 ? 0 : v.assignments.filter((a) => a.exposed).length / v.assignments.length,
    }));
  }

  // ── Analytics ────────────────────────────────────────────────────────────

  async recordExposureEvent(flagId: string, ctx: FlagEvaluationContext, value: unknown): Promise<void> {
    try {
      await prisma.flagExposure.create({
        data: {
          flagId,
          identifier: ctx.identifier,
          environment: ctx.environment ?? 'unknown',
          value: value as Prisma.InputJsonValue,
          source: 'server',
          userAgent:
            typeof ctx.attributes?.['userAgent'] === 'string'
              ? (ctx.attributes['userAgent'] as string)
              : null,
        },
      });
    } catch (err) {
      logger.warn({ err, flagId }, 'flag_exposure_record_failed');
    }
  }

  async getAnalytics(
    flagKey: string,
    opts: { since?: Date; windowHours?: number; tenantId?: string } = {},
  ): Promise<{
    flagKey: string;
    windowSince: Date;
    totalEvaluations: number;
    uniqueIdentifiers: number;
    trueCount: number;
    falseCount: number;
    exposuresByEnvironment: Record<string, number>;
  }> {
    const flag = await this.getFlagByKey(flagKey, { tenantId: opts.tenantId });
    if (!flag) throw new Error(`flag_not_found:${flagKey}`);
    const since = opts.since ?? new Date(Date.now() - (opts.windowHours ?? 24) * 3_600_000);
    const exposures = await prisma.flagExposure.findMany({
      where: { flagId: flag.id, createdAt: { gte: since } },
      select: { identifier: true, value: true, environment: true },
    });
    const uniqueIds = new Set(exposures.map((e) => e.identifier)).size;
    const trueCount = exposures.filter((e) => Boolean(e.value)).length;
    const falseCount = exposures.length - trueCount;
    const byEnv: Record<string, number> = {};
    for (const e of exposures) byEnv[e.environment] = (byEnv[e.environment] ?? 0) + 1;
    return {
      flagKey,
      windowSince: since,
      totalEvaluations: exposures.length,
      uniqueIdentifiers: uniqueIds,
      trueCount,
      falseCount,
      exposuresByEnvironment: byEnv,
    };
  }

  async detectStaleFlags(
    opts: { staleAfterDays?: number; includeUnowned?: boolean; tenantId?: string } = {},
  ): Promise<Array<{ flag: { id: string; key: string; ownerEmail: string | null; expiresAt: Date | null }; lastExposed: Date | null }>> {
    const staleAfterDays = opts.staleAfterDays ?? 30;
    const cutoff = new Date(Date.now() - staleAfterDays * 86_400_000);
    const tenantId = opts.tenantId ?? TENANT;
    const candidates = await prisma.featureFlag.findMany({
      where: {
        tenantId,
        status: 'active',
        archivedAt: null,
        OR: [
          { expiresAt: { lt: new Date() } },
          ...(opts.includeUnowned ? [{ ownerEmail: null }] : []),
        ],
      },
      select: { id: true, key: true, ownerEmail: true, expiresAt: true },
    });
    const stale: Array<{ flag: typeof candidates[number]; lastExposed: Date | null }> = [];
    for (const flag of candidates) {
      const last = await prisma.flagExposure.findFirst({
        where: { flagId: flag.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (!last || last.createdAt < cutoff) {
        stale.push({ flag, lastExposed: last?.createdAt ?? null });
      }
    }
    return stale;
  }

  async listAuditLogs(
    flagKey: string,
    opts: { limit?: number; tenantId?: string } = {},
  ): Promise<Array<{ id: string; action: string; actor: string; createdAt: Date }>> {
    const flag = await this.getFlagByKey(flagKey, { tenantId: opts.tenantId });
    if (!flag) throw new Error(`flag_not_found:${flagKey}`);
    const rows = await prisma.featureFlagAuditLog.findMany({
      where: { flagId: flag.id },
      take: opts.limit ?? 50,
      orderBy: { createdAt: 'desc' },
      select: { id: true, action: true, actor: true, createdAt: true },
    });
    return rows;
  }

  // ── Core: evaluate ───────────────────────────────────────────────────────

  async evaluate<T = unknown>(flagKey: string, ctx: FlagEvaluationContext): Promise<FlagEvaluationResult<T>> {
    const cKey = `eval:${TENANT}:${evalCacheKey(flagKey, ctx)}`;
    const cached = EVAL_CACHE.get(cKey);
    if (cached && cached.key === flagKey) {
      return { ...cached, value: cached.value as T } as FlagEvaluationResult<T>;
    }

    const flag = await this.getFlagByKey(flagKey, { includeRules: true });
    if (!flag) {
      logger.warn({ flagKey, identifier: ctx.identifier }, 'flag_not_found');
      return { key: flagKey, value: undefined as T, reason: 'not_found' };
    }
    if (flag.archivedAt) return { key: flagKey, value: flag.defaultValue as T, reason: 'archived' };
    if (flag.status === 'draft' || flag.status === 'paused')
      return { key: flagKey, value: flag.defaultValue as T, reason: 'disabled' };
    if (
      flag.environment !== 'all' &&
      ctx.environment &&
      ctx.environment !== 'all' &&
      flag.environment !== ctx.environment
    ) {
      return { key: flagKey, value: flag.defaultValue as T, reason: 'environment_mismatch' };
    }

    const rules = flag.rules.slice().sort((a, b) => b.priority - a.priority);
    for (const rule of rules) {
      const { matched, value } = await evaluateRule(rule, flag, ctx, (id, c) => this.evaluateSegment(id, c));
      if (matched) {
        EVAL_CACHE.set(cKey, { key: flagKey, value, reason: 'rule_match', ruleId: rule.id });
        setImmediate(() => {
          this.recordExposureEvent(flag.id, ctx, value).catch(() => undefined);
        });
        return { key: flagKey, value: value as T, reason: 'rule_match', ruleId: rule.id };
      }
    }

    const value = flag.defaultValue as T;
    EVAL_CACHE.set(cKey, { key: flagKey, value, reason: 'default' });
    setImmediate(() => {
      this.recordExposureEvent(flag.id, ctx, value).catch(() => undefined);
    });
    return { key: flagKey, value, reason: 'default' };
  }

  async evaluateAll(ctx: FlagEvaluationContext): Promise<Record<string, FlagEvaluationResult>> {
    const keys = await this.getActiveFlagKeys(ctx.environment);
    const out: Record<string, FlagEvaluationResult> = {};
    await Promise.all(keys.map(async (k) => { out[k] = await this.evaluate(k, ctx); }));
    return out;
  }

  async getActiveFlagKeys(environment?: string): Promise<string[]> {
    const where: Prisma.FeatureFlagWhereInput = { tenantId: TENANT, status: 'active', archivedAt: null };
    if (environment && environment !== 'all') {
      const envFilter: Prisma.StringFilter = { in: [environment, 'all'] };
      where.environment = envFilter;
    }
    const flags = await prisma.featureFlag.findMany({ where, select: { key: true } });
    return flags.map((f) => f.key);
  }
}

// ─── Schedule helpers ────────────────────────────────────────────────────────

function addDuration(input: string, now: Date): Date {
  const m = input.match(/^(\d+)([smhd])$/i);
  if (m) {
    const n = Number(m[1]);
    const ms = ({ s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as Record<string, number>)[(m[2] ?? 'h').toLowerCase()];
    if (ms) return new Date(now.getTime() + n * ms);
  }
  return new Date(now.getTime() + 3_600_000); // 1h fallback
}

export const featureFlagRegistry = new FeatureFlagRegistry();
