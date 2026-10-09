-- ──────────────────────────────────────────────────────────────────────────
-- W6: Skills as slash commands (opencode adaptation).
--
-- Org/user Skills can be exposed in the chat `/` command menu. A skill flagged
-- `invocable_as_command` is offered under `command_slug`, which is UNIQUE per
-- org — two skills can never claim the same slash command, so slug collisions
-- are blocked at save time (409) and the `/` menu never shows ambiguous entries.
-- `command_params` stores a RoutineParameter[]-style template that `/slug args`
-- is validated against before the skill is expanded into the prompt / run.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE "skills"
  ADD COLUMN "invocable_as_command" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "command_slug" TEXT,
  ADD COLUMN "command_params" JSONB;

-- Partial unique index: NULL command_slug rows (the vast majority) are exempt;
-- only an actual slug is constrained unique within an org.
CREATE UNIQUE INDEX "skills_org_command_slug_unique"
  ON "skills" ("org_id", "command_slug")
  WHERE "command_slug" IS NOT NULL;
