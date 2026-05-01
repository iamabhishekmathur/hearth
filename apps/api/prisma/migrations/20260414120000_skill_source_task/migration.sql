-- Phase 3: Add sourceTaskId to skills for learning loop
ALTER TABLE "skills" ADD COLUMN "source_task_id" TEXT;
ALTER TABLE "skills" ADD CONSTRAINT "skills_source_task_id_fkey"
  FOREIGN KEY ("source_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL;
