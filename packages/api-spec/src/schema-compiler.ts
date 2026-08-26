import { z, type ZodTypeAny } from 'zod';

export interface JsonSchemaLike {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  items?: JsonSchemaLike;
  additionalProperties?: boolean | JsonSchemaLike;
  oneOf?: JsonSchemaLike[];
  anyOf?: JsonSchemaLike[];
  allOf?: JsonSchemaLike[];
  nullable?: boolean;
}

export function jsonSchemaToZod(schema: JsonSchemaLike): ZodTypeAny {
  if (schema.oneOf?.length) {
    const variants = schema.oneOf.map(jsonSchemaToZod);
    return variants.length === 1 ? variants[0] : z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }

  if (schema.anyOf?.length) {
    const variants = schema.anyOf.map(jsonSchemaToZod);
    return variants.length === 1 ? variants[0] : z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }

  if (schema.allOf?.length) {
    return schema.allOf.map(jsonSchemaToZod).reduce((acc, next) => z.intersection(acc, next));
  }

  if (schema.const !== undefined) return z.literal(schema.const as never);
  if (schema.enum) {
    if (schema.enum.length === 0) return z.never();
    return z.enum(schema.enum.map(String) as [string, ...string[]]);
  }

  const type = Array.isArray(schema.type) ? schema.type.find((item) => item !== 'null') : schema.type;
  let compiled: ZodTypeAny;

  switch (type) {
    case 'string':
      compiled = z.string();
      break;
    case 'integer':
      compiled = z.number().int();
      break;
    case 'number':
      compiled = z.number();
      break;
    case 'boolean':
      compiled = z.boolean();
      break;
    case 'array':
      compiled = z.array(schema.items ? jsonSchemaToZod(schema.items) : z.unknown());
      break;
    case 'object': {
      const required = new Set(schema.required ?? []);
      const shape = Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([key, value]) => {
          const propertySchema = jsonSchemaToZod(value);
          return [key, required.has(key) ? propertySchema : propertySchema.optional()];
        })
      );
      compiled = z.object(shape);
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        compiled = (compiled as z.ZodObject<any>).catchall(jsonSchemaToZod(schema.additionalProperties));
      }
      break;
    }
    default:
      compiled = z.unknown();
  }

  if (schema.nullable || (Array.isArray(schema.type) && schema.type.includes('null'))) {
    return compiled.nullable();
  }

  return compiled;
}
