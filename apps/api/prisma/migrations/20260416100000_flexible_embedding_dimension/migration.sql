-- Change embedding column from fixed vector(1536) to untyped vector
-- This allows different embedding providers with different dimensions

-- Drop the HNSW index (it's dimension-specific)
DROP INDEX IF EXISTS "idx_memory_embedding";

-- Alter column to untyped vector
ALTER TABLE "memory_entries" ALTER COLUMN "embedding" TYPE vector USING "embedding"::vector;

-- Null out existing embeddings since dimension may change with new providers
-- They'll be regenerated on next access
-- (Commented out — only needed when actually switching providers.
--  The app handles this via the re-embed job when embedding config changes.)
-- UPDATE "memory_entries" SET "embedding" = NULL WHERE "embedding" IS NOT NULL;
