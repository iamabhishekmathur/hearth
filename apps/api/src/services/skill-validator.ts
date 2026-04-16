import matter from 'gray-matter';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const MAX_DESCRIPTION_LENGTH = 1024;

/**
 * Validates a skill's name, description, and content format.
 * - Name: lowercase letters, digits, and hyphens only; must start with a letter
 * - Description: required, max 1024 characters
 * - Content: must contain valid YAML frontmatter with name and description fields
 */
export function validateSkill(input: {
  name: string;
  description?: string | null;
  content: string;
}): ValidationResult {
  const errors: string[] = [];

  // Validate name
  if (!input.name) {
    errors.push('Name is required');
  } else if (!NAME_PATTERN.test(input.name)) {
    errors.push('Name must be lowercase letters, digits, and hyphens only (e.g. "my-skill")');
  }

  // Validate description
  if (!input.description) {
    errors.push('Description is required');
  } else if (input.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`Description must be at most ${MAX_DESCRIPTION_LENGTH} characters`);
  }

  // Validate content has frontmatter with name and description
  if (!input.content) {
    errors.push('Content is required');
  } else {
    try {
      const { data } = matter(input.content);
      if (!data.name) {
        errors.push('Content frontmatter must include a "name" field');
      }
      if (!data.description) {
        errors.push('Content frontmatter must include a "description" field');
      }
    } catch {
      errors.push('Content must contain valid YAML frontmatter');
    }
  }

  return { valid: errors.length === 0, errors };
}
