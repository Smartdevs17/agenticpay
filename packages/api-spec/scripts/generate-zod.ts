import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { API_OPERATIONS } from '../src/index.js';

const outPath = resolve(process.cwd(), 'src/generated-zod.ts');
const source = `// Generated from OpenAPI operation definitions. Do not edit by hand.
import { API_OPERATIONS } from './index.js';

export const generatedOperationSchemas = API_OPERATIONS;
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, source);
