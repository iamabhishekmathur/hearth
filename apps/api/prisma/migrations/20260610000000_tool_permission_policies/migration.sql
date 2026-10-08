-- ──────────────────────────────────────────────────────────────────────────
-- W3: Per-tool permission policy (opencode adaptation).
--
-- Ordered allow/ask/deny rules evaluated against each chat tool call. Scope is
-- encoded by which of (agent_profile_id, user_id) are set:
--   both NULL          → org default rule
--   agent_profile_id   → agent-profile rule (Plan/Build)
--   user_id            → user override (narrowing only; allow_always lands here)
-- First-match-wins by created_at. Distinct from durable routine approvals —
-- this backs the ephemeral interactive chat permission gate.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE "tool_permission_policies" (
  "id"                     TEXT NOT NULL,
  "org_id"                 TEXT NOT NULL,
  "agent_profile_id"       TEXT,
  "user_id"                TEXT,
  "tool_pattern"           TEXT NOT NULL,
  "arg_pattern"            JSONB,
  "level"                  TEXT NOT NULL,
  "user_scope_overridable" BOOLEAN,
  "created_by"             TEXT NOT NULL,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tool_permission_policies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tool_permission_policies_org_id_agent_profile_id_user_id_idx"
  ON "tool_permission_policies" ("org_id", "agent_profile_id", "user_id");

ALTER TABLE "tool_permission_policies"
  ADD CONSTRAINT "tool_permission_policies_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security — tenant isolation, consistent with every other
-- org-scoped table (see 20260501000001_enable_rls).
ALTER TABLE "tool_permission_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tool_permission_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tool_permission_policies_tenant_isolation" ON "tool_permission_policies"
  USING (hearth_rls_check(org_id)) WITH CHECK (hearth_rls_check(org_id));
