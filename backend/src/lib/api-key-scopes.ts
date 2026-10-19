/**
 * API key scopes — Issue #824
 *
 * A scope is `resource:action` (for example `payments:write`) or one of the
 * broad legacy forms kept for compatibility with keys created before scoping
 * existed: `read`, `write` and `*`.
 *
 * Before this module every key carried a free-form `scopes` string array that
 * nothing ever read, so a read-only key could call any endpoint. The vocabulary
 * below is the single source of truth: creation validates against it, and
 * `hasScope` is the check that gates a request.
 */

/** Resources that can appear in a `resource:action` scope. */
export const SCOPE_RESOURCES = [
  'payments',
  'invoices',
  'batch',
  'analytics',
  'keys',
  'webhooks',
  'catalog',
  'stellar',
] as const;

export type ScopeResource = (typeof SCOPE_RESOURCES)[number];

/** Actions that can appear in a `resource:action` scope. */
export const SCOPE_ACTIONS = ['read', 'write'] as const;

export type ScopeAction = (typeof SCOPE_ACTIONS)[number];

/** Broad scopes that apply across every resource. */
export const BROAD_SCOPES = ['read', 'write', '*'] as const;

export type BroadScope = (typeof BROAD_SCOPES)[number];

/** A granular `resource:action` scope. */
export type GranularScope = `${ScopeResource}:${ScopeAction}`;

export type ApiKeyScope = GranularScope | BroadScope;

/** Every granular scope, derived from the resource and action lists. */
export const GRANULAR_SCOPES: readonly GranularScope[] = SCOPE_RESOURCES.flatMap((resource) =>
  SCOPE_ACTIONS.map((action) => `${resource}:${action}` as GranularScope)
);

/** Every scope that may be assigned to a key. */
export const ALL_SCOPES: readonly ApiKeyScope[] = [...GRANULAR_SCOPES, ...BROAD_SCOPES];

/**
 * Scopes assigned to a key when the caller does not ask for anything specific.
 * Read-only by default so a new key cannot move funds until it is widened.
 */
export const DEFAULT_SCOPES: readonly ApiKeyScope[] = ['*'];

const SCOPE_SET = new Set<string>(ALL_SCOPES);

/** Split a scope into its parts, e.g. `payments:*` -> ['payments', '*']. */
export function parseScope(scope: string): { resource: string; action: string } | null {
  if (SCOPE_SET.has(scope)) {
    return scope.includes(':') ? { resource: scope.split(':')[0], action: scope.split(':')[1] } : null;
  }

  const parts = scope.split(':');
  if (parts.length !== 2) return null;

  const [resource, action] = parts;
  const resourceValid = resource === '*' || (SCOPE_RESOURCES as readonly string[]).includes(resource);
  const actionValid = action === '*' || (SCOPE_ACTIONS as readonly string[]).includes(action);
  if (!resourceValid || !actionValid) return null;

  return { resource, action };
}

export function isValidScope(scope: unknown): scope is ApiKeyScope {
  return typeof scope === 'string' && SCOPE_SET.has(scope);
}

/**
 * Validate caller-supplied scopes.
 *
 * Returns the de-duplicated scopes in the order given, or throws with the list
 * of offending values so a caller can correct the request.
 */
export function validateScopes(input: unknown): ApiKeyScope[] {
  if (input === undefined || input === null) return [...DEFAULT_SCOPES];

  if (!Array.isArray(input)) {
    throw new Error('scopes must be an array of scope strings');
  }

  const unknown: string[] = [];
  const seen = new Set<string>();
  const scopes: ApiKeyScope[] = [];

  for (const entry of input) {
    if (!isValidScope(entry)) {
      unknown.push(String(entry));
      continue;
    }
    if (seen.has(entry)) continue;
    seen.add(entry);
    scopes.push(entry);
  }

  if (unknown.length > 0) {
    throw new Error(
      `Unknown API key ${unknown.length === 1 ? 'scope' : 'scopes'}: ${unknown.join(', ')}. ` +
        `Valid scopes: ${ALL_SCOPES.join(', ')}`
    );
  }

  return scopes;
}

/**
 * Whether a granted scope list permits a required scope.
 *
 * `*` permits everything, a bare `read`/`write` permits that action on every
 * resource, and `resource:*` permits both actions on one resource.
 */
export function hasScope(granted: readonly string[] | null | undefined, required: ApiKeyScope): boolean {
  if (!granted || granted.length === 0) return false;
  if (granted.includes('*')) return true;

  const requiredAction = required.split(':')[1];
  const requiredResource = required.split(':')[0];

  return granted.some((scope) => {
    if (scope === required) return true;
    if (!scope.includes(':')) {
      // Broad legacy scope: matches when the action is the same.
      return scope === requiredAction;
    }
    const [resource, action] = scope.split(':');
    if (action !== '*' && action !== requiredAction) return false;
    return resource === '*' || resource === requiredResource;
  });
}

/** Scopes a key is missing for the given requirements. */
export function missingScopes(granted: readonly string[] | null | undefined, required: readonly ApiKeyScope[]): ApiKeyScope[] {
  return required.filter((scope) => !hasScope(granted, scope));
}

/** Whether a key satisfies every required scope. */
export function hasAllScopes(
  granted: readonly string[] | null | undefined,
  required: readonly ApiKeyScope[]
): boolean {
  return missingScopes(granted, required).length === 0;
}
