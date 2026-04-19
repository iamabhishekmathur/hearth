-- CreateEnum
CREATE TYPE "ExperienceOutcome" AS ENUM ('success', 'partial', 'failure');

-- CreateEnum
CREATE TYPE "SkillSource" AS ENUM ('manual', 'auto_generated');

-- CreateTable
CREATE TABLE "agent_experiences" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "task_summary" TEXT NOT NULL,
    "approach" TEXT NOT NULL,
    "outcome" "ExperienceOutcome" NOT NULL,
    "learnings" TEXT[],
    "tools_used" TEXT[],
    "tags" TEXT[],
    "embedding" vector,
    "token_count" INTEGER,
    "iteration_count" INTEGER,
    "duration_ms" INTEGER,
    "quality" DOUBLE PRECISION,
    "superseded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_experiences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_experiences_user_id_created_at_idx" ON "agent_experiences"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "agent_experiences_org_id_created_at_idx" ON "agent_experiences"("org_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "agent_experiences" ADD CONSTRAINT "agent_experiences_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_experiences" ADD CONSTRAINT "agent_experiences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_experiences" ADD CONSTRAINT "agent_experiences_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_experiences" ADD CONSTRAINT "agent_experiences_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "agent_experiences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: Add source and source_experience_id to skills
ALTER TABLE "skills" ADD COLUMN "source" "SkillSource" NOT NULL DEFAULT 'manual';
ALTER TABLE "skills" ADD COLUMN "source_experience_id" TEXT;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_source_experience_id_fkey" FOREIGN KEY ("source_experience_id") REFERENCES "agent_experiences"("id") ON DELETE SET NULL ON UPDATE CASCADE;
