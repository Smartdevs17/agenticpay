/**
 * Registry of Prisma models that carry a `tenantId` column, plus the models
 * that are tenant-scoped transitively through a parent relation. This is the
 * single source of truth consulted by both the static scanner
 * (scan.ts) and the runtime guard (guard.ts) — Issue #522.
 *
 * Keep in sync with prisma/schema.prisma. The `tenant-isolation:scan` script
 * and its CI check fail loudly if a model with a `tenant_id` column is added
 * to the schema but not registered here.
 */

/** Models with a direct `tenantId` column, keyed by Prisma client accessor name. */
export const DIRECTLY_TENANT_SCOPED_MODELS = [
  'user',
  'payment',
  'project',
  'invoice',
  'webhook',
  'sandboxAccount',
  'sandboxMigration',
  'emailTemplate',
  'emailDelivery',
  'emailPreference',
  'emailAnalytics',
  'pushSubscription',
  'pushPreference',
  'notificationLog',
] as const;

/**
 * Models scoped to a tenant only via a parent relation (e.g. Milestone ->
 * Project -> tenantId). These cannot be enforced by a simple `where.tenantId`
 * check; they require a join/parent lookup. The scanner flags direct queries
 * against these models that filter by raw `id` without going through a
 * tenant-checked parent accessor.
 */
export const TRANSITIVELY_TENANT_SCOPED_MODELS = [
  'milestone',
  'sandboxTransaction',
  'emailTemplateLocalization',
] as const;

export type DirectlyTenantScopedModel = (typeof DIRECTLY_TENANT_SCOPED_MODELS)[number];
export type TransitivelyTenantScopedModel = (typeof TRANSITIVELY_TENANT_SCOPED_MODELS)[number];

export const ALL_TENANT_SCOPED_MODELS = [
  ...DIRECTLY_TENANT_SCOPED_MODELS,
  ...TRANSITIVELY_TENANT_SCOPED_MODELS,
] as const;

export function isDirectlyTenantScopedModel(accessor: string): accessor is DirectlyTenantScopedModel {
  return (DIRECTLY_TENANT_SCOPED_MODELS as readonly string[]).includes(accessor);
}
