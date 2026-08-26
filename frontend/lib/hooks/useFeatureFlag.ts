'use client';

/**
 * useFeatureFlag.ts — Client-side feature flag evaluation hook.
 *
 * Calls the persistent `/api/v1/feature-flags` endpoints (Phase-2 system). The
 * hook caches each evaluated flag in memory with a TTL so referenced flags
 * don't refetch on every render. Admin mutations invalidate the relevant
 * caches via TanStack Query keys.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { API_BASE } from '../queries/api';
import { queryStaleTimes } from '../query-client';

const CLIENT_CACHE_TTL_MS = 60_000;
const clientCache = new Map<string, { result: FeatureFlagEvaluationResult; timestamp: number }>();

// ─── Types ───────────────────────────────────────────────────────────────────

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

export interface FeatureFlagEvaluationResult<T = unknown> {
  key: string;
  value: T;
  reason: FlagEvaluationReason;
  ruleId?: string;
  variant?: string;
}

export type FlagValue = boolean | string | number | object;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCached<T>(key: string): FeatureFlagEvaluationResult<T> | undefined {
  const entry = clientCache.get(key);
  if (!entry) return undefined;
  if (entry.timestamp + CLIENT_CACHE_TTL_MS < Date.now()) {
    clientCache.delete(key);
    return undefined;
  }
  return entry.result as FeatureFlagEvaluationResult<T>;
}

function setCached<T>(key: string, result: FeatureFlagEvaluationResult<T>): void {
  clientCache.set(key, { result, timestamp: Date.now() });
}

function resolveIdentifier(): string {
  if (typeof window === 'undefined') return 'ssr';
  const KEY = 'flag:identifier';
  try {
    let id = window.localStorage.getItem(KEY);
    if (!id) {
      id = `anon-${(crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))}`;
      window.localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'anon';
  }
}

async function fetchFlag<T>(
  flagKey: string,
  ctx: FlagEvaluationContext,
): Promise<FeatureFlagEvaluationResult<T>> {
  const url = new URL(`${API_BASE}/feature-flags/evaluate`);
  url.searchParams.set('flag', flagKey);
  url.searchParams.set('identifier', ctx.identifier);
  if (ctx.environment) url.searchParams.set('environment', ctx.environment);
  if (typeof ctx.attributes?.tier === 'string') {
    url.searchParams.set('tier', String(ctx.attributes.tier));
  }
  const res = await fetch(url.toString(), { credentials: 'include' });
  if (!res.ok) throw new Error(`flag_eval_failed:${res.status}`);
  const data = (await res.json()) as FeatureFlagEvaluationResult<T>;
  // fire-and-forget exposure beacon
  fetch(`${API_BASE}/feature-flags/exposure`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      flag: flagKey,
      identifier: ctx.identifier,
      value: data.value,
      environment: ctx.environment ?? null,
    }),
  }).catch(() => undefined);
  return data;
}

// ─── Single-flag hook ────────────────────────────────────────────────────────

export interface UseFeatureFlagOptions<T extends FlagValue> {
  defaultValue?: T;
  environment?: string;
  attributes?: Record<string, unknown>;
}

export interface UseFeatureFlagReturn<T> {
  value: T;
  isLoading: boolean;
  reason: FlagEvaluationReason;
  ruleId?: string;
  refresh: () => Promise<void>;
}

export function useFeatureFlag<T extends FlagValue = boolean>(
  flagKey: string,
  opts: UseFeatureFlagOptions<T> = {},
): UseFeatureFlagReturn<T> {
  // Use state (with lazy initializer) instead of ref so we don't read a ref
  // value during render. SSR resolves to 'ssr' which is harmless.
  const [identifier] = useState<string>(() => resolveIdentifier());

  const defaultResult = useMemo<FeatureFlagEvaluationResult<T>>(
    () => ({ key: flagKey, value: opts.defaultValue as T, reason: 'default' }),
    [flagKey, opts.defaultValue],
  );

  // Initialize synchronously from the client cache so first render already
  // has a resolved value when possible.
  const [state, setState] = useState<{ result: FeatureFlagEvaluationResult<T>; loaded: boolean }>(
    () => {
      const cached = getCached<T>(flagKey);
      return cached ? { result: cached, loaded: true } : { result: defaultResult, loaded: false };
    },
  );

  const evaluate = useCallback(async (): Promise<void> => {
    const cached = getCached<T>(flagKey);
    if (cached) {
      setState({ result: cached, loaded: true });
      return;
    }
    try {
      const result = await fetchFlag<T>(flagKey, {
        identifier,
        environment: opts.environment,
        attributes: opts.attributes,
      });
      setCached(flagKey, result);
      setState({ result, loaded: true });
    } catch {
      setState((prev) => ({ result: prev.result, loaded: true }));
    }
  }, [flagKey, identifier, opts.environment, opts.attributes]);

  useEffect(() => {
    // The lint rule react-hooks/set-state-in-effect flags calling functions
    // that update state from inside a useEffect. This pattern is correct
    // here: evaluation is fire-and-forget, the interval is the legitimate
    // way to keep a long-lived tab in sync with the server, and stale
    // closures are handled by the [evaluate] dependency.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void evaluate();
    const interval = setInterval(() => {
      void evaluate();
    }, CLIENT_CACHE_TTL_MS);
    return () => clearInterval(interval);
  }, [evaluate]);

  return useMemo(
    () => ({
      value: state.result.value,
      isLoading: !state.loaded,
      reason: state.result.reason,
      ruleId: state.result.ruleId,
      refresh: evaluate,
    }),
    [state, evaluate],
  );
}

// ─── Batch hook ──────────────────────────────────────────────────────────────

export interface UseFeatureFlagsReturn<T extends Record<string, FlagValue>> {
  values: Partial<T>;
  isLoading: boolean;
  refresh: () => void;
}

export function useFeatureFlags<T extends Record<string, FlagValue> = Record<string, FlagValue>>(
  flagKeys: string[],
  opts: { environment?: string } = {},
): UseFeatureFlagsReturn<T> {
  const [identifier] = useState<string>(() => resolveIdentifier());
  const queryKey = [
    'feature-flags',
    'state',
    flagKeys.slice().sort().join(','),
    opts.environment ?? 'all',
    identifier,
  ] as const;

  const query: UseQueryResult<Record<string, FeatureFlagEvaluationResult>> = useQuery({
    queryKey,
    staleTime: queryStaleTimes.transactional,
    queryFn: async () => {
      const url = new URL(`${API_BASE}/feature-flags/state`);
      url.searchParams.set('identifier', identifier);
      if (opts.environment) url.searchParams.set('environment', opts.environment);
      const res = await fetch(url.toString(), { credentials: 'include' });
      if (!res.ok) throw new Error(`flag_state_failed:${res.status}`);
      const data = (await res.json()) as { flags: Record<string, FeatureFlagEvaluationResult> };
      for (const [k, v] of Object.entries(data.flags)) setCached(k, v);
      return data.flags;
    },
  });

  const values: Partial<T> = {};
  for (const k of flagKeys) {
    const entry = query.data?.[k];
    values[k as keyof T] = ((entry?.value ?? false) as T[keyof T]);
  }

  const qc = useQueryClient();
  return {
    values,
    isLoading: query.isLoading,
    refresh: () => {
      void qc.invalidateQueries({ queryKey });
    },
  };
}

// ─── Admin mutations ─────────────────────────────────────────────────────────

export interface AdminFlagInput {
  key: string;
  name: string;
  description?: string;
  type?: 'boolean' | 'string' | 'number' | 'json';
  defaultValue: unknown;
  status?: 'draft' | 'active' | 'paused' | 'archived';
  environment?: string;
  ownerEmail?: string;
  expiresAt?: string;
  rules?: Array<{
    type: 'percentage' | 'user_segment' | 'environment' | 'user_attribute' | 'allowlist';
    priority: number;
    conditions: Record<string, unknown>;
    enabled: boolean;
  }>;
}

export function useCreateFlag(): UseMutationResult<unknown, Error, AdminFlagInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AdminFlagInput) => {
      const res = await fetch(`${API_BASE}/feature-flags`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`create_flag_failed:${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['feature-flags'] });
    },
  });
}

export function useUpdateFlag(): UseMutationResult<
  unknown,
  Error,
  { key: string; updates: Partial<AdminFlagInput> }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, updates }) => {
      const res = await fetch(`${API_BASE}/feature-flags/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(`update_flag_failed:${res.status}`);
      return res.json();
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['feature-flags'] });
      clientCache.delete(vars.key);
    },
  });
}

export function useArchiveFlag(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      const res = await fetch(`${API_BASE}/feature-flags/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok && res.status !== 204) throw new Error(`archive_flag_failed:${res.status}`);
    },
    onSuccess: (_data, key) => {
      void qc.invalidateQueries({ queryKey: ['feature-flags'] });
      clientCache.delete(key);
    },
  });
}
