/**
 * Full-text search with PostgreSQL — Issue #885
 *
 * Searches payments using the generated `search_vector` tsvector column
 * (see migration 20260923000100_fulltext_search_payments) instead of
 * `ILIKE '%...%'` scans. Ranked with `ts_rank` and highlighted with
 * `ts_headline` for the project title.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

export interface PaymentSearchResult {
  id: string;
  tenantId: string;
  projectTitle: string | null;
  currency: string;
  network: string;
  status: string;
  amount: string;
  txHash: string | null;
  createdAt: Date;
  rank: number;
  headline: string | null;
}

export interface PaymentSearchOptions {
  tenantId?: string;
  limit?: number;
  cursor?: number;
}

/**
 * Full-text search over payments' project title, currency, network,
 * addresses, and tx hash. `query` is parsed with `websearch_to_tsquery`,
 * which accepts plain user input (quotes, "-word" exclusion, "or") safely.
 */
export async function searchPayments(
  query: string,
  options: PaymentSearchOptions = {},
): Promise<PaymentSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const limit = Math.min(options.limit ?? 20, 100);
  const offset = options.cursor ?? 0;

  const rows = await prisma.$queryRaw<PaymentSearchResult[]>`
    SELECT
      id,
      tenant_id AS "tenantId",
      project_title AS "projectTitle",
      currency,
      network,
      status,
      amount::text AS amount,
      tx_hash AS "txHash",
      created_at AS "createdAt",
      ts_rank(search_vector, websearch_to_tsquery('english', ${trimmed})) AS rank,
      ts_headline('english', coalesce(project_title, ''), websearch_to_tsquery('english', ${trimmed})) AS headline
    FROM payments
    WHERE deleted_at IS NULL
      AND search_vector @@ websearch_to_tsquery('english', ${trimmed})
      ${options.tenantId ? Prisma.sql`AND tenant_id = ${options.tenantId}` : Prisma.empty}
    ORDER BY rank DESC, created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  return rows;
}
