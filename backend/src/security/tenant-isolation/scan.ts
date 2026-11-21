/**
 * Static cross-tenant isolation scanner — Issue #522
 *
 * Walks the backend source tree with the TypeScript compiler API and flags
 * Prisma calls against tenant-scoped models (see models.ts) whose `where`
 * clause has no statically-visible `tenantId` (or compound key containing
 * `tenantId`). This catches the IDOR-shaped bug class where a handler does
 * `prisma.model.findUnique({ where: { id } })` and relies on a service-layer
 * check that may or may not exist.
 *
 * Run via `npm run tenant-isolation:scan` (backend/package.json). Exits
 * non-zero when violations are found so it can gate CI (Issue #522).
 */

import { Project, SyntaxKind, type CallExpression, type Node } from 'ts-morph';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIRECTLY_TENANT_SCOPED_MODELS, TRANSITIVELY_TENANT_SCOPED_MODELS } from './models.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '../../..');

const GUARDED_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
]);

export interface ScanViolation {
  file: string;
  line: number;
  model: string;
  operation: string;
  snippet: string;
  severity: 'high' | 'medium';
  reason: string;
}

const ALL_MODEL_NAMES = new Set<string>([...DIRECTLY_TENANT_SCOPED_MODELS, ...TRANSITIVELY_TENANT_SCOPED_MODELS]);
const TRANSITIVE_MODEL_NAMES = new Set<string>(TRANSITIVELY_TENANT_SCOPED_MODELS);

function whereContainsTenantId(whereNode: Node | undefined): boolean {
  if (!whereNode) return false;
  const text = whereNode.getText();
  return /\btenantId\b/.test(text);
}

function findWhereProperty(callExpr: CallExpression): Node | undefined {
  const arg = callExpr.getArguments()[0];
  if (!arg || arg.getKind() !== SyntaxKind.ObjectLiteralExpression) return undefined;
  const obj = arg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  const whereProp = obj.getProperty('where');
  return whereProp;
}

/** Scans a single source file's text for `prisma.<model>.<op>(...)` call sites missing a tenantId filter. */
export function scanFile(filePath: string, sourceText: string): ScanViolation[] {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true } });
  const sourceFile = project.createSourceFile(filePath, sourceText);
  const violations: ScanViolation[] = [];

  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const callExpr = node.asKindOrThrow(SyntaxKind.CallExpression);
    const expr = callExpr.getExpression();
    if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return;

    const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    const operation = propAccess.getName();
    if (!GUARDED_OPERATIONS.has(operation)) return;

    const modelAccessExpr = propAccess.getExpression();
    if (modelAccessExpr.getKind() !== SyntaxKind.PropertyAccessExpression) return;
    const modelAccess = modelAccessExpr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    const modelName = modelAccess.getName();

    if (!ALL_MODEL_NAMES.has(modelName)) return;

    // Must be rooted at an identifier that looks like a prisma client (prisma, tx, this.prisma, etc.)
    const root = modelAccess.getExpression().getText();
    if (!/prisma|tx$/i.test(root)) return;

    const wherePropNode = findWhereProperty(callExpr);
    const hasTenantFilter = whereContainsTenantId(wherePropNode);

    if (!hasTenantFilter) {
      const isTransitive = TRANSITIVE_MODEL_NAMES.has(modelName);
      violations.push({
        file: filePath,
        line: callExpr.getStartLineNumber(),
        model: modelName,
        operation,
        snippet: callExpr.getText().split('\n')[0].slice(0, 120),
        severity: isTransitive ? 'medium' : 'high',
        reason: isTransitive
          ? `'${modelName}' is tenant-scoped via a parent relation; query has no tenantId/parent ownership check visible at the call site.`
          : `'${modelName}' has a direct tenantId column but this query's where-clause does not reference tenantId.`,
      });
    }
  });

  return violations;
}

export async function scanBackend(rootDir: string = BACKEND_ROOT): Promise<ScanViolation[]> {
  const project = new Project({
    tsConfigFilePath: path.join(rootDir, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: true,
  });

  project.addSourceFilesAtPaths([
    path.join(rootDir, 'src/routes/**/*.ts'),
    path.join(rootDir, 'src/services/**/*.ts'),
    path.join(rootDir, 'src/repositories/**/*.ts'),
    '!' + path.join(rootDir, 'src/**/__tests__/**'),
    '!' + path.join(rootDir, 'src/**/*.test.ts'),
  ]);

  const violations: ScanViolation[] = [];
  for (const sourceFile of project.getSourceFiles()) {
    const relPath = path.relative(rootDir, sourceFile.getFilePath());
    violations.push(...scanFile(relPath, sourceFile.getFullText()));
  }
  return violations;
}

function formatReport(violations: ScanViolation[]): string {
  if (violations.length === 0) return 'Cross-tenant isolation scan: no violations found.\n';

  const lines = [`Cross-tenant isolation scan: ${violations.length} violation(s) found.\n`];
  for (const v of violations.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1))) {
    lines.push(`  [${v.severity.toUpperCase()}] ${v.file}:${v.line} — ${v.model}.${v.operation}()`);
    lines.push(`    ${v.snippet}`);
    lines.push(`    ${v.reason}\n`);
  }
  return lines.join('\n');
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  scanBackend().then((violations) => {
    console.log(formatReport(violations));
    const highSeverityCount = violations.filter((v) => v.severity === 'high').length;
    if (highSeverityCount > 0) {
      console.error(`FAIL: ${highSeverityCount} high-severity cross-tenant isolation violation(s).`);
      process.exit(1);
    }
  });
}
