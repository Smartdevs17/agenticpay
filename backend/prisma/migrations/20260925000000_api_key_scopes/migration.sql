-- Add granular API key scopes — Issue #824
--
-- Keys created before this migration have no entry here, so they are seeded
-- with the broad '*' scope to preserve their existing unrestricted access.

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "scopes" TEXT[] DEFAULT ARRAY['*']::TEXT[];

UPDATE "api_keys" SET "scopes" = ARRAY['*']::TEXT[] WHERE "scopes" IS NULL;

ALTER TABLE "api_keys" ALTER COLUMN "scopes" SET NOT NULL;
