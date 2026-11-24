-- ──────────────────────────────────────────────────────────────────────────
-- Knowledge loop, Phase 1: silent gap signals.
--
-- `knowledge_signals` records, in the background, moments where the AI may
-- have a gap: a knowledge search that found nothing, a correction, a
-- thumbs-down, a regenerate, an owner editing a routine output before
-- approval, a failed routine run. Members never see these. Text is redacted
-- before it is written. Rows older than 90 days are removed by a daily job.
--
-- `routine_runs.search_log` keeps `{tool, found}` per knowledge search in a run
-- (no query text, no tool output).
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE "routine_runs" ADD COLUMN "search_log" JSONB;

CREATE TABLE "knowledge_signals" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "user_id" TEXT,
  "team_id" TEXT,
  "kind" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "session_id" TEXT,
  "message_id" TEXT,
  "routine_id" TEXT,
  "routine_run_id" TEXT,
  "task_id" TEXT,
  "text" TEXT,
  "detail" JSONB,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "knowledge_signals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "knowledge_signals_org_id_created_at_idx" ON "knowledge_signals" ("org_id", "created_at");
CREATE INDEX "knowledge_signals_org_id_processed_at_idx" ON "knowledge_signals" ("org_id", "processed_at");
CREATE INDEX "knowledge_signals_message_id_kind_idx" ON "knowledge_signals" ("message_id", "kind");

ALTER TABLE "knowledge_signals"
  ADD CONSTRAINT "knowledge_signals_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_signals" FORCE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_signals_tenant_isolation" ON "knowledge_signals"
  USING (hearth_rls_check(org_id)) WITH CHECK (hearth_rls_check(org_id));
