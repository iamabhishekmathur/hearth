import { describe, it, expect } from 'vitest';

// Unit tests for identity permission logic

function canEditIdentity(
  role: string,
  level: 'org' | 'user',
  fileType: 'soul' | 'identity',
): { allowed: boolean; reason?: string } {
  if (level === 'org' && role !== 'admin') {
    return { allowed: false, reason: 'Only admins can edit org-level identity' };
  }
  if (fileType === 'identity' && level === 'org') {
    return { allowed: false, reason: 'IDENTITY.md is only available at user level' };
  }
  return { allowed: true };
}

describe('Identity permissions', () => {
  describe('org-level SOUL.md', () => {
    it('allows admin', () => {
      expect(canEditIdentity('admin', 'org', 'soul').allowed).toBe(true);
    });

    it('denies member', () => {
      const result = canEditIdentity('member', 'org', 'soul');
      expect(result.allowed).toBe(false);
    });

    it('denies team_lead', () => {
      const result = canEditIdentity('team_lead', 'org', 'soul');
      expect(result.allowed).toBe(false);
    });
  });

  describe('user-level SOUL.md', () => {
    it('allows any role', () => {
      expect(canEditIdentity('admin', 'user', 'soul').allowed).toBe(true);
      expect(canEditIdentity('member', 'user', 'soul').allowed).toBe(true);
      expect(canEditIdentity('viewer', 'user', 'soul').allowed).toBe(true);
    });
  });

  describe('user-level IDENTITY.md', () => {
    it('allows any role', () => {
      expect(canEditIdentity('admin', 'user', 'identity').allowed).toBe(true);
      expect(canEditIdentity('member', 'user', 'identity').allowed).toBe(true);
    });
  });

  describe('org-level IDENTITY.md', () => {
    it('is not allowed for any role', () => {
      const result = canEditIdentity('admin', 'org', 'identity');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('only available at user level');
    });
  });
});
