-- ──────────────────────────────────────────────────────────────────────────
-- Per-user integrations (growth-loop activation).
--
-- Adds integrations.user_id — the member who connected this integration as a
-- PERSONAL source. NULL = org-level / admin-managed (the existing behavior,
-- visible org-wide); set = personal, scoped to and manageable only by that user.
-- MCP connectors authenticate per-user, so every member can connect their own
-- Slack/Gmail/Granola and reach the on-connect backfill aha.
--
-- Backfill-safe & additive: a single NULLABLE column (existing rows become
-- org-level NULL automatically), an ON DELETE SET NULL FK so deleting a user
-- demotes their personal integrations rather than cascading them away, plus an
-- index for the per-user lookup path.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE "integrations" ADD COLUMN "user_id" TEXT;

ALTER TABLE "integrations"
  ADD CONSTRAINT "integrations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "integrations_user_id_idx" ON "integrations"("user_id");
