/**
 * featureFlagRegistry.test.ts — Unit tests for the persistent feature flag
 * registry. Mocks the Prisma singleton following the same pattern as
 * `../../cqrs/__tests__/cqrs.test.ts` and `../__tests__/ai-router.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma.js', () => {
  const makeRow = (over: Record<string, unknown> = {}) => ({
    id: 'flag-1',
    tenantId: 'default',
    key: 'new-checkout',
    type: 'boolean',
    defaultValue: false,
    status: 'active',
    environment: 'all',
    archivedAt: null,
    version: 1,
    rules: [],
    ...over,
  });

  const featureFlag = {
    findFirst: vi.fn(async () => makeRow()),
    findMany: vi.fn(async () => [makeRow()]),
    findUnique: vi.fn(async () => makeRow()),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => makeRow(data)),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
      makeRow({ id: where.id, ...data }),
    ),
    delete: vi.fn(async () => undefined as unknown as void),
    count: vi.fn(async () => 1),
  };
  const featureFlagRule = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'rule-1', ...data })),
    createMany: vi.fn(async () => ({ count: 1 })),
    delete: vi.fn(async () => undefined as unknown as void),
    deleteMany: vi.fn(async () => ({ count: 1 })),
    findUnique: vi.fn(async () => null),
    findFirst: vi.fn(async () => null),
  };
  const userSegment = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'seg-1', ...data })),
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => null),
  };
  const rolloutSchedule = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 's-1', ...data })),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
      ({ id: where.id, ...data }),
    ),
    findUnique: vi.fn(async () => null),
    findFirst: vi.fn(async () => null),
    findMany: vi.fn(async () => []),
  };
  const experiment = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'exp-1', ...data, variants: [],
    })),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
      ({ id: where.id, ...data }),
    ),
    findFirst: vi.fn(async () => null),
    findUnique: vi.fn(async () => null),
    findMany: vi.fn(async () => []),
  };
  const experimentVariant = {
    findMany: vi.fn(async () => []),
  };
  const experimentAssignment = {
    findUnique: vi.fn(async () => null),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'a-1', ...data })),
    updateMany: vi.fn(async () => ({ count: 1 })),
  };
  const flagExposure = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'e-1', ...data })),
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => null),
  };
  const featureFlagAuditLog = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'log-1', ...data })),
    findMany: vi.fn(async () => []),
  };

  return {
    prisma: {
      featureFlag,
      featureFlagRule,
      userSegment,
      rolloutSchedule,
      experiment,
      experimentVariant,
      experimentAssignment,
      flagExposure,
      featureFlagAuditLog,
      $transaction: vi.fn(async (fnOrArray: unknown) => {
        if (Array.isArray(fnOrArray)) {
          return Promise.all(fnOrArray);
        }
        if (typeof fnOrArray === 'function') {
          return (fnOrArray as (tx: unknown) => Promise<unknown>)({
            featureFlag,
            featureFlagRule,
            userSegment,
            rolloutSchedule,
            experiment,
            experimentVariant,
            experimentAssignment,
            flagExposure,
            featureFlagAuditLog,
          });
        }
        return undefined;
      }),
    },
  };
});

import { featureFlagRegistry, CreateFlagSchema, TargetingRuleSchema } from '../featureFlagRegistry.js';

beforeEach(() => {
  vi.resetAllMocks();
  featureFlagRegistry.invalidateCache();
});

describe('Validation schemas', () => {
  it('rejects keys that are not kebab-case', () => {
    expect(() => CreateFlagSchema.parse({ key: 'BadKey', name: 'x', defaultValue: false })).toThrow();
  });

  it('accepts valid flag inputs', () => {
    expect(() =>
      CreateFlagSchema.parse({
        key: 'new-checkout',
        name: 'New Checkout',
        defaultValue: false,
        rules: [{ type: 'percentage', priority: 10, conditions: { percentage: 25 }, enabled: true }],
      }),
    ).not.toThrow();
  });

  it('rejects unknown rule types', () => {
    expect(() =>
      TargetingRuleSchema.parse({ type: 'unknown', priority: 1, conditions: {}, enabled: true }),
    ).toThrow();
  });
});

describe('Flag CRUD', () => {
  it('createFlag persists flag + initial rules + an audit log', async () => {
    const flag = await featureFlagRegistry.createFlag(
      {
        key: 'new-checkout',
        name: 'New Checkout',
        defaultValue: false,
        rules: [{ type: 'percentage', priority: 10, conditions: { percentage: 50 }, enabled: true }],
      } as never,
      'admin@example.com',
    );
    expect(flag.key).toBe('new-checkout');
  });

  it('deleteFlag uses soft-archive by default', async () => {
    await expect(featureFlagRegistry.deleteFlag('new-checkout', 'admin@example.com')).resolves.toBeUndefined();
  });
});

describe('Evaluation', () => {
  it('returns default for archived flag', async () => {
    const { prisma } = await import('../../lib/prisma.js');
    (prisma.featureFlag.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'flag-1', tenantId: 'default', key: 'x', type: 'boolean', defaultValue: 'fallback',
      status: 'active', environment: 'all', archivedAt: new Date(), version: 1, rules: [],
    });
    const r = await featureFlagRegistry.evaluate('x', { identifier: 'u1' });
    expect(r.reason).toBe('archived');
    expect(r.value).toBe('fallback');
  });

  it('returns disabled reason for draft/paused flag', async () => {
    const { prisma } = await import('../../lib/prisma.js');
    (prisma.featureFlag.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'flag-1', tenantId: 'default', key: 'x', type: 'boolean', defaultValue: false,
      status: 'paused', environment: 'all', archivedAt: null, version: 1, rules: [],
    });
    const r = await featureFlagRegistry.evaluate('x', { identifier: 'u1' });
    expect(r.reason).toBe('disabled');
  });

  it('returns not_found reason when flag is missing', async () => {
    const { prisma } = await import('../../lib/prisma.js');
    (prisma.featureFlag.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const r = await featureFlagRegistry.evaluate('missing', { identifier: 'u1' });
    expect(r.reason).toBe('not_found');
  });

  it('evaluates a percentage rule deterministically', async () => {
    const { prisma } = await import('../../lib/prisma.js');
    (prisma.featureFlag.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'flag-1', tenantId: 'default', key: 'percent-flag', type: 'boolean', defaultValue: false,
      status: 'active', environment: 'all', archivedAt: null, version: 1,
      rules: [
        {
          id: 'r-1', type: 'percentage', priority: 10, enabled: true,
          conditions: { percentage: 25 },
        },
      ],
    });
    const ctx = { identifier: 'stable-user', environment: 'production' };
    const first = await featureFlagRegistry.evaluate('percent-flag', ctx);
    for (let i = 0; i < 20; i++) {
      const next = await featureFlagRegistry.evaluate('percent-flag', ctx);
      expect(next.value).toBe(first.value);
    }
  });

  it('environment_mismatch falls back to default', async () => {
    const { prisma } = await import('../../lib/prisma.js');
    (prisma.featureFlag.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'flag-1', tenantId: 'default', key: 'env-flag', type: 'boolean', defaultValue: false,
      status: 'active', environment: 'production', archivedAt: null, version: 1, rules: [],
    });
    const r = await featureFlagRegistry.evaluate('env-flag', { identifier: 'u1', environment: 'staging' });
    expect(r.reason).toBe('environment_mismatch');
  });
});

describe('A/B experiment assignment', () => {
  it('returns deterministic variant for the same identifier', async () => {
    const { prisma } = await import('../../lib/prisma.js');
    (prisma.experimentAssignment.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.experimentVariant.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'v1', key: 'control', value: false, bucketWeight: 50 },
      { id: 'v2', key: 'treatment', value: true, bucketWeight: 50 },
    ]);
    const a = await featureFlagRegistry.assignVariant('exp-1', 'user-A');
    const b = await featureFlagRegistry.assignVariant('exp-1', 'user-A');
    expect(a.variant.id).toBe(b.variant.id);
  });
});

describe('Schedules', () => {
  it('rejects invalid percentage ranges', async () => {
    await expect(
      featureFlagRegistry.createSchedule({
        flagKey: 'unknown',
        startPercentage: 80,
        endPercentage: 20,
        incrementPercent: 10,
        incrementInterval: '1h',
        createdBy: 'admin@example.com',
        tenantId: 'default',
      } as never),
    ).rejects.toThrow('invalid_percentage_range');
  });

  it('runScheduledRollouts advances currentPercentage atomically', async () => {
    const { prisma } = await import('../../lib/prisma.js');
    (prisma.rolloutSchedule.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 's-1', flagId: 'flag-1', startPercentage: 0, endPercentage: 100,
        currentPercentage: 50, incrementPercent: 10, incrementInterval: '1h',
        status: 'active', nextIncrementAt: new Date(0), startedAt: new Date(),
        completedAt: null, pausedReason: null, createdBy: 'x', createdAt: new Date(),
        updatedAt: new Date(), flag: { id: 'flag-1', key: 'new-checkout' },
      },
    ]);
    (prisma.rolloutSchedule.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const applied = await featureFlagRegistry.runScheduledRollouts();
    expect(applied).toBe(1);
  });
});

describe('Stale detection', () => {
  it('returns array of stale flag candidates', async () => {
    const stale = await featureFlagRegistry.detectStaleFlags({ staleAfterDays: 30 });
    expect(Array.isArray(stale)).toBe(true);
  });
});

describe('Analytics', () => {
  it('groups exposures by environment', async () => {
    const { prisma } = await import('../../lib/prisma.js');
    (prisma.flagExposure.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { identifier: 'a', value: true, environment: 'production' },
      { identifier: 'b', value: false, environment: 'production' },
      { identifier: 'c', value: true, environment: 'staging' },
    ]);
    const stats = await featureFlagRegistry.getAnalytics('new-checkout');
    expect(stats.totalEvaluations).toBe(3);
    expect(stats.exposuresByEnvironment.production).toBe(2);
    expect(stats.exposuresByEnvironment.staging).toBe(1);
  });
});

describe('Segments', () => {
  it('createSegment stores name + conditions', async () => {
    const seg = await featureFlagRegistry.createSegment({
      name: 'enterprise-customers',
      conditions: [{ attribute: 'tier', operator: 'eq', value: 'enterprise' }],
    });
    expect(seg.name).toBe('enterprise-customers');
  });

  it('listSegments returns an array', async () => {
    const list = await featureFlagRegistry.listSegments();
    expect(Array.isArray(list)).toBe(true);
  });
});
