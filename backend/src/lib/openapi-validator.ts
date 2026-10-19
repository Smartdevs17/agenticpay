/**
 * OpenAPI document validation — Issue #825
 *
 * `npm run openapi:validate` used to be `fs.accessSync('docs/api/openapi/swagger.json')`,
 * which only asserted that a file existed. A truncated, malformed or
 * downgraded document passed CI and was then handed to the SDK generators.
 *
 * These checks are deliberately structural rather than a full specification
 * implementation: they catch the failure modes that actually break SDK
 * generation (wrong version, unresolved $ref, missing operationId, no
 * responses) without pulling in a heavyweight validator.
 */

export interface OpenApiIssue {
  severity: 'error' | 'warning';
  message: string;
  location?: string;
}

export interface OpenApiValidationResult {
  valid: boolean;
  errors: OpenApiIssue[];
  warnings: OpenApiIssue[];
  stats: {
    version: string | null;
    paths: number;
    operations: number;
    schemas: number;
  };
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'] as const;

/** Collect every `$ref` string in a document. */
function collectRefs(node: unknown, refs: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, refs);
    return refs;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === '$ref' && typeof value === 'string') refs.push(value);
      else collectRefs(value, refs);
    }
  }
  return refs;
}

/** Resolve a local JSON pointer such as `#/components/schemas/Payment`. */
function resolveLocalRef(ref: string, doc: unknown): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let current: unknown = doc;
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current && typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

export function validateOpenApi(doc: unknown): OpenApiValidationResult {
  const errors: OpenApiIssue[] = [];
  const warnings: OpenApiIssue[] = [];

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return {
      valid: false,
      errors: [{ severity: 'error', message: 'Document is not a JSON object' }],
      warnings,
      stats: { version: null, paths: 0, operations: 0, schemas: 0 },
    };
  }

  const spec = doc as Record<string, unknown>;

  // ── Version must be OpenAPI 3.1.x ────────────────────────────────────────
  const version = typeof spec.openapi === 'string' ? spec.openapi : null;
  if (!version) {
    errors.push({ severity: 'error', message: 'Missing "openapi" version field' });
  } else if (!version.startsWith('3.1')) {
    errors.push({
      severity: 'error',
      message: `Expected an OpenAPI 3.1.x document but found "${version}"`,
      location: 'openapi',
    });
  }

  // ── Required metadata ────────────────────────────────────────────────────
  const info = spec.info as Record<string, unknown> | undefined;
  if (!info || typeof info !== 'object') {
    errors.push({ severity: 'error', message: 'Missing "info" object' });
  } else {
    if (typeof info.title !== 'string' || !info.title.trim()) {
      errors.push({ severity: 'error', message: 'info.title is required', location: 'info.title' });
    }
    if (typeof info.version !== 'string' || !info.version.trim()) {
      errors.push({ severity: 'error', message: 'info.version is required', location: 'info.version' });
    }
  }

  // ── Paths and operations ─────────────────────────────────────────────────
  const paths = spec.paths as Record<string, Record<string, unknown>> | undefined;
  let operationCount = 0;
  const operationIds = new Map<string, string>();

  if (!paths || typeof paths !== 'object') {
    errors.push({ severity: 'error', message: 'Missing "paths" object' });
  } else {
    const pathNames = Object.keys(paths);
    if (pathNames.length === 0) {
      errors.push({ severity: 'error', message: 'Document declares no paths' });
    }

    for (const [pathName, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== 'object') {
        errors.push({
          severity: 'error',
          message: `Path "${pathName}" is not an object`,
          location: `paths.${pathName}`,
        });
        continue;
      }

      for (const method of HTTP_METHODS) {
        const operation = pathItem[method] as Record<string, unknown> | undefined;
        if (!operation || typeof operation !== 'object') continue;
        operationCount += 1;

        const location = `paths.${pathName}.${method}`;
        const operationId = operation.operationId;

        if (typeof operationId !== 'string' || !operationId.trim()) {
          errors.push({
            severity: 'error',
            message: 'operationId is required for SDK method naming',
            location,
          });
        } else {
          const key = operationId.toLowerCase();
          const previous = operationIds.get(key);
          if (previous) {
            errors.push({
              severity: 'error',
              message: `Duplicate operationId "${operationId}" (also used by ${previous})`,
              location,
            });
          } else {
            operationIds.set(key, location);
          }
        }

        const responses = operation.responses as Record<string, unknown> | undefined;
        if (!responses || typeof responses !== 'object' || Object.keys(responses).length === 0) {
          errors.push({ severity: 'error', message: 'Operation declares no responses', location });
        }

        if (!Array.isArray(operation.tags) || operation.tags.length === 0) {
          warnings.push({
            severity: 'warning',
            message: 'Operation has no tags, so it will be ungrouped in the SDK',
            location,
          });
        }
      }
    }
  }

  // ── Every $ref must resolve inside the document ───────────────────────────
  const unresolved = new Set<string>();
  for (const ref of collectRefs(spec)) {
    if (!ref.startsWith('#')) continue; // external refs are not resolvable offline
    if (resolveLocalRef(ref, spec) === undefined) unresolved.add(ref);
  }
  for (const ref of [...unresolved].sort()) {
    errors.push({ severity: 'error', message: `Unresolved $ref "${ref}"` });
  }

  const schemas = spec.components as Record<string, unknown> | undefined;
  const schemaCount =
    schemas && typeof schemas === 'object' && schemas.schemas && typeof schemas.schemas === 'object'
      ? Object.keys(schemas.schemas as Record<string, unknown>).length
      : 0;

  if (schemaCount === 0) {
    warnings.push({
      severity: 'warning',
      message: 'No component schemas declared; generated SDKs will have no models',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: { version, paths: paths ? Object.keys(paths).length : 0, operations: operationCount, schemas: schemaCount },
  };
}
