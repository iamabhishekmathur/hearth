-- Routines Enhancement: Features 1-8
-- Run-to-Run State, Event Triggers, Team Scoping, Parameters, Approval Gates,
-- Delivery Rules, Cross-Routine Chaining, Org-Wide Observability

-- New enums
CREATE TYPE "TriggerStatus" AS ENUM ('active', 'paused', 'error');
CREATE TYPE "RoutineScope" AS ENUM ('personal', 'team', 'org');
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected', 'auto_approved', 'auto_rejected', 'edited');

-- Extend RoutineRunStatus with awaiting_approval
ALTER TYPE "RoutineRunStatus" ADD VALUE 'awaiting_approval';

-- Feature 1: Run-to-Run State — add state columns to routines
ALTER TABLE "routines" ADD COLUMN "state" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "routines" ADD COLUMN "state_config" JSONB NOT NULL DEFAULT '{}';

-- Feature 1: Run summary
ALTER TABLE "routine_runs" ADD COLUMN "summary" TEXT;

-- Feature 2: Make schedule nullable (event-only routines)
ALTER TABLE "routines" ALTER COLUMN "schedule" DROP NOT NULL;

-- Feature 2: Trigger fields on routine_runs
ALTER TABLE "routine_runs" ADD COLUMN "trigger_id" TEXT;
ALTER TABLE "routine_runs" ADD COLUMN "trigger_event" JSONB;

-- Feature 3: Team-Scoped Routines
ALTER TABLE "routines" ADD COLUMN "scope" "RoutineScope" NOT NULL DEFAULT 'personal';
ALTER TABLE "routines" ADD COLUMN "team_id" TEXT;
ALTER TABLE "routines" ADD COLUMN "org_id" TEXT;

-- Feature 4: Parameterized Routines
ALTER TABLE "routines" ADD COLUMN "parameters" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "routine_runs" ADD COLUMN "parameter_values" JSONB;
ALTER TABLE "routine_runs" ADD COLUMN "triggered_by" TEXT;

-- Feature 5: Approval Gates
ALTER TABLE "routines" ADD COLUMN "checkpoints" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "routine_runs" ADD COLUMN "paused_state" JSONB;

-- Feature 3: Scoping index
CREATE INDEX "routines_org_id_team_id_scope_idx" ON "routines"("org_id", "team_id", "scope");

-- Feature 3: Foreign keys for scope
ALTER TABLE "routines" ADD CONSTRAINT "routines_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "routines" ADD CONSTRAINT "routines_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Feature 2: WebhookEndpoint table
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "integration_id" TEXT,
    "provider" TEXT NOT NULL,
    "url_token" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "webhook_endpoints_url_token_key" ON "webhook_endpoints"("url_token");
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Feature 2: RoutineTrigger table
CREATE TABLE "routine_triggers" (
    "id" TEXT NOT NULL,
    "routine_id" TEXT NOT NULL,
    "webhook_endpoint_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "parameter_mapping" JSONB NOT NULL DEFAULT '{}',
    "status" "TriggerStatus" NOT NULL DEFAULT 'active',
    "last_triggered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routine_triggers_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "routine_triggers" ADD CONSTRAINT "routine_triggers_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "routine_triggers" ADD CONSTRAINT "routine_triggers_webhook_endpoint_id_fkey" FOREIGN KEY ("webhook_endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Feature 2: FK for trigger_id on routine_runs
ALTER TABLE "routine_runs" ADD CONSTRAINT "routine_runs_trigger_id_fkey" FOREIGN KEY ("trigger_id") REFERENCES "routine_triggers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Feature 5: ApprovalCheckpoint table
CREATE TABLE "approval_checkpoints" (
    "id" TEXT NOT NULL,
    "routine_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "approver_policy" JSONB NOT NULL DEFAULT '{}',
    "timeout_minutes" INTEGER,
    "timeout_action" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_checkpoints_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "approval_checkpoints" ADD CONSTRAINT "approval_checkpoints_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Feature 5: ApprovalRequest table
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "checkpoint_id" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "agent_output" TEXT,
    "edited_output" TEXT,
    "reviewer_id" TEXT,
    "reviewer_comment" TEXT,
    "slack_message_ts" TEXT,
    "timeout_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "routine_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_checkpoint_id_fkey" FOREIGN KEY ("checkpoint_id") REFERENCES "approval_checkpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Feature 7: RoutineChain table
CREATE TABLE "routine_chains" (
    "id" TEXT NOT NULL,
    "source_routine_id" TEXT NOT NULL,
    "target_routine_id" TEXT NOT NULL,
    "condition" TEXT NOT NULL DEFAULT 'on_success',
    "parameter_mapping" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routine_chains_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "routine_chains_source_routine_id_target_routine_id_key" ON "routine_chains"("source_routine_id", "target_routine_id");
ALTER TABLE "routine_chains" ADD CONSTRAINT "routine_chains_source_routine_id_fkey" FOREIGN KEY ("source_routine_id") REFERENCES "routines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "routine_chains" ADD CONSTRAINT "routine_chains_target_routine_id_fkey" FOREIGN KEY ("target_routine_id") REFERENCES "routines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Feature 7: PipelineRun table
CREATE TABLE "pipeline_runs" (
    "id" TEXT NOT NULL,
    "root_run_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "run_ids" TEXT[],
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- Feature 8: RoutineHealthAlert table
CREATE TABLE "routine_health_alerts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "routine_id" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "threshold" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_fired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routine_health_alerts_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "routine_health_alerts" ADD CONSTRAINT "routine_health_alerts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "routine_health_alerts" ADD CONSTRAINT "routine_health_alerts_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill orgId for existing personal routines
UPDATE "routines" r
SET "org_id" = t."org_id"
FROM "users" u
JOIN "teams" t ON u."team_id" = t."id"
WHERE r."user_id" = u."id" AND r."org_id" IS NULL;
