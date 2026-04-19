-- CreateTable
CREATE TABLE "cognitive_profiles" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "profile" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cognitive_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cognitive_profiles_org_id_user_id_key" ON "cognitive_profiles"("org_id", "user_id");

-- AddForeignKey
ALTER TABLE "cognitive_profiles" ADD CONSTRAINT "cognitive_profiles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cognitive_profiles" ADD CONSTRAINT "cognitive_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "thought_patterns" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "source_session_id" TEXT NOT NULL,
    "source_excerpt" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "observation_count" INTEGER NOT NULL DEFAULT 1,
    "first_observed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_reinforced" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_by_id" TEXT,
    "superseded_reason" TEXT,
    "embedding" vector,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thought_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "thought_patterns_user_id_category_idx" ON "thought_patterns"("user_id", "category");

-- CreateIndex
CREATE INDEX "thought_patterns_org_id_user_id_idx" ON "thought_patterns"("org_id", "user_id");

-- AddForeignKey
ALTER TABLE "thought_patterns" ADD CONSTRAINT "thought_patterns_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thought_patterns" ADD CONSTRAINT "thought_patterns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thought_patterns" ADD CONSTRAINT "thought_patterns_source_session_id_fkey" FOREIGN KEY ("source_session_id") REFERENCES "chat_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thought_patterns" ADD CONSTRAINT "thought_patterns_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "thought_patterns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
