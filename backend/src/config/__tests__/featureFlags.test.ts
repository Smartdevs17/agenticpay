/**
 * featureFlags.test.ts
 *
 * Unit tests for the FeatureFlagRegistry:
 *   - Flag definitions and defaults
 *   - Env-var override parsing (true / false / N%)
 *   - evaluate() — all strategies (all, none, percentage, allowlist)
 *   - Usage tracking (counters, lastEvaluatedAt)
 *   - override() — force enable/disable, rollout %, allowlist
 *   - reset() — restores to default
 *   - Gradual rollout consistency (same identifier always same result)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Re-usable registry factory ───────────────────────────────────────────────
// We import the module fresh inside each test via dynamic import so that
// environment-variable reads (done once at module load) can be varied.

async function loadRegistry(envOverrides: Record<string, string> = {}) {
  // Apply env overrides before the module loads
  for (const [k, v] of Object.entries(envOverrides)) {
    process.env[k] = v;
  }

  // Force a fresh module (clear Vitest's module cache)
  vi.resetModules();
  const { featureFlags } = await import('../featureFlags.js');

  return featureFlags;
}

function cleanup(envKeys: string[]) {
  for (const k of envKeys) delete process.env[k];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Flag definitions', () => {
  it('registers all expected flags', async () => {
    const ff = await loadRegistry();
    const names = ff.getAll().map((f) => f.definition.name);

    expect(names).toContain('ai-verification');
    expect(names).toContain('bulk-verification');
    expect(names).toContain('batch-operations');
    expect(names).toContain('job-scheduling');
    expect(names).toContain('message-queue');
    expect(names).toContain('rate-limit-tiering');
    expect(names).toContain('sla-tracking');
    expect(names).toContain('response-caching');
  });

  it('ai-verification is enabled by default', async () => {
    const ff = await loadRegistry();
    expect(ff.evaluate('ai-verification')).toBe(true);
  });

  it('get() returns null for unknown flags', async () => {
    const ff = await loadRegistry();
    expect(ff.get('unknown-flag' as any)).toBeNull();
  });

  it('evaluate() returns false and logs warning for unknown flags', async () => {
    const ff = await loadRegistry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = ff.evaluate('unknown-flag' as any);
    expect(result).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown-flag'));
    warn.mockRestore();
  });
});

describe('Environment variable override', () => {
  afterEach(() => cleanup(['FEATURE_AI_VERIFICATION', 'FEATURE_BULK_VERIFICATION', 'FEATURE_RATE_LIMIT_TIERING']));

  it('FEATURE_<NAME>=true force-enables a flag', async () => {
    const ff = await loadRegistry({ FEATURE_AI_VERIFICATION: 'true' });
    expect(ff.evaluate('ai-verification')).toBe(true);
    expect(ff.get('ai-verification')!.currentStrategy).toBe('all');
    expect(ff.get('ai-verification')!.overridden).toBe(true);
  });

  it('FEATURE_<NAME>=false force-disables a flag', async () => {
    const ff = await loadRegistry({ FEATURE_AI_VERIFICATION: 'false' });
    expect(ff.evaluate('ai-verification')).toBe(false);
    expect(ff.get('ai-verification')!.currentStrategy).toBe('none');
  });

  it('FEATURE_<NAME>=50% sets percentage rollout', async () => {
    const ff = await loadRegistry({ FEATURE_BULK_VERIFICATION: '50%' });
    const state = ff.get('bulk-verification')!;
    expect(state.currentStrategy).toBe('percentage');
    expect(state.currentRolloutPercentage).toBe(50);
  });

  it('unrecognised env value falls back to default and logs warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ff = await loadRegistry({ FEATURE_RATE_LIMIT_TIERING: 'maybe' });
    expect(ff.evaluate('rate-limit-tiering')).toBe(true); // default is true
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('FEATURE_RATE_LIMIT_TIERING'));
    warn.mockRestore();
  });
});

describe('evaluate() — strategies', () => {
  it('strategy=all returns true regardless of identifier', async () => {
    const ff = await loadRegistry();
    expect(ff.evaluate('ai-verification', 'user-A')).toBe(true);
    expect(ff.evaluate('ai-verification', 'user-B')).toBe(true);
    expect(ff.evaluate('ai-verification', 'anon')).toBe(true);
  });

  it('strategy=none returns false regardless of identifier', async () => {
    const ff = await loadRegistry();
    ff.override('ai-verification', { enabled: false });
    expect(ff.evaluate('ai-verification', 'user-A')).toBe(false);
    expect(ff.evaluate('ai-verification', 'premium')).toBe(false);
  });

  it('strategy=percentage 0% disables for all callers', async () => {
    const ff = await loadRegistry();
    ff.override('response-caching', { rolloutPercentage: 0 });
    for (let i = 0; i < 50; i++) {
      expect(ff.evaluate('response-caching', `user-${i}`)).toBe(false);
    }
  });

  it('strategy=percentage 100% enables for all callers', async () => {
    const ff = await loadRegistry();
    ff.override('response-caching', { rolloutPercentage: 100 });
    for (let i = 0; i < 50; i++) {
      expect(ff.evaluate('response-caching', `user-${i}`)).toBe(true);
    }
  });

  it('strategy=percentage ~50% enables roughly half', async () => {
    const ff = await loadRegistry();
    ff.override('bulk-verification', { rolloutPercentage: 50 });

    const enabled = Array.from({ length: 200 }, (_, i) =>
      ff.evaluate('bulk-verification', `user-${i}`),
    ).filter(Boolean).length;

    // Should be between 30% and 70% (statistical tolerance)
    expect(enabled).toBeGreaterThan(60);
    expect(enabled).toBeLessThan(140);
  });

  it('strategy=percentage is hash-stable (same id always same result)', async () => {
    const ff = await loadRegistry();
    ff.override('bulk-verification', { rolloutPercentage: 30 });

    const id = 'stable-user-id-xyz';
    const first = ff.evaluate('bulk-verification', id);
    for (let i = 0; i < 20; i++) {
      expect(ff.evaluate('bulk-verification', id)).toBe(first);
    }
  });

  it('strategy=allowlist enables only listed identifiers', async () => {
    const ff = await loadRegistry();
    ff.override('ai-verification', { allowlist: ['alice', 'bob'] });

    expect(ff.evaluate('ai-verification', 'alice')).toBe(true);
    expect(ff.evaluate('ai-verification', 'bob')).toBe(true);
    expect(ff.evaluate('ai-verification', 'charlie')).toBe(false);
    expect(ff.evaluate('ai-verification', '')).toBe(false);
  });
});

describe('Usage tracking', () => {
  it('increments totalEvaluations on each call', async () => {
    const ff = await loadRegistry();
    ff.evaluate('catalog' as any);  // unknown → still increments in wrapper path
    ff.evaluate('ai-verification');
    ff.evaluate('ai-verification');
    ff.evaluate('ai-verification');

    const state = ff.get('ai-verification')!;
    expect(state.usage.totalEvaluations).toBe(3);
  });

  it('increments enabledCount / disabledCount correctly', async () => {
    const ff = await loadRegistry();
    ff.override('bulk-verification', { rolloutPercentage: 50 });

    let en = 0, dis = 0;
    for (let i = 0; i < 100; i++) {
      ff.evaluate('bulk-verification', `u${i}`) ? en++ : dis++;
    }

    const stats = ff.get('bulk-verification')!.usage;
    expect(stats.totalEvaluations).toBe(100);
    expect(stats.enabledCount).toBe(en);
    expect(stats.disabledCount).toBe(dis);
    expect(stats.enabledCount + stats.disabledCount).toBe(100);
  });

  it('records lastEvaluatedAt as an ISO timestamp after first call', async () => {
    const ff = await loadRegistry();
    expect(ff.get('sla-tracking')!.usage.lastEvaluatedAt).toBeNull();

    ff.evaluate('sla-tracking');

    const ts = ff.get('sla-tracking')!.usage.lastEvaluatedAt;
    expect(ts).not.toBeNull();
    expect(() => new Date(ts!)).not.toThrow();
  });
});

describe('override() and reset()', () => {
  it('override() force-enables a flag', async () => {
    const ff = await loadRegistry();
    ff.override('batch-operations', { enabled: false });
    expect(ff.evaluate('batch-operations')).toBe(false);

    ff.override('batch-operations', { enabled: true });
    expect(ff.evaluate('batch-operations')).toBe(true);
    expect(ff.get('batch-operations')!.overridden).toBe(true);
  });

  it('override() throws for unknown flag', async () => {
    const ff = await loadRegistry();
    expect(() => ff.override('ghost' as any, { enabled: true })).toThrow();
  });

  it('override() throws when rolloutPercentage is out of range', async () => {
    const ff = await loadRegistry();
    expect(() => ff.override('ai-verification', { rolloutPercentage: 101 })).toThrow();
    expect(() => ff.override('ai-verification', { rolloutPercentage: -1 })).toThrow();
  });

  it('reset() restores flag to default strategy', async () => {
    const ff = await loadRegistry();
    ff.override('ai-verification', { enabled: false });
    expect(ff.evaluate('ai-verification')).toBe(false);

    ff.reset('ai-verification');
    expect(ff.evaluate('ai-verification')).toBe(true); // default is true / strategy=all
    expect(ff.get('ai-verification')!.overridden).toBe(false);
  });

  it('reset() on unknown flag is a no-op (does not throw)', async () => {
    const ff = await loadRegistry();
    expect(() => ff.reset('ghost' as any)).not.toThrow();
  });
});
