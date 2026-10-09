import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    skill: { create: vi.fn(), findMany: vi.fn() },
  },
}));

import { prisma } from '../lib/prisma.js';
import {
  createSkill,
  assertValidCommandFields,
  InvalidCommandSlugError,
} from './skill-service.js';
import { isUniqueViolation, uniqueViolationTarget } from '../lib/prisma-errors.js';

const VALID_CONTENT = `---\nname: standup\ndescription: Daily standup\n---\nBody.`;

function baseInput() {
  return {
    orgId: 'org_1',
    authorId: 'u_1',
    name: 'standup',
    description: 'Daily standup',
    content: VALID_CONTENT,
  };
}

describe('skill-service — W6 command fields', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('assertValidCommandFields', () => {
    it('no-ops when not invocable', () => {
      expect(() => assertValidCommandFields({ invocableAsCommand: false })).not.toThrow();
    });

    it('requires a slug when invocable', () => {
      expect(() => assertValidCommandFields({ invocableAsCommand: true, commandSlug: '' }))
        .toThrow(InvalidCommandSlugError);
    });

    it('rejects a bad slug format', () => {
      expect(() => assertValidCommandFields({ invocableAsCommand: true, commandSlug: 'Bad Slug' }))
        .toThrow(/lowercase/);
    });

    it('rejects a slug that shadows a built-in (/task)', () => {
      expect(() => assertValidCommandFields({ invocableAsCommand: true, commandSlug: 'task' }))
        .toThrow(/reserved built-in/);
    });

    it('accepts a valid non-built-in slug', () => {
      expect(() => assertValidCommandFields({ invocableAsCommand: true, commandSlug: 'standup' }))
        .not.toThrow();
    });
  });

  describe('createSkill persists command fields', () => {
    it('stores invocableAsCommand + slug + params', async () => {
      (prisma.skill.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1' });
      await createSkill({
        ...baseInput(),
        invocableAsCommand: true,
        commandSlug: 'standup',
        commandParams: [{ name: 'date', type: 'date', label: 'Date', required: true }],
      });
      const arg = (prisma.skill.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(arg.data.invocableAsCommand).toBe(true);
      expect(arg.data.commandSlug).toBe('standup');
      expect(arg.data.commandParams).toEqual([{ name: 'date', type: 'date', label: 'Date', required: true }]);
    });

    it('nulls the slug when not invocable (no stray slug lingers)', async () => {
      (prisma.skill.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1' });
      await createSkill({ ...baseInput(), invocableAsCommand: false, commandSlug: 'standup' });
      const arg = (prisma.skill.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(arg.data.commandSlug).toBeNull();
    });

    it('rejects a built-in-shadowing slug before hitting the DB (case 37 / J6)', async () => {
      await expect(
        createSkill({ ...baseInput(), invocableAsCommand: true, commandSlug: 'plan' }),
      ).rejects.toBeInstanceOf(InvalidCommandSlugError);
      expect(prisma.skill.create).not.toHaveBeenCalled();
    });
  });

  // Case 37 — slug uniqueness is enforced per org by the DB unique index. The
  // service surfaces the P2002 (meta.target carries the index name) so the route
  // can map a slug collision to 409 with the right message.
  describe('slug uniqueness (case 37)', () => {
    it('a P2002 on the command-slug index is recognized as a slug collision', () => {
      const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: 'skills_org_command_slug_unique' },
      });
      expect(isUniqueViolation(err)).toBe(true);
      expect(uniqueViolationTarget(err)).toContain('command_slug');
    });

    it('a P2002 on the name index is NOT a slug collision', () => {
      const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: 'skills_org_name_unique' },
      });
      expect(uniqueViolationTarget(err)).not.toContain('command_slug');
    });
  });
});
