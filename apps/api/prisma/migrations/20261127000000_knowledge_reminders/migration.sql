-- ──────────────────────────────────────────────────────────────────────────
-- Knowledge loop, Phase 3: quiet notifications.
--
-- A pending proposal gets ONE reminder in its owners' daily digest once it
-- has waited 7 days. `reminded_at` records that the reminder went out, so it
-- is never sent twice. No backfill: existing rows start un-reminded.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE "knowledge_proposals" ADD COLUMN "reminded_at" TIMESTAMP(3);
