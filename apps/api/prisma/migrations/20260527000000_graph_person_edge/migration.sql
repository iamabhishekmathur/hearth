-- ──────────────────────────────────────────────────────────────────────────
-- Graph tables: Person + Edge.
--
-- Implements the "navigation over search" model. Person captures external
-- participants (Slack users, meeting attendees) that may or may not link to
-- a Hearth User. Edge is a polymorphic relation table — internal-to-internal
-- edges and internal-to-external_ref edges share the same table, with
-- `external_ref` JSON populated when toType=external_ref.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TYPE "EntityKind" AS ENUM (
  'task',
  'person',
  'meeting',
  'chat_message',
  'chat_session',
  'user',
  'external_ref'
);

CREATE TYPE "EdgeKind" AS ENUM (
  'assigned_to',
  'mentioned_in',
  'derived_from',
  'discussed_in',
  'references',
  'participates_in',
  'produced_by',
  'blocks',
  'attended'
);

CREATE TABLE "persons" (
  "id"             TEXT NOT NULL,
  "org_id"         TEXT NOT NULL,
  "user_id"        TEXT,
  "display_name"   TEXT,
  "email"          TEXT,
  "slack_user_id"  TEXT,
  "notion_user_id" TEXT,
  "google_id"      TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "persons_user_id_key"            ON "persons" ("user_id");
CREATE UNIQUE INDEX "persons_org_id_email_key"       ON "persons" ("org_id", "email");
CREATE UNIQUE INDEX "persons_org_id_slack_user_id_key"  ON "persons" ("org_id", "slack_user_id");
CREATE UNIQUE INDEX "persons_org_id_notion_user_id_key" ON "persons" ("org_id", "notion_user_id");
CREATE UNIQUE INDEX "persons_org_id_google_id_key"   ON "persons" ("org_id", "google_id");
CREATE INDEX "persons_org_id_idx"                    ON "persons" ("org_id");

CREATE TABLE "edges" (
  "id"           TEXT NOT NULL,
  "org_id"       TEXT NOT NULL,
  "from_type"    "EntityKind" NOT NULL,
  "from_id"      TEXT NOT NULL,
  "to_type"      "EntityKind" NOT NULL,
  "to_id"        TEXT NOT NULL,
  "kind"         "EdgeKind" NOT NULL,
  "weight"       DOUBLE PRECISION,
  "source"       TEXT,
  "external_ref" JSONB,
  "stale"        BOOLEAN NOT NULL DEFAULT false,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "edges_unique_relation"
  ON "edges" ("org_id", "from_type", "from_id", "to_type", "to_id", "kind");
CREATE INDEX "edges_from_idx" ON "edges" ("org_id", "from_type", "from_id", "kind");
CREATE INDEX "edges_to_idx"   ON "edges" ("org_id", "to_type", "to_id", "kind");
