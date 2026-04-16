import { describe, it, expect } from 'vitest';

// Unit test for system prompt assembly logic

describe('System prompt assembly', () => {
  function assemblePrompt(parts: {
    orgSoul?: string;
    userSoul?: string;
    userIdentity?: string;
    defaultPrompt: string;
    memories?: string[];
    skills?: Array<{ name: string; description: string; content: string }>;
  }): string {
    const sections: string[] = [];

    // Identity chain
    if (parts.orgSoul) sections.push(parts.orgSoul);
    if (parts.userSoul) sections.push(parts.userSoul);
    if (parts.userIdentity) sections.push(parts.userIdentity);

    // Default if no identity
    if (sections.length === 0) sections.push(parts.defaultPrompt);

    // Memories
    if (parts.memories && parts.memories.length > 0) {
      sections.push('\n## Relevant Memory');
      sections.push('The following context has been retrieved from memory:\n');
      for (const mem of parts.memories) {
        sections.push(`- ${mem}`);
      }
    }

    // Skills
    if (parts.skills && parts.skills.length > 0) {
      sections.push('\n## Installed Skills');
      for (const skill of parts.skills) {
        sections.push(`### ${skill.name}`);
        sections.push(skill.description);
        sections.push(skill.content);
      }
    }

    return sections.join('\n\n');
  }

  it('uses default prompt when no identity is set', () => {
    const prompt = assemblePrompt({ defaultPrompt: 'Hello' });
    expect(prompt).toBe('Hello');
  });

  it('uses org SOUL.md when set', () => {
    const prompt = assemblePrompt({
      orgSoul: 'You are OrgBot.',
      defaultPrompt: 'Default',
    });
    expect(prompt).toContain('You are OrgBot.');
    expect(prompt).not.toContain('Default');
  });

  it('chains org + user SOUL.md + IDENTITY.md', () => {
    const prompt = assemblePrompt({
      orgSoul: 'Org personality.',
      userSoul: 'User preferences.',
      userIdentity: 'User identity details.',
      defaultPrompt: 'Default',
    });
    expect(prompt).toContain('Org personality.');
    expect(prompt).toContain('User preferences.');
    expect(prompt).toContain('User identity details.');
  });

  it('includes memories when provided', () => {
    const prompt = assemblePrompt({
      defaultPrompt: 'Default',
      memories: ['Meeting at 3pm', 'Prefers Python'],
    });
    expect(prompt).toContain('Relevant Memory');
    expect(prompt).toContain('Meeting at 3pm');
    expect(prompt).toContain('Prefers Python');
  });

  it('includes skills when provided', () => {
    const prompt = assemblePrompt({
      defaultPrompt: 'Default',
      skills: [{ name: 'code-review', description: 'Reviews code', content: '# Steps\n1. Read code' }],
    });
    expect(prompt).toContain('Installed Skills');
    expect(prompt).toContain('code-review');
    expect(prompt).toContain('Reviews code');
  });
});
