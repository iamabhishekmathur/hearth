-- ──────────────────────────────────────────────────────────────────────────
-- Per-user onboarding state (growth-loop activation foundation).
--
-- Adds users.onboarding_state — a JSONB column tracking each user's onboarding
-- progress. Shape is documented in @hearth/shared OnboardingState:
--   { startedAt?, welcome?: { goal? }, completedSteps: string[], dismissedAt? }
-- Default '{}' means "not started". onboarding-service merges into this column
-- (never wholesale-replaces) so concurrent step completions don't clobber.
--
-- Backfill-safe: NOT NULL with a default, so existing rows get '{}' instantly.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE "users" ADD COLUMN "onboarding_state" JSONB NOT NULL DEFAULT '{}';
