-- Phase 2: Session Shares table + Hybrid Search indexes

-- SessionShare model for sharing chat sessions
CREATE TABLE "session_shares" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "share_type" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_shares_pkey" PRIMARY KEY ("id")
);

-- Unique index on token for share link lookups
CREATE UNIQUE INDEX "session_shares_token_key" ON "session_shares"("token");

-- Foreign key to chat_sessions
ALTER TABLE "session_shares" ADD CONSTRAINT "session_shares_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- GIN index for full-text search on memory entries
CREATE INDEX "idx_memory_fts" ON "memory_entries"
    USING GIN (to_tsvector('english', content));

-- HNSW index for vector similarity search on memory entries (requires pgvector)
CREATE INDEX "idx_memory_embedding" ON "memory_entries"
    USING hnsw (embedding vector_cosine_ops);
