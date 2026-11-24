-- ──────────────────────────────────────────────────────────────────────────
-- Knowledge loop, Phase 4: routines as factories.
--
-- `routine_test_cases` — checks a routine must keep passing. One is made when
-- an owner approves a curator fix to a routine prompt (the phrases the fix
-- added); owners can add their own. A later prompt change that drops a
-- required phrase is blocked unless an owner overrides it (audit-logged).
--
-- `routine_dry_runs` — a dry run replays the routine's last run input with the
-- saved or a candidate prompt. Write tools are held back, nothing is
-- delivered, no routine_runs row is written. Rows expire after 24 hours.
--
-- Both carry org_id and use the standard tenant policy. Behind the org
-- feature flag `knowledgeLoop`. No backfill.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE "routine_test_cases" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "routine_id" TEXT NOT NULL,
  "proposal_id" TEXT,
  "description" TEXT NOT NULL,
  "must_contain" JSONB NOT NULL DEFAULT '[]',
  "source" TEXT NOT NULL DEFAULT 'manual',
  "created_by_id" TEXT,
  "last_status" TEXT,
  "last_checked_at" TIMESTAMP(3),
  "last_missing" JSONB,
  "last_dry_run_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "routine_test_cases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "routine_test_cases_routine_id_idx" ON "routine_test_cases" ("routine_id");
CREATE INDEX "routine_test_cases_org_id_idx" ON "routine_test_cases" ("org_id");

ALTER TABLE "routine_test_cases"
  ADD CONSTRAINT "routine_test_cases_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routine_test_cases"
  ADD CONSTRAINT "routine_test_cases_routine_id_fkey"
  FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routine_test_cases"
  ADD CONSTRAINT "routine_test_cases_proposal_id_fkey"
  FOREIGN KEY ("proposal_id") REFERENCES "knowledge_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "routine_test_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "routine_test_cases" FORCE ROW LEVEL SECURITY;
CREATE POLICY "routine_test_cases_tenant_isolation" ON "routine_test_cases"
  USING (hearth_rls_check(org_id)) WITH CHECK (hearth_rls_check(org_id));

CREATE TABLE "routine_dry_runs" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "routine_id" TEXT NOT NULL,
  "requested_by_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'dry_run',
  "status" TEXT NOT NULL DEFAULT 'running',
  "candidate_prompt" TEXT,
  "routine_version" INTEGER NOT NULL,
  "source_run_id" TEXT,
  "last_output" TEXT,
  "output" TEXT,
  "error" TEXT,
  "test_results" JSONB,
  "blocked_tools" JSONB NOT NULL DEFAULT '[]',
  "duration_ms" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "routine_dry_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "routine_dry_runs_routine_id_requested_by_id_idx"
  ON "routine_dry_runs" ("routine_id", "requested_by_id");
CREATE INDEX "routine_dry_runs_org_id_expires_at_idx" ON "routine_dry_runs" ("org_id", "expires_at");

ALTER TABLE "routine_dry_runs"
  ADD CONSTRAINT "routine_dry_runs_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routine_dry_runs"
  ADD CONSTRAINT "routine_dry_runs_routine_id_fkey"
  FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "routine_dry_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "routine_dry_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "routine_dry_runs_tenant_isolation" ON "routine_dry_runs"
  USING (hearth_rls_check(org_id)) WITH CHECK (hearth_rls_check(org_id));
