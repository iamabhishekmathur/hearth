-- ──────────────────────────────────────────────────────────────────────────
-- Knowledge loop, Phase 0: versioned memory and routines, with owners.
--
-- Every change to an org/team/user memory entry or to a routine's definition
-- writes an immutable version row. A rollback writes a new version with the
-- old content (history is never rewritten). `owner_id` is optional; with no
-- owner the default comes from the scope (see knowledge-owner.ts).
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE "memory_entries" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "memory_entries" ADD COLUMN "owner_id" TEXT;

ALTER TABLE "routines" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "routines" ADD COLUMN "owner_id" TEXT;

CREATE TABLE "memory_versions" (
  "id" TEXT NOT NULL,
  "memory_id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "change_source" TEXT NOT NULL,
  "changed_by_id" TEXT,
  "restored_from" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "memory_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "memory_versions_memory_id_version_key"
  ON "memory_versions" ("memory_id", "version");
CREATE INDEX "memory_versions_org_id_idx" ON "memory_versions" ("org_id");

ALTER TABLE "memory_versions"
  ADD CONSTRAINT "memory_versions_memory_id_fkey"
  FOREIGN KEY ("memory_id") REFERENCES "memory_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "routine_versions" (
  "id" TEXT NOT NULL,
  "routine_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "change_source" TEXT NOT NULL,
  "changed_by_id" TEXT,
  "restored_from" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "routine_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "routine_versions_routine_id_version_key"
  ON "routine_versions" ("routine_id", "version");

ALTER TABLE "routine_versions"
  ADD CONSTRAINT "routine_versions_routine_id_fkey"
  FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Row-level security ────────────────────────────────────────────────────
-- memory_versions carries org_id (same policy as memory_entries).
ALTER TABLE "memory_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memory_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "memory_versions_tenant_isolation" ON "memory_versions"
  USING (hearth_rls_check(org_id)) WITH CHECK (hearth_rls_check(org_id));

-- routine_versions inherits visibility from its routine (like routine_runs).
ALTER TABLE "routine_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "routine_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "routine_versions_tenant_isolation" ON "routine_versions"
  USING (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "routines" r WHERE r.id = routine_versions.routine_id)
  )
  WITH CHECK (
    coalesce(current_setting('app.bypass_rls', true), '') = 'on'
    OR EXISTS (SELECT 1 FROM "routines" r WHERE r.id = routine_versions.routine_id)
  );

-- ── Backfill version 1 for existing rows ──────────────────────────────────
-- RLS is FORCED on these tables, so a non-superuser migration role (e.g. the
-- RDS master user) would see zero rows without the bypass GUC.
SELECT set_config('app.bypass_rls', 'on', false);

INSERT INTO "memory_versions" ("id", "memory_id", "org_id", "version", "content", "change_source", "created_at")
SELECT gen_random_uuid()::text, m."id", m."org_id", 1, m."content", 'migration', m."updated_at"
FROM "memory_entries" m
WHERE m."layer" <> 'session';

INSERT INTO "routine_versions" ("id", "routine_id", "version", "snapshot", "change_source", "created_at")
SELECT gen_random_uuid()::text, r."id", 1,
  jsonb_build_object(
    'name', r."name",
    'description', r."description",
    'prompt', r."prompt",
    'schedule', r."schedule",
    'context', r."context",
    'delivery', r."delivery",
    'stateConfig', r."state_config",
    'scope', r."scope",
    'teamId', r."team_id",
    'parameters', r."parameters",
    'checkpoints', r."checkpoints"
  ),
  'migration', r."updated_at"
FROM "routines" r;

SELECT set_config('app.bypass_rls', '', false);
