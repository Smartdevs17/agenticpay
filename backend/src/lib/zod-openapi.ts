import { z, type ZodTypeAny } from 'zod';

type JsonSchema = Record<string, unknown>;

/**
 * Convert a Zod schema to OpenAPI 3.1-compatible JSON Schema (fully inlined).
 * Circular refs are collapsed to generic objects to keep the spec valid.
 */
export function zodToOpenApiSchema(schema: ZodTypeAny, _name = 'Schema'): JsonSchema {
  const seen = new WeakSet<ZodTypeAny>();
  return zodToOpenApiSchemaInner(schema, seen);
}

function zodToOpenApiSchemaInner(
  schema: ZodTypeAny | undefined,
  seen: WeakSet<ZodTypeAny>
): JsonSchema {
  if (!schema || !schema._def) return { type: 'object' };
  if (seen.has(schema)) return { type: 'object', description: 'Circular reference' };
  seen.add(schema);

  const def = schema._def as { typeName?: string; [key: string]: unknown };
  const typeName = def.typeName as string | undefined;

  switch (typeName) {
    case 'ZodString': {
      const checks = (def.checks as Array<{ kind: string; value?: unknown }>) ?? [];
      const out: JsonSchema = { type: 'string' };
      for (const check of checks) {
        if (check.kind === 'email') out.format = 'email';
        if (check.kind === 'url') out.format = 'uri';
        if (check.kind === 'uuid') out.format = 'uuid';
        if (check.kind === 'min') out.minLength = check.value;
        if (check.kind === 'max') out.maxLength = check.value;
        if (check.kind === 'regex') out.pattern = String((check as { regex: RegExp }).regex);
      }
      return out;
    }
    case 'ZodNumber': {
      const out: JsonSchema = { type: 'number' };
      const checks = (def.checks as Array<{ kind: string; value?: number }>) ?? [];
      for (const check of checks) {
        if (check.kind === 'int') out.type = 'integer';
        if (check.kind === 'min') out.minimum = check.value;
        if (check.kind === 'max') out.maximum = check.value;
      }
      return out;
    }
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodEnum':
      return { type: 'string', enum: def.values };
    case 'ZodNativeEnum':
      return { type: 'string', enum: Object.values(def.values as Record<string, string>) };
    case 'ZodLiteral':
      return { enum: [def.value] };
    case 'ZodArray':
      return {
        type: 'array',
        items: zodToOpenApiSchemaInner(def.type as ZodTypeAny, seen),
      };
    case 'ZodObject': {
      const shape = (def.shape as () => Record<string, ZodTypeAny>)();
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        if (!value) continue;
        properties[key] = zodToOpenApiSchemaInner(value as ZodTypeAny, seen);
        if (!(value as ZodTypeAny).isOptional?.()) {
          required.push(key);
        }
      }
      return {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
      };
    }
    case 'ZodOptional':
      return def.innerType
        ? zodToOpenApiSchemaInner(def.innerType as ZodTypeAny, seen)
        : { type: 'object' };
    case 'ZodNullable':
      return { ...zodToOpenApiSchemaInner(def.innerType as ZodTypeAny, seen), nullable: true };
    case 'ZodDefault':
      return {
        ...zodToOpenApiSchemaInner(def.innerType as ZodTypeAny, seen),
        default: typeof def.defaultValue === 'function'
          ? (def.defaultValue as () => unknown)()
          : def.defaultValue,
      };
    case 'ZodEffects':
      return zodToOpenApiSchemaInner(def.schema as ZodTypeAny, seen);
    case 'ZodRecord':
      return {
        type: 'object',
        additionalProperties: zodToOpenApiSchemaInner(def.valueType as ZodTypeAny, seen),
      };
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion':
      return {
        oneOf: (def.options as ZodTypeAny[]).map((opt) =>
          zodToOpenApiSchemaInner(opt, seen)
        ),
      };
    default:
      return { type: 'object', description: 'Complex schema' };
  }
}

export function zodExample(schema: ZodTypeAny | undefined): unknown {
  if (!schema || !schema._def) return {};
  const def = schema._def as { typeName?: string; [key: string]: unknown };
  switch (def.typeName) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
      return 1;
    case 'ZodBoolean':
      return true;
    case 'ZodEnum':
      return (def.values as string[])[0];
    case 'ZodArray':
      return [zodExample(def.type as ZodTypeAny)];
    case 'ZodObject': {
      const shape = (def.shape as () => Record<string, ZodTypeAny>)();
      return Object.fromEntries(
        Object.entries(shape)
          .filter(([, v]) => v != null)
          .map(([k, v]) => [k, zodExample(v)])
      );
    }
    case 'ZodOptional':
    case 'ZodDefault':
    case 'ZodEffects':
      return zodExample(def.innerType as ZodTypeAny);
    default:
      return {};
  }
}
