-- CreateEnum
CREATE TYPE "GovernanceSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "GovernanceEnforcement" AS ENUM ('monitor', 'warn', 'block');

-- CreateEnum
CREATE TYPE "GovernanceViolationStatus" AS ENUM ('open', 'acknowledged', 'dismissed', 'escalated');

-- CreateTable
CREATE TABLE "governance_policies" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'custom',
    "severity" "GovernanceSeverity" NOT NULL DEFAULT 'warning',
    "rule_type" TEXT NOT NULL,
    "rule_config" JSONB NOT NULL,
    "enforcement" "GovernanceEnforcement" NOT NULL DEFAULT 'monitor',
    "scope" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "governance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governance_violations" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "message_id" TEXT,
    "message_role" TEXT NOT NULL,
    "severity" "GovernanceSeverity" NOT NULL,
    "content_snippet" VARCHAR(500) NOT NULL,
    "match_details" JSONB NOT NULL,
    "enforcement" "GovernanceEnforcement" NOT NULL,
    "status" "GovernanceViolationStatus" NOT NULL DEFAULT 'open',
    "reviewed_by" TEXT,
    "review_note" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "governance_violations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "governance_policies_org_id_enabled_idx" ON "governance_policies"("org_id", "enabled");

-- CreateIndex
CREATE INDEX "governance_violations_org_id_created_at_idx" ON "governance_violations"("org_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "governance_violations_org_id_severity_idx" ON "governance_violations"("org_id", "severity");

-- CreateIndex
CREATE INDEX "governance_violations_user_id_created_at_idx" ON "governance_violations"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "governance_violations_policy_id_idx" ON "governance_violations"("policy_id");

-- AddForeignKey
ALTER TABLE "governance_policies" ADD CONSTRAINT "governance_policies_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_policies" ADD CONSTRAINT "governance_policies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_violations" ADD CONSTRAINT "governance_violations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_violations" ADD CONSTRAINT "governance_violations_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "governance_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_violations" ADD CONSTRAINT "governance_violations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_violations" ADD CONSTRAINT "governance_violations_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
