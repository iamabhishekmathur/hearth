-- Add visibility column to chat sessions (private = default, org = visible to org)
ALTER TABLE "chat_sessions" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private';

-- Add created_by column to chat messages for multi-user attribution
ALTER TABLE "chat_messages" ADD COLUMN "created_by" TEXT;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Collaborators table — named org members with roles
CREATE TABLE "session_collaborators" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'viewer',
  "added_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "session_collaborators_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one collaborator entry per user per session
CREATE UNIQUE INDEX "session_collaborators_session_id_user_id_key" ON "session_collaborators"("session_id", "user_id");

-- Foreign keys for session_collaborators
ALTER TABLE "session_collaborators" ADD CONSTRAINT "session_collaborators_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_collaborators" ADD CONSTRAINT "session_collaborators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
