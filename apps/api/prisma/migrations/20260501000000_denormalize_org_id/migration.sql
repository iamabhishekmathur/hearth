-- ──────────────────────────────────────────────────────────────────────────
-- Denormalize org_id onto tenant-owned tables.
--
-- Why: prepare for Row-Level Security (RLS) by ensuring every tenant-owned
-- row carries org_id directly, so RLS policies become a single column check
-- instead of multi-hop joins through users → teams → orgs.
--
-- Strategy:
--   1. Add nullable org_id columns to each affected table.
--   2. Backfill via UPDATE statements that derive org_id from existing
--      relations (User.teamId → Team.orgId chains, etc.).
--   3. Verify backfill found a value for every row. If any rows remain NULL
--      (orphaned data — typically users without team_id), the migration
--      raises an exception so the operator can investigate before retrying.
--   4. Add NOT NULL constraint, foreign key to orgs, and index on org_id.
--
-- Reversal: this migration adds columns/constraints/indexes; reversing it
-- drops them but the original relations still exist, so no data is lost.
-- See the down migration in a separate file if needed.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- Step 1: Add nullable org_id columns to all 18 tables
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE "tasks"                  ADD COLUMN "org_id" TEXT;
ALTER TABLE "chat_sessions"          ADD COLUMN "org_id" TEXT;
ALTER TABLE "chat_messages"          ADD COLUMN "org_id" TEXT;
ALTER TABLE "message_reactions"      ADD COLUMN "org_id" TEXT;
ALTER TABLE "session_reads"          ADD COLUMN "org_id" TEXT;
ALTER TABLE "session_shares"         ADD COLUMN "org_id" TEXT;
ALTER TABLE "session_collaborators"  ADD COLUMN "org_id" TEXT;
ALTER TABLE "chat_attachments"       ADD COLUMN "org_id" TEXT;
ALTER TABLE "artifacts"              ADD COLUMN "org_id" TEXT;
ALTER TABLE "artifact_versions"      ADD COLUMN "org_id" TEXT;
ALTER TABLE "task_comments"          ADD COLUMN "org_id" TEXT;
ALTER TABLE "task_context_items"     ADD COLUMN "org_id" TEXT;
ALTER TABLE "task_execution_steps"   ADD COLUMN "org_id" TEXT;
ALTER TABLE "task_reviews"           ADD COLUMN "org_id" TEXT;
ALTER TABLE "task_suggestions"       ADD COLUMN "org_id" TEXT;
ALTER TABLE "user_skills"            ADD COLUMN "org_id" TEXT;
ALTER TABLE "notifications"          ADD COLUMN "org_id" TEXT;
ALTER TABLE "pipeline_runs"          ADD COLUMN "org_id" TEXT;

-- ──────────────────────────────────────────────────────────────────────────
-- Step 2: Backfill org_id from existing relations.
--
-- Backfill order matters when a derived column depends on another derived
-- column. We process in dependency order:
--   (a) Tables that derive directly from User.team_id → Team.org_id
--   (b) Tables that derive from (a)
--   (c) Tables that derive from (b)
-- ──────────────────────────────────────────────────────────────────────────

-- (a) Tasks: User.team_id → Team.org_id
UPDATE "tasks" AS t
SET "org_id" = tm.org_id
FROM "users" u
JOIN "teams" tm ON u.team_id = tm.id
WHERE t.user_id = u.id;

-- (a) ChatSessions: User.team_id → Team.org_id
UPDATE "chat_sessions" AS cs
SET "org_id" = tm.org_id
FROM "users" u
JOIN "teams" tm ON u.team_id = tm.id
WHERE cs.user_id = u.id;

-- (a) Notifications: User.team_id → Team.org_id
UPDATE "notifications" AS n
SET "org_id" = tm.org_id
FROM "users" u
JOIN "teams" tm ON u.team_id = tm.id
WHERE n.user_id = u.id;

