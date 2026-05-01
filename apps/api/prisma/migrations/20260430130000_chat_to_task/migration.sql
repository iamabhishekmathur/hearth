-- Chat → Task back-link, chat_excerpt context type, TaskSuggestion table

-- New enum values (must run outside a transaction in some PG versions; Prisma handles this)
ALTER TYPE "TaskSource" ADD VALUE 'chat_user';
ALTER TYPE "TaskContextItemType" ADD VALUE 'chat_excerpt';

-- chat_messages: array of task IDs produced from this message
ALTER TABLE "chat_messages"
  ADD COLUMN "produced_task_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- task_context_items: deep-link for chat_excerpt items
ALTER TABLE "task_context_items"
  ADD COLUMN "deep_link" TEXT;

-- tasks: back-link to originating session + message
ALTER TABLE "tasks"
  ADD COLUMN "source_session_id" TEXT,
  ADD COLUMN "source_message_id" TEXT;

CREATE INDEX "tasks_source_session_id_idx" ON "tasks"("source_session_id");
CREATE INDEX "tasks_source_message_id_idx" ON "tasks"("source_message_id");

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_session_id_fkey"
  FOREIGN KEY ("source_session_id") REFERENCES "chat_sessions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_message_id_fkey"
  FOREIGN KEY ("source_message_id") REFERENCES "chat_messages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- task_suggestions: AI-proposed tasks awaiting user acceptance
CREATE TABLE "task_suggestions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "proposed_title" TEXT NOT NULL,
    "proposed_description" TEXT,
    "suggested_context_message_ids" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "accepted_task_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "task_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "task_suggestions_accepted_task_id_key"
  ON "task_suggestions"("accepted_task_id");

CREATE INDEX "task_suggestions_user_id_status_created_at_idx"
  ON "task_suggestions"("user_id", "status", "created_at" DESC);

CREATE INDEX "task_suggestions_session_id_status_idx"
  ON "task_suggestions"("session_id", "status");

ALTER TABLE "task_suggestions" ADD CONSTRAINT "task_suggestions_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_suggestions" ADD CONSTRAINT "task_suggestions_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_suggestions" ADD CONSTRAINT "task_suggestions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_suggestions" ADD CONSTRAINT "task_suggestions_accepted_task_id_fkey"
  FOREIGN KEY ("accepted_task_id") REFERENCES "tasks"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
