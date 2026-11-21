import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schemaPath = resolve(process.cwd(), '../../backend/prisma/schema.prisma');
const outPath = resolve(process.cwd(), 'src/generated/prisma.ts');
const schema = readFileSync(schemaPath, 'utf8');

const scalarMap = new Map([
  ['String', 'string'],
  ['Int', 'number'],
  ['Float', 'number'],
  ['Boolean', 'boolean'],
  ['DateTime', 'Date'],
  ['Json', 'PrismaJson'],
  ['Decimal', 'string'],
]);

const enums = new Map();
for (const match of schema.matchAll(/enum\s+(\w+)\s+\{([\s\S]*?)\}/g)) {
  const [, name, body] = match;
  const values = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//'))
    .map((line) => line.split(/\s+/)[0])
    .filter(Boolean);
  enums.set(name, values);
}

function toTsType(rawType, optional, list) {
  const base = scalarMap.get(rawType) ?? (enums.has(rawType) ? `Db${rawType}` : undefined);
  if (!base) return undefined;
  const nullable = optional ? ' | null' : '';
  return list ? `${base}[]${nullable}` : `${base}${nullable}`;
}

function parseModelFields(body) {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//') && !line.startsWith('@@'))
    .map((line) => {
      const [name, typeToken] = line.split(/\s+/);
      if (!name || !typeToken || name.startsWith('@')) return undefined;
      const list = typeToken.endsWith('[]');
      const optional = typeToken.endsWith('?');
      const rawType = typeToken.replace(/\[\]|\?/g, '');
      const tsType = toTsType(rawType, optional, list);
      if (!tsType) return undefined;
      return `  ${name}: ${tsType};`;
    })
    .filter(Boolean);
}

const lines = [
  '// Generated from backend/prisma/schema.prisma by packages/types/scripts/generate-prisma-types.mjs.',
  '// Do not edit by hand.',
  '',
  'export type PrismaScalar = string | number | boolean | null | Record<string, unknown> | unknown[];',
  'export type PrismaJson = PrismaScalar;',
  '',
];

for (const [name, values] of enums) {
  lines.push(`export type Db${name} = ${values.map((value) => `'${value}'`).join(' | ')};`);
}

lines.push('');

for (const match of schema.matchAll(/model\s+(\w+)\s+\{([\s\S]*?)\n\}/g)) {
  const [, name, body] = match;
  const fields = parseModelFields(body);
  if (fields.length === 0) continue;
  lines.push(`export interface Db${name} {`);
  lines.push(...fields);
  lines.push('}', '');
}

writeFileSync(outPath, `${lines.join('\n').trimEnd()}\n`);
