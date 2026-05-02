-- ──────────────────────────────────────────────────────────────────────────
-- Org lifecycle: status enum + soft-delete grace period support.
--
-- Adds:
--   - OrgStatus enum (active | pending_deletion | suspended)
--   - orgs.status (default 'active' for existing rows)
--   - orgs.deletion_scheduled_at (NULL = not pending)
--
-- Cloud uses these for self-service org delete with a grace period and
-- for billing-driven suspension. Self-hosters never set them — every
-- org stays 'active' forever — so it's a no-op for OSS deployments.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TYPE "OrgStatus" AS ENUM ('active', 'pending_deletion', 'suspended');

ALTER TABLE "orgs"
  ADD COLUMN "status" "OrgStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "deletion_scheduled_at" TIMESTAMP(3);

-- Index for the hard-delete cron worker (filters orgs whose grace period
-- has expired). Partial index keeps it small — most rows have NULL here.
CREATE INDEX "orgs_status_deletion_scheduled_at_idx"
  ON "orgs" ("status", "deletion_scheduled_at")
  WHERE "deletion_scheduled_at" IS NOT NULL;
