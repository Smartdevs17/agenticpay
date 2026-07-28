import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ERROR_CODE_REGISTRY } from '../dist/index.js';

const outPath = resolve(process.cwd(), '../../docs/api/errors.md');
const rows = Object.values(ERROR_CODE_REGISTRY)
  .sort((a, b) => a.code.localeCompare(b.code))
  .map((entry) => `| \`${entry.code}\` | ${entry.category} | ${entry.httpStatus} | ${entry.description} | ${entry.resolution} |`)
  .join('\n');

const markdown = `# AgenticPay Error Codes

| Code | Category | HTTP | Description | Resolution |
| --- | --- | ---: | --- | --- |
${rows}
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, markdown);
