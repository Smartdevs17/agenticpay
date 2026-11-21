-- Add API versioning models — Issue #526

-- Create api_version_status enum
CREATE TYPE "ApiVersionStatus" AS ENUM ('active', 'deprecated', 'sunset', 'removed');

-- Create ApiVersion table
CREATE TABLE "api_versions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "version" TEXT NOT NULL UNIQUE,
  "status" "ApiVersionStatus" NOT NULL DEFAULT 'active',
  "release_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deprecation_date" TIMESTAMP(3),
  "sunset_date" TIMESTAMP(3),
  "description" TEXT,
  "changelog_url" TEXT,
  "migration_guide_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE INDEX "api_versions_status_idx" ON "api_versions"("status");
CREATE INDEX "api_versions_release_date_idx" ON "api_versions"("release_date");

-- Create ApiVersionUsage table
CREATE TABLE "api_version_usage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "version_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "request_count" INTEGER NOT NULL DEFAULT 0,
  "unique_clients" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "api_version_usage_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "api_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE ("version_id", "date")
);

CREATE INDEX "api_version_usage_version_id_idx" ON "api_version_usage"("version_id");
CREATE INDEX "api_version_usage_date_idx" ON "api_version_usage"("date");

-- Create ApiVersionEndpoint table
CREATE TABLE "api_version_endpoints" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "version_id" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "status" "ApiVersionStatus" NOT NULL DEFAULT 'active',
  "changes" TEXT,
  "migration_notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "api_version_endpoints_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "api_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE ("version_id", "path", "method")
);

CREATE INDEX "api_version_endpoints_version_id_idx" ON "api_version_endpoints"("version_id");
CREATE INDEX "api_version_endpoints_path_idx" ON "api_version_endpoints"("path");