-- (a) UserSkills: derive from Skill.org_id
--     (Skills are org-scoped; in single-org-per-user world, the user's org
--     and skill's org match.)
UPDATE "user_skills" AS us
SET "org_id" = s.org_id
FROM "skills" s
WHERE us.skill_id = s.id;

-- (b) Tables that derive from Task
UPDATE "task_comments" AS tc
SET "org_id" = t.org_id
FROM "tasks" t
WHERE tc.task_id = t.id;

UPDATE "task_context_items" AS tci
SET "org_id" = t.org_id
FROM "tasks" t
WHERE tci.task_id = t.id;

UPDATE "task_execution_steps" AS tes
SET "org_id" = t.org_id
FROM "tasks" t
WHERE tes.task_id = t.id;

UPDATE "task_reviews" AS tr
SET "org_id" = t.org_id
FROM "tasks" t
WHERE tr.task_id = t.id;

-- (b) Tables that derive from ChatSession
UPDATE "chat_messages" AS cm
SET "org_id" = cs.org_id
FROM "chat_sessions" cs
WHERE cm.session_id = cs.id;

UPDATE "session_reads" AS sr
SET "org_id" = cs.org_id
FROM "chat_sessions" cs
WHERE sr.session_id = cs.id;

UPDATE "session_shares" AS ss
SET "org_id" = cs.org_id
FROM "chat_sessions" cs
WHERE ss.session_id = cs.id;

UPDATE "session_collaborators" AS sc
SET "org_id" = cs.org_id
FROM "chat_sessions" cs
WHERE sc.session_id = cs.id;

UPDATE "task_suggestions" AS ts
SET "org_id" = cs.org_id
FROM "chat_sessions" cs
WHERE ts.session_id = cs.id;

UPDATE "artifacts" AS a
SET "org_id" = cs.org_id
FROM "chat_sessions" cs
WHERE a.session_id = cs.id;

-- (c) Tables that derive from ChatMessage (which is now backfilled)
UPDATE "message_reactions" AS mr
SET "org_id" = cm.org_id
FROM "chat_messages" cm
WHERE mr.message_id = cm.id;

UPDATE "chat_attachments" AS ca
SET "org_id" = cm.org_id
FROM "chat_messages" cm
WHERE ca.message_id = cm.id;

-- (c) ArtifactVersion: derives from Artifact (now backfilled)
UPDATE "artifact_versions" AS av
SET "org_id" = a.org_id
FROM "artifacts" a
WHERE av.artifact_id = a.id;

-- (c) PipelineRun: derives via root_run_id → routine_runs.routine_id → routines.org_id
--     Skip rows where the routine itself is unscoped (routine.org_id IS NULL).
UPDATE "pipeline_runs" AS pr
SET "org_id" = r.org_id
FROM "routine_runs" rr
JOIN "routines" r ON rr.routine_id = r.id
WHERE pr.root_run_id = rr.id AND r.org_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────
-- Step 3: Verify backfill — every row must now have a non-NULL org_id.
--
-- If any rows remain NULL, the migration fails with a clear error so the
-- operator can investigate orphaned data (typically users without team_id,
-- or PipelineRuns whose routine has no org).
-- ──────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  null_count INTEGER;
  table_name TEXT;
  tables TEXT[] := ARRAY[
    'tasks', 'chat_sessions', 'chat_messages', 'message_reactions',
    'session_reads', 'session_shares', 'session_collaborators',
    'chat_attachments', 'artifacts', 'artifact_versions',
    'task_comments', 'task_context_items', 'task_execution_steps',
    'task_reviews', 'task_suggestions', 'user_skills',
    'notifications', 'pipeline_runs'
  ];
BEGIN
  FOREACH table_name IN ARRAY tables LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I WHERE org_id IS NULL', table_name)
      INTO null_count;
    IF null_count > 0 THEN
      RAISE EXCEPTION
        'Backfill incomplete: % rows in table "%" have NULL org_id. '
        'This usually means the row was created by a user without a team, '
        'or (for pipeline_runs) by a routine without an org. '
        'Investigate orphaned data and re-run the migration.',
        null_count, table_name;
    END IF;
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- Step 4: NOT NULL + foreign key + index for each table
-- ──────────────────────────────────────────────────────────────────────────

-- tasks
ALTER TABLE "tasks" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "tasks_org_id_idx" ON "tasks"("org_id");

-- chat_sessions
ALTER TABLE "chat_sessions" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "chat_sessions_org_id_idx" ON "chat_sessions"("org_id");

-- chat_messages
ALTER TABLE "chat_messages" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "chat_messages_org_id_idx" ON "chat_messages"("org_id");

-- message_reactions
ALTER TABLE "message_reactions" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "message_reactions_org_id_idx" ON "message_reactions"("org_id");

-- session_reads
ALTER TABLE "session_reads" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "session_reads" ADD CONSTRAINT "session_reads_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "session_reads_org_id_idx" ON "session_reads"("org_id");

-- session_shares
ALTER TABLE "session_shares" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "session_shares" ADD CONSTRAINT "session_shares_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "session_shares_org_id_idx" ON "session_shares"("org_id");

-- session_collaborators
ALTER TABLE "session_collaborators" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "session_collaborators" ADD CONSTRAINT "session_collaborators_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "session_collaborators_org_id_idx" ON "session_collaborators"("org_id");

-- chat_attachments
ALTER TABLE "chat_attachments" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "chat_attachments_org_id_idx" ON "chat_attachments"("org_id");

-- artifacts
ALTER TABLE "artifacts" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "artifacts_org_id_idx" ON "artifacts"("org_id");

-- artifact_versions
ALTER TABLE "artifact_versions" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "artifact_versions_org_id_idx" ON "artifact_versions"("org_id");

-- task_comments
ALTER TABLE "task_comments" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "task_comments_org_id_idx" ON "task_comments"("org_id");

-- task_context_items
ALTER TABLE "task_context_items" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "task_context_items" ADD CONSTRAINT "task_context_items_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "task_context_items_org_id_idx" ON "task_context_items"("org_id");

-- task_execution_steps
ALTER TABLE "task_execution_steps" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "task_execution_steps" ADD CONSTRAINT "task_execution_steps_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "task_execution_steps_org_id_idx" ON "task_execution_steps"("org_id");

-- task_reviews
ALTER TABLE "task_reviews" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "task_reviews_org_id_idx" ON "task_reviews"("org_id");

-- task_suggestions
ALTER TABLE "task_suggestions" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "task_suggestions" ADD CONSTRAINT "task_suggestions_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "task_suggestions_org_id_idx" ON "task_suggestions"("org_id");

-- user_skills
ALTER TABLE "user_skills" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "user_skills_org_id_idx" ON "user_skills"("org_id");

-- notifications
ALTER TABLE "notifications" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "notifications_org_id_idx" ON "notifications"("org_id");

-- pipeline_runs
ALTER TABLE "pipeline_runs" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "pipeline_runs_org_id_idx" ON "pipeline_runs"("org_id");

COMMIT;
