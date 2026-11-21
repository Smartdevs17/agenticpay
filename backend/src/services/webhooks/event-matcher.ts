import { prisma } from '../../lib/prisma.js';
import type { WebhookSubscription } from '@prisma/client';

export interface WebhookEvent {
  eventType: string;
  resourceId?: string;
  amount?: number;
  currency?: string;
  chain?: string;
  tenantId: string;
  payload: Record<string, unknown>;
  id: string;
}

export interface MatchResult {
  matched: WebhookSubscription[];
  deduplicated: number;
}

interface ComparisonCondition {
  eq?: unknown;
  neq?: unknown;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  in?: unknown[];
  regex?: string;
}

type JsonPathCondition = string | number | boolean | ComparisonCondition;

interface FilterExpression {
  eventTypes?: string[];
  jsonpath?: Record<string, JsonPathCondition>;
}

const deliveredCache = new Set<string>();

function parseFilterExpr(expr: string | null): FilterExpression | null {
  if (!expr) return null;
  try {
    const parsed = JSON.parse(expr) as FilterExpression;
    return parsed;
  } catch {
    return null;
  }
}

function resolveJsonPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/^\$\.?/, '').split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      if (part === '*') {
        return current.map((item) => resolveJsonPath(item, parts.slice(1).join('.'))).filter((v) => v !== undefined);
      }
      const index = Number(part);
      if (!Number.isNaN(index)) {
        current = current[index];
      } else {
        return undefined;
      }
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function matchesComparison(value: unknown, condition: ComparisonCondition): boolean {
  if (condition.eq !== undefined) return value === condition.eq;
  if (condition.neq !== undefined) return value !== condition.neq;
  if (condition.gt !== undefined) return typeof value === 'number' && value > condition.gt;
  if (condition.gte !== undefined) return typeof value === 'number' && value >= condition.gte;
  if (condition.lt !== undefined) return typeof value === 'number' && value < condition.lt;
  if (condition.lte !== undefined) return typeof value === 'number' && value <= condition.lte;
  if (condition.in !== undefined) return Array.isArray(condition.in) && condition.in.includes(value);
  if (condition.regex !== undefined) {
    try {
      const re = new RegExp(condition.regex);
      return typeof value === 'string' && re.test(value);
    } catch {
      return false;
    }
  }
  return false;
}

function matchesJsonPathCondition(value: unknown, condition: JsonPathCondition): boolean {
  if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
    return matchesComparison(value, condition as ComparisonCondition);
  }
  if (typeof condition === 'string' && condition.includes('*')) {
    if (typeof value !== 'string') return false;
    const pattern = '^' + condition.replace(/\*/g, '.*') + '$';
    try {
      return new RegExp(pattern).test(value);
    } catch {
      return false;
    }
  }
  return value === condition;
}

function evaluateJsonPathConditions(
  payload: Record<string, unknown>,
  conditions: Record<string, JsonPathCondition>,
): boolean {
  for (const [path, condition] of Object.entries(conditions)) {
    const resolved = resolveJsonPath(payload, path);
    if (!matchesJsonPathCondition(resolved, condition)) {
      return false;
    }
  }
  return true;
}

function evaluateFilter(subscription: WebhookSubscription, event: WebhookEvent): boolean {
  const parsed = parseFilterExpr(subscription.filterExpr);
  if (!parsed) return true;

  if (parsed.eventTypes && parsed.eventTypes.length > 0) {
    const matchesEventType = parsed.eventTypes.some((et) => {
      if (et.includes('*')) {
        const pattern = '^' + et.replace(/\*/g, '.*') + '$';
        try {
          return new RegExp(pattern).test(event.eventType);
        } catch {
          return false;
        }
      }
      return et === event.eventType;
    });
    if (!matchesEventType) return false;
  }

  if (parsed.jsonpath) {
    return evaluateJsonPathConditions(event.payload, parsed.jsonpath);
  }

  return true;
}

function isDuplicate(subscriptionId: string, eventId: string): boolean {
  const key = `${subscriptionId}:${eventId}`;
  return deliveredCache.has(key);
}

function markDelivered(subscriptionId: string, eventId: string): void {
  const key = `${subscriptionId}:${eventId}`;
  deliveredCache.add(key);
}

export function clearDedupCache(): void {
  deliveredCache.clear();
}

export function getDedupCacheSize(): number {
  return deliveredCache.size;
}

export function subscriptionEventTypes(subscription: WebhookSubscription): string[] {
  return subscription.eventTypes;
}

export async function findMatchingSubscriptions(event: WebhookEvent): Promise<MatchResult> {
  const subscriptions = await prisma.webhookSubscription.findMany({
    where: {
      tenantId: event.tenantId,
      status: 'active',
      deletedAt: null,
      eventTypes: { hasSome: [event.eventType] },
    },
  });

  const matched: WebhookSubscription[] = [];
  let deduplicated = 0;

  for (const sub of subscriptions) {
    if (!evaluateFilter(sub, event)) continue;

    if (isDuplicate(sub.id, event.id)) {
      deduplicated++;
      continue;
    }

    markDelivered(sub.id, event.id);
    matched.push(sub);
  }

  return { matched, deduplicated };
}

export async function recordDelivery(
  subscriptionId: string,
  eventId: string,
  statusCode: number | null,
  latencyMs: number,
  success: boolean,
): Promise<void> {
  const sub = await prisma.webhookSubscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) return;

  const newCount = sub.deliveryCount + 1;
  const currentTotal = (sub.avgLatency ?? 0) * sub.deliveryCount;
  const newAvg = newCount > 0 ? (currentTotal + latencyMs) / newCount : latencyMs;

  const fields = success
    ? { deliveryCount: { increment: 1 }, successCount: { increment: 1 } }
    : { deliveryCount: { increment: 1 }, failCount: { increment: 1 } };

  await prisma.webhookSubscription.update({
    where: { id: subscriptionId },
    data: {
      ...fields,
      lastDelivered: new Date(),
      avgLatency: Math.round(newAvg * 100) / 100,
    },
  });
}

export async function findOverlappingSubscriptions(
  tenantId: string,
  eventType: string,
): Promise<WebhookSubscription[]> {
  return prisma.webhookSubscription.findMany({
    where: {
      tenantId,
      status: 'active',
      deletedAt: null,
      eventTypes: { has: eventType },
    },
  });
}

export function evaluateFilterExpr(
  expr: string | null,
  event: WebhookEvent,
): boolean {
  return evaluateFilter(
    {
      filterExpr: expr,
      eventTypes: [event.eventType],
    } as WebhookSubscription,
    event,
  );
}
