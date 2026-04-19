-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('draft', 'active', 'superseded', 'reversed', 'archived');
CREATE TYPE "DecisionSource" AS ENUM ('chat', 'task', 'meeting', 'slack', 'email', 'routine', 'manual', 'external');
CREATE TYPE "DecisionScope" AS ENUM ('org', 'team', 'personal');
CREATE TYPE "DecisionConfidence" AS ENUM ('low', 'medium', 'high');
CREATE TYPE "DecisionRelationship" AS ENUM ('depends_on', 'supersedes', 'related_to', 'informed_by', 'contradicts');
CREATE TYPE "OutcomeVerdict" AS ENUM ('positive', 'negative', 'mixed', 'neutral', 'too_early');
CREATE TYPE "PatternStatus" AS ENUM ('emerging', 'established', 'deprecated');
CREATE TYPE "PrincipleStatus" AS ENUM ('proposed', 'active', 'principle_deprecated');
CREATE TYPE "MeetingProvider" AS ENUM ('granola', 'otter', 'fireflies', 'manual');

-- CreateTable: decisions
CREATE TABLE "decisions" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "org_id" TEXT NOT NULL,
    "team_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "session_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reasoning" TEXT NOT NULL,
    "alternatives" JSONB NOT NULL DEFAULT '[]',
    "domain" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scope" "DecisionScope" NOT NULL DEFAULT 'org',
    "status" "DecisionStatus" NOT NULL DEFAULT 'active',
    "confidence" "DecisionConfidence" NOT NULL DEFAULT 'medium',
    "source" "DecisionSource" NOT NULL DEFAULT 'manual',
    "source_ref" JSONB,
    "sensitivity" TEXT NOT NULL DEFAULT 'normal',
    "participants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "context_snapshot" JSONB,
    "quality" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "superseded_by_id" TEXT,
    "embedding" vector,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: decision_contexts
CREATE TABLE "decision_contexts" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "decision_id" TEXT NOT NULL,
    "context_type" TEXT NOT NULL,
    "context_id" TEXT,
    "label" TEXT,
    "snippet" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "decision_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: decision_links
CREATE TABLE "decision_links" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "from_decision_id" TEXT NOT NULL,
    "to_decision_id" TEXT NOT NULL,
    "relationship" "DecisionRelationship" NOT NULL,
    "description" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "decision_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable: decision_outcomes
CREATE TABLE "decision_outcomes" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "decision_id" TEXT NOT NULL,
    "observed_by_id" TEXT NOT NULL,
    "verdict" "OutcomeVerdict" NOT NULL,
    "description" TEXT NOT NULL,
    "impact_score" DOUBLE PRECISION,
    "evidence" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "decision_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable: decision_patterns
CREATE TABLE "decision_patterns" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "org_id" TEXT NOT NULL,
    "team_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "domain" TEXT,
    "conditions" TEXT,
    "typical_outcome" TEXT,
    "status" "PatternStatus" NOT NULL DEFAULT 'emerging',
    "decision_count" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "embedding" vector,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "decision_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable: decision_pattern_links
CREATE TABLE "decision_pattern_links" (
    "decision_id" TEXT NOT NULL,
    "pattern_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "decision_pattern_links_pkey" PRIMARY KEY ("decision_id", "pattern_id")
);

-- CreateTable: org_principles
CREATE TABLE "org_principles" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "org_id" TEXT NOT NULL,
    "domain" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "guideline" TEXT NOT NULL,
    "anti_pattern" TEXT,
    "status" "PrincipleStatus" NOT NULL DEFAULT 'proposed',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "version" INTEGER NOT NULL DEFAULT 1,
    "last_synced_to_soul" TIMESTAMP(3),
    "last_synced_to_gov" TIMESTAMP(3),
    "embedding" vector,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "org_principles_pkey" PRIMARY KEY ("id")
);

-- CreateTable: org_principle_evidence
CREATE TABLE "org_principle_evidence" (
    "principle_id" TEXT NOT NULL,
    "pattern_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "org_principle_evidence_pkey" PRIMARY KEY ("principle_id", "pattern_id")
);

-- CreateTable: meeting_ingestions
CREATE TABLE "meeting_ingestions" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "org_id" TEXT NOT NULL,
    "provider" "MeetingProvider" NOT NULL,
    "external_meeting_id" TEXT,
    "title" TEXT NOT NULL,
    "participants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "meeting_date" TIMESTAMP(3) NOT NULL,
    "transcript" TEXT,
    "summary" TEXT,
    "calendar_event_id" TEXT,
    "processed_at" TIMESTAMP(3),
    "decisions_extracted" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "meeting_ingestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_decision_org_domain_time" ON "decisions"("org_id", "domain", "created_at" DESC);
CREATE INDEX "idx_decision_org_team_scope" ON "decisions"("org_id", "team_id", "scope");
CREATE INDEX "idx_decision_creator" ON "decisions"("created_by_id", "created_at" DESC);
CREATE INDEX "decision_contexts_decision_id_idx" ON "decision_contexts"("decision_id");
CREATE UNIQUE INDEX "decision_links_from_decision_id_to_decision_id_relationship_key" ON "decision_links"("from_decision_id", "to_decision_id", "relationship");
CREATE INDEX "decision_outcomes_decision_id_idx" ON "decision_outcomes"("decision_id");
CREATE INDEX "decision_patterns_org_id_domain_idx" ON "decision_patterns"("org_id", "domain");
CREATE INDEX "org_principles_org_id_domain_idx" ON "org_principles"("org_id", "domain");
CREATE INDEX "meeting_ingestions_org_id_meeting_date_idx" ON "meeting_ingestions"("org_id", "meeting_date" DESC);

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "decision_contexts" ADD CONSTRAINT "decision_contexts_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "decision_links" ADD CONSTRAINT "decision_links_from_decision_id_fkey" FOREIGN KEY ("from_decision_id") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_links" ADD CONSTRAINT "decision_links_to_decision_id_fkey" FOREIGN KEY ("to_decision_id") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "decision_outcomes" ADD CONSTRAINT "decision_outcomes_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_outcomes" ADD CONSTRAINT "decision_outcomes_observed_by_id_fkey" FOREIGN KEY ("observed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "decision_patterns" ADD CONSTRAINT "decision_patterns_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "decision_patterns" ADD CONSTRAINT "decision_patterns_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "decision_pattern_links" ADD CONSTRAINT "decision_pattern_links_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_pattern_links" ADD CONSTRAINT "decision_pattern_links_pattern_id_fkey" FOREIGN KEY ("pattern_id") REFERENCES "decision_patterns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "org_principles" ADD CONSTRAINT "org_principles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "org_principle_evidence" ADD CONSTRAINT "org_principle_evidence_principle_id_fkey" FOREIGN KEY ("principle_id") REFERENCES "org_principles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "org_principle_evidence" ADD CONSTRAINT "org_principle_evidence_pattern_id_fkey" FOREIGN KEY ("pattern_id") REFERENCES "decision_patterns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Vector indexes (IVFFlat for cosine similarity)
CREATE INDEX idx_decision_embedding ON "decisions" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_pattern_embedding ON "decision_patterns" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
CREATE INDEX idx_principle_embedding ON "org_principles" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- Full-text search GIN index on decisions
CREATE INDEX idx_decision_fts ON "decisions" USING gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(reasoning, '')));
