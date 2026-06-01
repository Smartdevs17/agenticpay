-- Partial index for active payments (zero-downtime friendly; safe to run online)
CREATE INDEX IF NOT EXISTS "payments_active_status_partial_idx"
  ON "payments" ("status")
  WHERE "status" IN ('pending', 'processing');
