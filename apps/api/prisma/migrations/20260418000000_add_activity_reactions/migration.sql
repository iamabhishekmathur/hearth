-- CreateTable
CREATE TABLE "activity_reactions" (
    "id" TEXT NOT NULL,
    "audit_log_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "activity_reactions_audit_log_id_user_id_emoji_key" ON "activity_reactions"("audit_log_id", "user_id", "emoji");

-- AddForeignKey
ALTER TABLE "activity_reactions" ADD CONSTRAINT "activity_reactions_audit_log_id_fkey" FOREIGN KEY ("audit_log_id") REFERENCES "audit_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_reactions" ADD CONSTRAINT "activity_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
