import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import matter from 'gray-matter';

export interface DiskSkill {
  name: string;
  description: string;
  content: string;
  path: string;
}

/**
 * Root directory containing skill folders with SKILL.md files.
 * Resolved relative to the API package root (two levels up from src/services/).
 */
function getSkillsDir(): string {
  // From apps/api/src/services/ -> ../../../../agent-skills/skills/
  return resolve(import.meta.dirname, '..', '..', '..', '..', 'agent-skills', 'skills');
}

/**
 * Scans the agent-skills/skills/ directory and reads each SKILL.md file.
 * Parses YAML frontmatter to extract name and description.
 * Returns an array of skills with their parsed metadata and full content.
 */
export async function loadSkillsFromDisk(): Promise<DiskSkill[]> {
  const skillsDir = getSkillsDir();
  const skills: DiskSkill[] = [];

  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch {
    // Directory not found — return empty
    return [];
  }

  for (const entry of entries) {
    const skillFilePath = join(skillsDir, entry, 'SKILL.md');
    try {
      const raw = await readFile(skillFilePath, 'utf-8');
      const { data, content } = matter(raw);

      const name = typeof data.name === 'string' ? data.name : entry;
      const description = typeof data.description === 'string' ? data.description : '';

      skills.push({
        name,
        description,
        content: content.trim(),
        path: skillFilePath,
      });
    } catch {
      // Skip directories that don't have a SKILL.md or can't be read
      continue;
    }
  }

  return skills;
}
