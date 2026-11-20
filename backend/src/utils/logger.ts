/* eslint-disable no-console -- this module is the console sink for the whole backend */
/**
 * Structured console logger with tenant-scoped PII redaction — issue #1492.
 *
 * Every argument is redacted before it reaches the console:
 *   1. Base redaction (`logging/redact.ts`) applies to every tenant and cannot
 *      be disabled: secret-named keys, emails, card numbers, bearer tokens.
 *   2. Tenant policy, when the active request is authenticated to a tenant
 *      with a registered policy, adds tenant-specific sensitive keys and
 *      string patterns on top of the base rules. A policy can only add
 *      redactions, never remove the base ones.
 *
 * The tenant comes from the request-scoped log context (`logging/context.ts`),
 * which the auth middleware populates once a principal is resolved. Logs
 * emitted outside a tenant context get base redaction only.
 *
 * If redaction itself fails (for example on a cyclic object), the whole
 * argument is replaced with a placeholder. Logging fails closed rather than
 * emitting unredacted data.
 */

import { redactPii } from '../logging/redact.js';
import { getLogContext } from '../logging/context.js';

export interface TenantRedactionPolicy {
  /** Extra object keys whose values are replaced, matched case-insensitively. */
  sensitiveKeys?: string[];
  /** Extra string patterns, replaced with `[REDACTED_<name>]`. */
  patterns?: Array<{ name: string; pattern: RegExp }>;
}

interface CompiledPolicy {
  keys: Set<string>;
  patterns: Array<{ name: string; pattern: RegExp }>;
}

const policies = new Map<string, CompiledPolicy>();

const REDACTION_FAILED = '[REDACTION_FAILED]';
const MAX_DEPTH = 32;

/** Register or replace the log-redaction policy for one tenant. */
export function setTenantRedactionPolicy(tenantId: string, policy: TenantRedactionPolicy): void {
  if (!tenantId) throw new Error('tenantId is required for a redaction policy');

  const keys = new Set<string>();
  for (const key of policy.sensitiveKeys ?? []) {
    const normalized = key.trim().toLowerCase();
    if (!normalized) throw new Error('sensitiveKeys must not contain empty entries');
    keys.add(normalized);
  }

  const patterns = (policy.patterns ?? []).map(({ name, pattern }) => {
    if (!/^[A-Z_]+$/.test(name)) throw new Error(`Pattern name '${name}' must be UPPER_SNAKE_CASE`);
    // Always global so every occurrence in a message is replaced.
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    return { name, pattern: new RegExp(pattern.source, flags) };
  });

  policies.set(tenantId, { keys, patterns });
}

export function removeTenantRedactionPolicy(tenantId: string): void {
  policies.delete(tenantId);
}

export function clearTenantRedactionPolicies(): void {
  policies.clear();
}

function applyTenantPolicy(value: unknown, policy: CompiledPolicy, depth: number): unknown {
  if (depth > MAX_DEPTH) throw new Error('Maximum redaction depth exceeded');

  if (typeof value === 'string') {
    let out = value;
    for (const { name, pattern } of policy.patterns) {
      out = out.replace(pattern, `[REDACTED_${name}]`);
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((item) => applyTenantPolicy(item, policy, depth + 1));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      result[key] = policy.keys.has(key.toLowerCase()) ? '[REDACTED]' : applyTenantPolicy(inner, policy, depth + 1);
    }
    return result;
  }
  return value;
}

/** Errors keep their name, message and stack, which are non-enumerable and would otherwise be lost. */
function errorToRecord(error: Error): Record<string, unknown> {
  return { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) };
}

/**
 * Redact one value for the given tenant. Exported so the pino formatter in
 * `middleware/logger.ts` shares the same rules.
 */
export function redactForTenant(value: unknown, tenantId?: string): unknown {
  try {
    const source = value instanceof Error ? errorToRecord(value) : value;
    const base = redactPii(source);
    const policy = tenantId ? policies.get(tenantId) : undefined;
    return policy ? applyTenantPolicy(base, policy, 0) : base;
  } catch {
    return REDACTION_FAILED;
  }
}

function format(args: unknown[]): unknown[] {
  const tenantId = getLogContext()?.tenantId;
  return args.map((arg) => redactForTenant(arg, tenantId));
}

export const logger = {
  info: (...args: unknown[]) => console.info(...format(args)),
  warn: (...args: unknown[]) => console.warn(...format(args)),
  error: (...args: unknown[]) => console.error(...format(args)),
};
