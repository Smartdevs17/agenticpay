/**
 * Query optimization & index analysis (Issue #739).
 *
 * Pure, dependency-free helpers that analyse SQL query shapes and produce
 * actionable index recommendations. This complements the static
 * RECOMMENDED_INDEXES catalogue in config/database.ts by deriving candidates
 * from the queries actually observed at runtime.
 */

export interface IndexRecommendation {
  table: string;
  columns: string[];
  reason: string;
  /** Relative benefit score, higher = more valuable. */
  score: number;
  /** Approximate statement fingerprint this recommendation targets. */
  signature: string;
}

export interface QueryStats {
  /** Statement fingerprint (literals replaced with placeholders). */
  signature: string;
  table: string;
  /** Columns referenced in equality/range predicates, in appearance order. */
  predicateColumns: string[];
  /** Columns referenced in ORDER BY, in appearance order. */
  orderByColumns: string[];
  /** Number of observed executions. */
  executions: number;
  /** Average execution duration in milliseconds. */
  avgDurationMs: number;
  /** Rows examined per execution (from EXPLAIN when available). */
  rowsExamined?: number;
}

const PLACEHOLDER_RE = /\$\d+|\?|'[^']*'|"[^"]*"|\b\d+(\.\d+)?\b/g;
const STOP_WORDS = new Set([
  'select',
  'from',
  'where',
  'and',
  'or',
  'order',
  'by',
  'group',
  'limit',
  'offset',
  'join',
  'on',
  'as',
  'asc',
  'desc',
  'null',
  'is',
  'not',
  'in',
  'like',
  'insert',
  'into',
  'values',
  'update',
  'set',
  'delete',
]);

/** Normalize a SQL string into a stable fingerprint. */
export function fingerprintQuery(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .replace(PLACEHOLDER_RE, '?')
    .trim()
    .toLowerCase();
}

/** Extract the primary table name from a simple SELECT/UPDATE/DELETE query. */
export function extractTable(sql: string): string | null {
  const match = sql.match(/\bfrom\s+([a-z_][a-z0-9_."]*)/i)
    ?? sql.match(/\bupdate\s+([a-z_][a-z0-9_."]*)/i)
    ?? sql.match(/\binto\s+([a-z_][a-z0-9_."]*)/i);
  if (!match) return null;
  return match[1].replace(/"/g, '').split('.').pop() ?? null;
}

function columnBeforeOperators(clause: string): string[] {
  const found: string[] = [];
  const re = /([a-z_][a-z0-9_."]*)\s*(?:=|<|>|<=|>=|<>|!=|\bin\b|\blike\b|\bis\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clause)) !== null) {
    const col = m[1].replace(/"/g, '').split('.').pop() ?? m[1];
    if (!STOP_WORDS.has(col.toLowerCase()) && !found.includes(col)) {
      found.push(col);
    }
  }
  return found;
}

function extractOrderByColumns(sql: string): string[] {
  const match = sql.match(/\border\s+by\s+([^)]*?)(?:\blimit\b|$)/i);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((part) => part.trim().replace(/\s+(asc|desc)$/i, '').replace(/"/g, '').split('.').pop() ?? '')
    .filter((col) => col.length > 0 && !STOP_WORDS.has(col.toLowerCase()));
}

/** Parse a SQL statement into an analysable QueryStats record. */
export function analyseQuery(
  sql: string,
  execution: { executions?: number; avgDurationMs?: number; rowsExamined?: number } = {},
): QueryStats | null {
  const table = extractTable(sql);
  if (!table) return null;

  const whereMatch = sql.match(/\bwhere\s+(.*?)(?:\border\s+by\b|\bgroup\s+by\b|\blimit\b|$)/i);
  const predicateColumns = whereMatch ? columnBeforeOperators(whereMatch[1]) : [];

  return {
    signature: fingerprintQuery(sql),
    table,
    predicateColumns,
    orderByColumns: extractOrderByColumns(sql),
    executions: execution.executions ?? 1,
    avgDurationMs: execution.avgDurationMs ?? 0,
    rowsExamined: execution.rowsExamined,
  };
}

/**
 * Recommend indexes for a batch of observed queries. Queries that already lead
 * with the same equality prefix are de-duplicated so we don't propose
 * overlapping indexes.
 */
export function recommendIndexes(queries: QueryStats[]): IndexRecommendation[] {
  const byKey = new Map<string, IndexRecommendation>();

  for (const query of queries) {
    const columns = [...query.predicateColumns, ...query.orderByColumns];
    if (columns.length === 0) continue;
    // Equality predicates should lead the index, then range/order columns.
    const orderedColumns = [...new Set([...query.predicateColumns, ...query.orderByColumns])];

    const key = `${query.table}:${orderedColumns.join(',')}`;
    const score = scoreRecommendation(query, columns.length);
    const existing = byKey.get(key);

    if (!existing || score > existing.score) {
      byKey.set(key, {
        table: query.table,
        columns: orderedColumns,
        reason: buildReason(query, orderedColumns),
        score,
        signature: query.signature,
      });
    }
  }

  return Array.from(byKey.values()).sort((a, b) => b.score - a.score);
}

function scoreRecommendation(query: QueryStats, columnCount: number): number {
  const executionWeight = Math.log2(query.executions + 1);
  const durationWeight = Math.min(query.avgDurationMs / 100, 5);
  const selectivityWeight = query.rowsExamined && query.rowsExamined > 1000 ? 2 : 0;
  const columnPenalty = columnCount > 4 ? (columnCount - 4) * 0.25 : 0;
  return Number(
    Math.max(0, executionWeight + durationWeight + selectivityWeight - columnPenalty).toFixed(3),
  );
}

function buildReason(query: QueryStats, columns: string[]): string {
  const parts: string[] = [];
  if (query.predicateColumns.length > 0) {
    parts.push(`filter on ${query.predicateColumns.join(', ')}`);
  }
  if (query.orderByColumns.length > 0) {
    parts.push(`ordered by ${query.orderByColumns.join(', ')}`);
  }
  const reason = parts.length > 0 ? parts.join(' and ') : 'frequent access pattern';
  return `Index on (${columns.join(', ')}) to support ${reason} across ${query.executions} execution(s)`;
}

/**
 * Flag potential full-table scans: frequent, slow queries whose predicates are
 * not indexable (no WHERE column or only leading-wildcard LIKE).
 */
export function detectFullTableScans(
  queries: QueryStats[],
  thresholds: { minExecutions?: number; minAvgDurationMs?: number } = {},
): QueryStats[] {
  const minExecutions = thresholds.minExecutions ?? 10;
  const minDuration = thresholds.minAvgDurationMs ?? 100;
  return queries.filter(
    (q) =>
      q.executions >= minExecutions &&
      q.avgDurationMs >= minDuration &&
      q.predicateColumns.length === 0,
  );
}

/** Merge recommendations for a single table into one composite advisory. */
export function consolidateByTable(
  recommendations: IndexRecommendation[],
): Record<string, IndexRecommendation[]> {
  return recommendations.reduce<Record<string, IndexRecommendation[]>>((acc, rec) => {
    (acc[rec.table] ??= []).push(rec);
    return acc;
  }, {});
}
