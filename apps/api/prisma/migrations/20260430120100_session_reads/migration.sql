-- T5: Per-session unread tracking
CREATE TABLE "session_reads" (
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "last_read_message_id" TEXT,
    "last_read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_reads_pkey" PRIMARY KEY ("session_id", "user_id")
);

CREATE INDEX "session_reads_user_id_idx" ON "session_reads"("user_id");

ALTER TABLE "session_reads" ADD CONSTRAINT "session_reads_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "session_reads" ADD CONSTRAINT "session_reads_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "session_reads" ADD CONSTRAINT "session_reads_last_read_message_id_fkey"
  FOREIGN KEY ("last_read_message_id") REFERENCES "chat_messages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
