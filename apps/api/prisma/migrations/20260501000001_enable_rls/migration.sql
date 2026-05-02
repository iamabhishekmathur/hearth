-- ──────────────────────────────────────────────────────────────────────────
-- Enable Row-Level Security on every tenant-owned table.
--
-- Pre-req: 20260501000000_denormalize_org_id added a non-null org_id column
-- to every tenant-owned table. This migration adds policies that enforce
-- "rows must match current_setting('app.org_id')" on SELECT/INSERT/UPDATE/DELETE.
--
-- How it works at runtime:
--   1. Auth middleware reads the user's orgId at the start of every request.
--   2. The Prisma client wrapper opens a transaction per request and runs:
--        SET LOCAL app.org_id = '<orgId>';
--   3. RLS policies on every tenant table enforce the visibility filter.
--
-- Bypass: system jobs (migrations, certain workers) can set
--        SET LOCAL app.bypass_rls = 'on';
--   to disable filtering for trusted operations. Use sparingly and document.
--
-- FORCE ROW LEVEL SECURITY makes the policy apply even to the table owner,
-- so misconfigured prod accounts can't accidentally see all tenants.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- Helper: a single SQL function we can reuse so policy bodies stay short.
-- Returns true when the row should be visible to the current session.
--
-- Conditions:
--   1. app.bypass_rls is set to 'on' (system/admin context — privileged).
--   2. row's org_id matches app.org_id GUC.
--
-- IMMUTABLE-style behavior is fine here; current_setting is volatile but
-- the function is just sugar for inlining the expression.
-- ──────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION hearth_rls_check(row_org_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR row_org_id = current_setting('app.org_id', true)
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- Enable + force RLS on every tenant-owned table, and add a single policy
-- per table covering ALL commands (SELECT, INSERT, UPDATE, DELETE).
-- ──────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  table_name TEXT;
  tables TEXT[] := ARRAY[
    -- Tables that already had org_id from before
    'memory_entries', 'agent_identities', 'agent_experiences',
    'skills', 'routines', 'routine_health_alerts', 'webhook_endpoints',
    'integrations', 'governance_policies', 'governance_violations',
    'audit_logs', 'cognitive_profiles', 'thought_patterns',
    'decisions', 'decision_patterns', 'org_principles', 'meeting_ingestions',
    -- Tables that received org_id in the prior denormalization migration
    'tasks', 'chat_sessions', 'chat_messages', 'message_reactions',
    'session_reads', 'session_shares', 'session_collaborators',
    'chat_attachments', 'artifacts', 'artifact_versions',
    'task_comments', 'task_context_items', 'task_execution_steps',
    'task_reviews', 'task_suggestions', 'user_skills',
    'notifications', 'pipeline_runs'
  ];
BEGIN
  FOREACH table_name IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (hearth_rls_check(org_id)) WITH CHECK (hearth_rls_check(org_id))',
      table_name || '_tenant_isolation',
      table_name
    );
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- Indirect tenant tables (no org_id column directly).
-- These rely on cascading from a parent that does have org_id, but we still
-- enable RLS on them so direct queries can't bypass the parent's policy.
--
-- Approach: policy joins to the parent table's RLS-protected row. If the
-- parent row is invisible, the child row is invisible.
-- ──────────────────────────────────────────────────────────────────────────

-- ActivityReaction → AuditLog (has org_id)
ALTER TABLE "activity_reactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity_reactions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "activity_reactions_tenant_isolation" ON "activity_reactions"
  USING (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "audit_logs" a WHERE a.id = activity_reactions.audit_log_id)
  )
  WITH CHECK (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "audit_logs" a WHERE a.id = activity_reactions.audit_log_id)
  );

-- DecisionContext → Decision
ALTER TABLE "decision_contexts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_contexts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "decision_contexts_tenant_isolation" ON "decision_contexts"
  USING (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "decisions" d WHERE d.id = decision_contexts.decision_id)
  )
  WITH CHECK (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "decisions" d WHERE d.id = decision_contexts.decision_id)
  );

-- DecisionLink → Decision (via fromDecisionId; toDecisionId enforced by FK + parent visibility)
ALTER TABLE "decision_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY "decision_links_tenant_isolation" ON "decision_links"
  USING (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "decisions" d WHERE d.id = decision_links.from_decision_id)
  )
  WITH CHECK (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "decisions" d WHERE d.id = decision_links.from_decision_id)
  );

-- DecisionOutcome → Decision
ALTER TABLE "decision_outcomes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_outcomes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "decision_outcomes_tenant_isolation" ON "decision_outcomes"
  USING (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "decisions" d WHERE d.id = decision_outcomes.decision_id)
  )
  WITH CHECK (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "decisions" d WHERE d.id = decision_outcomes.decision_id)
  );

-- DecisionPatternLink → DecisionPattern
ALTER TABLE "decision_pattern_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_pattern_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY "decision_pattern_links_tenant_isolation" ON "decision_pattern_links"
  USING (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "decision_patterns" p WHERE p.id = decision_pattern_links.pattern_id)
  )
  WITH CHECK (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "decision_patterns" p WHERE p.id = decision_pattern_links.pattern_id)
  );

-- OrgPrincipleEvidence → OrgPrinciple
ALTER TABLE "org_principle_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_principle_evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_principle_evidence_tenant_isolation" ON "org_principle_evidence"
  USING (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "org_principles" p WHERE p.id = org_principle_evidence.principle_id)
  )
  WITH CHECK (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "org_principles" p WHERE p.id = org_principle_evidence.principle_id)
  );

-- ApprovalCheckpoint → Routine
ALTER TABLE "approval_checkpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_checkpoints" FORCE ROW LEVEL SECURITY;
CREATE POLICY "approval_checkpoints_tenant_isolation" ON "approval_checkpoints"
  USING (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "routines" r WHERE r.id = approval_checkpoints.routine_id)
  )
  WITH CHECK (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "routines" r WHERE r.id = approval_checkpoints.routine_id)
  );

-- ApprovalRequest → RoutineRun → Routine
ALTER TABLE "approval_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "approval_requests_tenant_isolation" ON "approval_requests"
  USING (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (
      SELECT 1 FROM "routine_runs" rr
      JOIN "routines" r ON r.id = rr.routine_id
      WHERE rr.id = approval_requests.run_id
    )
  )
  WITH CHECK (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (
      SELECT 1 FROM "routine_runs" rr
      JOIN "routines" r ON r.id = rr.routine_id
      WHERE rr.id = approval_requests.run_id
    )
  );

-- RoutineRun → Routine
ALTER TABLE "routine_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "routine_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "routine_runs_tenant_isolation" ON "routine_runs"
  USING (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "routines" r WHERE r.id = routine_runs.routine_id)
  )
  WITH CHECK (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "routines" r WHERE r.id = routine_runs.routine_id)
  );

-- RoutineTrigger → Routine
ALTER TABLE "routine_triggers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "routine_triggers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "routine_triggers_tenant_isolation" ON "routine_triggers"
  USING (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "routines" r WHERE r.id = routine_triggers.routine_id)
  )
  WITH CHECK (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "routines" r WHERE r.id = routine_triggers.routine_id)
  );

-- RoutineChain → Routine (source)
ALTER TABLE "routine_chains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "routine_chains" FORCE ROW LEVEL SECURITY;
CREATE POLICY "routine_chains_tenant_isolation" ON "routine_chains"
  USING (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "routines" r WHERE r.id = routine_chains.source_routine_id)
  )
  WITH CHECK (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "routines" r WHERE r.id = routine_chains.source_routine_id)
  );

COMMIT;
