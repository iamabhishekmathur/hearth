-- Step 1: For each duplicate set, pick the row with the earliest created_at as canonical.
-- Re-point user_skills from duplicate IDs to canonical IDs (skip if would create a conflict).
DO $$
DECLARE
  dup RECORD;
BEGIN
  FOR dup IN
    SELECT s.id AS dup_id, keeper.id AS keep_id
    FROM skills s
    INNER JOIN (
      SELECT DISTINCT ON (org_id, name) id, org_id, name
      FROM skills
      ORDER BY org_id, name, created_at ASC
    ) keeper ON keeper.org_id = s.org_id AND keeper.name = s.name AND keeper.id != s.id
  LOOP
    -- Try to re-point user_skills; skip conflicts
    UPDATE user_skills
    SET skill_id = dup.keep_id
    WHERE skill_id = dup.dup_id
      AND NOT EXISTS (
        SELECT 1 FROM user_skills us2
        WHERE us2.user_id = user_skills.user_id AND us2.skill_id = dup.keep_id
      );

    -- Delete any remaining user_skills pointing to the duplicate
    DELETE FROM user_skills WHERE skill_id = dup.dup_id;

    -- Delete the duplicate skill
    DELETE FROM skills WHERE id = dup.dup_id;
  END LOOP;
END $$;

-- Step 2: Add unique constraint
CREATE UNIQUE INDEX "skills_org_name_unique" ON "skills"("org_id", "name");
