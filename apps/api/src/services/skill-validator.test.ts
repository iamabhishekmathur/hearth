import { describe, it, expect } from 'vitest';
import { validateSkill } from './skill-validator.js';

const validFrontmatter = `---
name: my-skill
description: A test skill
---
# My Skill`;

describe('validateSkill', () => {
  it('passes for a valid skill', () => {
    const result = validateSkill({
      name: 'my-skill',
      description: 'A valid description',
      content: validFrontmatter,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns error when name is missing', () => {
    const result = validateSkill({
      name: '',
      description: 'A description',
      content: validFrontmatter,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Name is required');
  });

  it('returns error for uppercase name', () => {
    const result = validateSkill({
      name: 'MySkill',
      description: 'A description',
      content: validFrontmatter,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Name must be lowercase letters, digits, and hyphens only (e.g. "my-skill")',
    );
  });

  it('returns error for name with spaces', () => {
    const result = validateSkill({
      name: 'my skill',
      description: 'A description',
      content: validFrontmatter,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Name must be lowercase letters, digits, and hyphens only (e.g. "my-skill")',
    );
  });

  it('returns error for name with special characters', () => {
    const result = validateSkill({
      name: 'my_skill!',
      description: 'A description',
      content: validFrontmatter,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Name must be lowercase letters, digits, and hyphens only (e.g. "my-skill")',
    );
  });

  it('returns error for name starting with a digit', () => {
    const result = validateSkill({
      name: '1skill',
      description: 'A description',
      content: validFrontmatter,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Name must be lowercase letters, digits, and hyphens only (e.g. "my-skill")',
    );
  });

  it('returns error when description is missing', () => {
    const result = validateSkill({
      name: 'my-skill',
      description: null,
      content: validFrontmatter,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Description is required');
  });

  it('returns error when description is empty string', () => {
    const result = validateSkill({
      name: 'my-skill',
      description: '',
      content: validFrontmatter,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Description is required');
  });

  it('returns error when description exceeds 1024 characters', () => {
    const result = validateSkill({
      name: 'my-skill',
      description: 'a'.repeat(1025),
      content: validFrontmatter,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Description must be at most 1024 characters');
  });

  it('accepts description at exactly 1024 characters', () => {
    const result = validateSkill({
      name: 'my-skill',
      description: 'a'.repeat(1024),
      content: validFrontmatter,
    });
    expect(result.valid).toBe(true);
  });

  it('returns error when content is missing', () => {
    const result = validateSkill({
      name: 'my-skill',
      description: 'A description',
      content: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Content is required');
  });

  it('returns error when content has no frontmatter', () => {
    const result = validateSkill({
      name: 'my-skill',
      description: 'A description',
      content: '# Just a heading with no frontmatter',
    });
    expect(result.valid).toBe(false);
    // gray-matter parses content without --- delimiters as having empty data
    expect(result.errors).toContain('Content frontmatter must include a "name" field');
    expect(result.errors).toContain('Content frontmatter must include a "description" field');
  });

  it('returns error when frontmatter is missing name', () => {
    const content = `---
description: A skill description
---
# My Skill`;
    const result = validateSkill({
      name: 'my-skill',
      description: 'A description',
      content,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Content frontmatter must include a "name" field');
  });

  it('returns error when frontmatter is missing description', () => {
    const content = `---
name: my-skill
---
# My Skill`;
    const result = validateSkill({
      name: 'my-skill',
      description: 'A description',
      content,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Content frontmatter must include a "description" field');
  });

  it('collects multiple errors at once', () => {
    const result = validateSkill({
      name: '',
      description: null,
      content: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Name is required');
    expect(result.errors).toContain('Description is required');
    expect(result.errors).toContain('Content is required');
    expect(result.errors).toHaveLength(3);
  });
});
