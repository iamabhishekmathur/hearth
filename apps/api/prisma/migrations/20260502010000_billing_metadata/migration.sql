-- ──────────────────────────────────────────────────────────────────────────
-- Billing metadata on Org.
--
-- OSS adds the columns; cloud writes the actual Stripe IDs + dates.
-- Self-hosters keep `plan='free'` and the rest NULL forever — no behavior
-- change for them.
--
-- Adds:
--   - Plan enum (free | team | business | enterprise)
--   - orgs.plan (default 'free')
--   - orgs.stripe_customer_id (unique, nullable)
--   - orgs.stripe_subscription_id (unique, nullable)
--   - orgs.trial_ends_at, orgs.current_period_end (nullable)
-- ──────────────────────────────────────────────────────────────────────────

CREATE TYPE "Plan" AS ENUM ('free', 'team', 'business', 'enterprise');

ALTER TABLE "orgs"
  ADD COLUMN "plan" "Plan" NOT NULL DEFAULT 'free',
  ADD COLUMN "stripe_customer_id" TEXT,
  ADD COLUMN "stripe_subscription_id" TEXT,
  ADD COLUMN "trial_ends_at" TIMESTAMP(3),
  ADD COLUMN "current_period_end" TIMESTAMP(3);

-- Unique on the Stripe IDs so we can index lookups for webhook handlers.
-- (Filtered/partial unique index — Postgres treats two NULLs as distinct
-- by default, so explicit filter isn't strictly required, but documenting
-- intent.)
CREATE UNIQUE INDEX "orgs_stripe_customer_id_key" ON "orgs" ("stripe_customer_id");
CREATE UNIQUE INDEX "orgs_stripe_subscription_id_key" ON "orgs" ("stripe_subscription_id");

-- Index for the cron that finds orgs whose period_end has passed (for
-- subscription renewal verification). Partial — only set on paid plans.
CREATE INDEX "orgs_plan_current_period_end_idx"
  ON "orgs" ("plan", "current_period_end")
  WHERE "current_period_end" IS NOT NULL;
