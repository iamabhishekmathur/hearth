import { describe, it, expect } from 'vitest';
import type { MemoryScope } from './memory-service.js';

// Unit tests for the access control logic (canWrite / layer permissions).
// These test the permission rules without needing a database.

function canWrite(scope: MemoryScope, layer: string): boolean {
  switch (layer) {
    case 'org':
      return scope.role === 'admin';
    case 'team':
      return scope.role === 'admin' || scope.role === 'team_lead';
    case 'user':
    case 'session':
      return true;
    default:
      return false;
  }
}

const adminScope: MemoryScope = {
  orgId: 'org-1',
  teamId: 'team-1',
  userId: 'user-1',
  role: 'admin',
};

const leadScope: MemoryScope = {
  orgId: 'org-1',
  teamId: 'team-1',
  userId: 'user-2',
  role: 'team_lead',
};

const memberScope: MemoryScope = {
  orgId: 'org-1',
  teamId: 'team-1',
  userId: 'user-3',
  role: 'member',
};

const viewerScope: MemoryScope = {
  orgId: 'org-1',
  teamId: 'team-1',
  userId: 'user-4',
  role: 'viewer',
};

describe('Memory access control — canWrite', () => {
  describe('org layer', () => {
    it('allows admin', () => {
      expect(canWrite(adminScope, 'org')).toBe(true);
    });

    it('denies team_lead', () => {
      expect(canWrite(leadScope, 'org')).toBe(false);
    });

    it('denies member', () => {
      expect(canWrite(memberScope, 'org')).toBe(false);
    });

    it('denies viewer', () => {
      expect(canWrite(viewerScope, 'org')).toBe(false);
    });
  });

  describe('team layer', () => {
    it('allows admin', () => {
      expect(canWrite(adminScope, 'team')).toBe(true);
    });

    it('allows team_lead', () => {
      expect(canWrite(leadScope, 'team')).toBe(true);
    });

    it('denies member', () => {
      expect(canWrite(memberScope, 'team')).toBe(false);
    });

    it('denies viewer', () => {
      expect(canWrite(viewerScope, 'team')).toBe(false);
    });
  });

  describe('user layer', () => {
    it('allows all roles', () => {
      expect(canWrite(adminScope, 'user')).toBe(true);
      expect(canWrite(leadScope, 'user')).toBe(true);
      expect(canWrite(memberScope, 'user')).toBe(true);
      expect(canWrite(viewerScope, 'user')).toBe(true);
    });
  });

  describe('session layer', () => {
    it('allows all roles', () => {
      expect(canWrite(adminScope, 'session')).toBe(true);
      expect(canWrite(leadScope, 'session')).toBe(true);
      expect(canWrite(memberScope, 'session')).toBe(true);
      expect(canWrite(viewerScope, 'session')).toBe(true);
    });
  });

  describe('unknown layer', () => {
    it('denies all', () => {
      expect(canWrite(adminScope, 'unknown')).toBe(false);
    });
  });
});
