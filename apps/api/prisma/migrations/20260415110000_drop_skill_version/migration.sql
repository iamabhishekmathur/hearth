-- Drop the version column from skills — versioning is unnecessary for markdown documents.
-- updatedAt already tracks when a skill was last changed.
ALTER TABLE "skills" DROP COLUMN "version";
