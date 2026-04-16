-- Task pipeline overhaul: add planning/execution phase, structured reviews

-- New enums
CREATE TYPE "TaskStepPhase" AS ENUM ('planning', 'execution');
CREATE TYPE "ReviewDecision" AS ENUM ('approved', 'changes_requested');

-- Add phase to execution steps (nullable for backward compat with existing rows)
ALTER TABLE "task_execution_steps"
  ADD COLUMN "phase" "TaskStepPhase";

-- Structured human-in-the-loop reviews (approve or send back to planning)
CREATE TABLE "task_reviews" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "reviewer_id" TEXT NOT NULL,
  "decision" "ReviewDecision" NOT NULL,
  "feedback" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "task_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_reviews_task_id_idx" ON "task_reviews"("task_id");

ALTER TABLE "task_reviews"
  ADD CONSTRAINT "task_reviews_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_reviews"
  ADD CONSTRAINT "task_reviews_reviewer_id_fkey"
  FOREIGN KEY ("reviewer_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
