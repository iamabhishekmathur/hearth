-- ──────────────────────────────────────────────────────────────────────────
-- Knowledge loop, Phase 2: curator proposals.
--
-- The nightly curator turns gap signals into proposed changes to ONE memory
-- entry or ONE routine prompt. Owners approve, edit or reject them in the
-- Review inbox. Nothing changes until an owner approves. Behind the org
-- feature flag `knowledgeLoop` (off by default).
--
-- `knowledge_signals.proposal_id` links a signal to the card it is evidence for.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE "knowledge_proposals" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "target_scope" TEXT NOT NULL,
  "target_team_id" TEXT,
  "target_user_id" TEXT,
  "target_name" TEXT NOT NULL,
  "target_version" INTEGER NOT NULL,
  "before" TEXT NOT NULL,
  "after" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "affected" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_by_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "reject_reason" TEXT,
  "edited_after" TEXT,
  "result_version" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "knowledge_proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "knowledge_proposals_org_id_status_available_at_idx"
  ON "knowledge_proposals" ("org_id", "status", "available_at");
CREATE INDEX "knowledge_proposals_org_id_target_type_target_id_status_idx"
  ON "knowledge_proposals" ("org_id", "target_type", "target_id", "status");

-- At most one open card per target: new signals join the open card (C5).
CREATE UNIQUE INDEX "knowledge_proposals_one_pending_per_target"
  ON "knowledge_proposals" ("org_id", "target_type", "target_id")
  WHERE "status" = 'pending';

ALTER TABLE "knowledge_proposals"
  ADD CONSTRAINT "knowledge_proposals_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_proposals" FORCE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_proposals_tenant_isolation" ON "knowledge_proposals"
  USING (hearth_rls_check(org_id)) WITH CHECK (hearth_rls_check(org_id));

ALTER TABLE "knowledge_signals" ADD COLUMN "proposal_id" TEXT;
CREATE INDEX "knowledge_signals_proposal_id_idx" ON "knowledge_signals" ("proposal_id");
ALTER TABLE "knowledge_signals"
  ADD CONSTRAINT "knowledge_signals_proposal_id_fkey"
  FOREIGN KEY ("proposal_id") REFERENCES "knowledge_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
