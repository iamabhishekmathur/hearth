-- ──────────────────────────────────────────────────────────────────────────
-- Task.assigneeId — optional explicit assignee (growth loop).
--
-- A teammate can be ASSIGNED a task (e.g. via a contextual invite) distinctly
-- from the task's creator (`user_id`). Nullable + no default, so every existing
-- row is unaffected (assignee stays NULL = "owned by creator only").
--
-- FK is ON DELETE SET NULL: if the assignee's user is deleted the task survives
-- and simply loses its assignee. Indexed for "tasks assigned to me" lookups.
--
-- `tasks` is under RLS (org_id), but this is a plain additive column + FK to
-- `users` (no RLS) — no policy changes needed.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE "tasks" ADD COLUMN "assignee_id" TEXT;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_assignee_id_fkey"
  FOREIGN KEY ("assignee_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tasks_assignee_id_idx" ON "tasks"("assignee_id");
