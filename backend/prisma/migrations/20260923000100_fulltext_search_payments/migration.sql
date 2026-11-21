-- Issue #885: Add full-text search with PostgreSQL
--
-- Adds a generated tsvector column over the searchable payment fields
-- (project title, currency, network, from/to address) and a GIN index
-- so search queries can use PostgreSQL full-text search instead of ILIKE
-- table scans.

ALTER TABLE "payments"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("project_title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("currency", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("network", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce("from_address", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce("to_address", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce("tx_hash", '')), 'C')
  ) STORED;

CREATE INDEX "payments_search_vector_idx" ON "payments" USING GIN ("search_vector");
