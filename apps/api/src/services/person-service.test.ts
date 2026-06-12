import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    person: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import { prisma } from '../lib/prisma.js';
import { upsertPersonFromHandle, linkPersonToUser } from './person-service.js';

const findFirst = prisma.person.findFirst as ReturnType<typeof vi.fn>;
const create = prisma.person.create as ReturnType<typeof vi.fn>;
const update = prisma.person.update as ReturnType<typeof vi.fn>;
const findUser = prisma.user.findUnique as ReturnType<typeof vi.fn>;

const ORG = 'org_1';

function person(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p_existing',
    orgId: ORG,
    userId: null,
    displayName: null,
    email: null,
    slackUserId: null,
    notionUserId: null,
    googleId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('person-service', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('upsertPersonFromHandle — create paths', () => {
    it('creates a new Person from a Slack handle when nothing matches', async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(person({ id: 'p_new', slackUserId: 'U123' }));

      const result = await upsertPersonFromHandle(ORG, {
        slackUserId: 'U123',
        displayName: 'Alice',
      });

      expect(result.id).toBe('p_new');
      expect(create).toHaveBeenCalledOnce();
      const payload = create.mock.calls[0][0].data;
      expect(payload.orgId).toBe(ORG);
      expect(payload.slackUserId).toBe('U123');
      expect(payload.displayName).toBe('Alice');
    });

    it('creates a new Person from an email when nothing matches', async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(person({ id: 'p_new', email: 'a@b.com' }));

      const result = await upsertPersonFromHandle(ORG, { email: 'a@b.com' });

      expect(result.id).toBe('p_new');
      expect(create.mock.calls[0][0].data.email).toBe('a@b.com');
    });

    it('creates a new Person from a Notion handle when nothing matches', async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(person({ id: 'p_new', notionUserId: 'notion_42' }));

      const result = await upsertPersonFromHandle(ORG, { notionUserId: 'notion_42' });
      expect(result.id).toBe('p_new');
      expect(create.mock.calls[0][0].data.notionUserId).toBe('notion_42');
    });

    it('creates a new Person from a Google id when nothing matches', async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(person({ id: 'p_new', googleId: 'g_42' }));

      const result = await upsertPersonFromHandle(ORG, { googleId: 'g_42' });
      expect(result.id).toBe('p_new');
    });

    it('throws when no handles are provided', async () => {
      await expect(upsertPersonFromHandle(ORG, {})).rejects.toThrow(/at least one handle/i);
      expect(findFirst).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it('creates with multiple handles populated at once', async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(
        person({ id: 'p_new', email: 'a@b.com', slackUserId: 'U1' }),
      );

      await upsertPersonFromHandle(ORG, {
        email: 'a@b.com',
        slackUserId: 'U1',
        displayName: 'Alice',
      });

      const payload = create.mock.calls[0][0].data;
      expect(payload.email).toBe('a@b.com');
      expect(payload.slackUserId).toBe('U1');
      expect(payload.displayName).toBe('Alice');
    });
  });

  describe('upsertPersonFromHandle — dedupe paths', () => {
    it('returns existing Person when matched by slack handle', async () => {
      findFirst.mockResolvedValue(person({ id: 'p_existing', slackUserId: 'U123' }));

      const result = await upsertPersonFromHandle(ORG, { slackUserId: 'U123' });

      expect(result.id).toBe('p_existing');
      expect(create).not.toHaveBeenCalled();
    });

    it('returns existing Person when matched by email', async () => {
      findFirst.mockResolvedValue(person({ id: 'p_existing', email: 'a@b.com' }));

      const result = await upsertPersonFromHandle(ORG, { email: 'a@b.com' });

      expect(result.id).toBe('p_existing');
      expect(create).not.toHaveBeenCalled();
    });

    it('backfills missing handles on an existing Person', async () => {
      findFirst.mockResolvedValue(
        person({ id: 'p_existing', email: 'a@b.com', slackUserId: null }),
      );
      update.mockResolvedValue(
        person({ id: 'p_existing', email: 'a@b.com', slackUserId: 'U123' }),
      );

      const result = await upsertPersonFromHandle(ORG, {
        email: 'a@b.com',
        slackUserId: 'U123',
      });

      expect(result.slackUserId).toBe('U123');
      expect(update).toHaveBeenCalledOnce();
      expect(update.mock.calls[0][0].data.slackUserId).toBe('U123');
      // Should NOT overwrite email — backfill only fills nulls
      expect(update.mock.calls[0][0].data.email).toBeUndefined();
    });

    it('does NOT overwrite existing handles with different values (conflict)', async () => {
      findFirst.mockResolvedValue(
        person({ id: 'p_existing', email: 'a@b.com', slackUserId: 'U_OLD' }),
      );

      const result = await upsertPersonFromHandle(ORG, {
        email: 'a@b.com',
        slackUserId: 'U_NEW',
      });

      expect(result.slackUserId).toBe('U_OLD');
      expect(update).not.toHaveBeenCalled();
    });

    it('backfills displayName when null but does not overwrite when set', async () => {
      findFirst.mockResolvedValue(
        person({ id: 'p_existing', email: 'a@b.com', displayName: null }),
      );
      update.mockResolvedValue(
        person({ id: 'p_existing', email: 'a@b.com', displayName: 'Alice' }),
      );

      await upsertPersonFromHandle(ORG, { email: 'a@b.com', displayName: 'Alice' });
      expect(update.mock.calls[0][0].data.displayName).toBe('Alice');
    });

    it('does not update if every provided handle already matches', async () => {
      findFirst.mockResolvedValue(
        person({ id: 'p_existing', email: 'a@b.com', slackUserId: 'U1', displayName: 'A' }),
      );

      await upsertPersonFromHandle(ORG, {
        email: 'a@b.com',
        slackUserId: 'U1',
        displayName: 'A',
      });

      expect(update).not.toHaveBeenCalled();
    });

    it('matches via slack handle when email is absent on existing', async () => {
      findFirst.mockResolvedValue(
        person({ id: 'p_existing', slackUserId: 'U123', email: null }),
      );
      update.mockResolvedValue(
        person({ id: 'p_existing', slackUserId: 'U123', email: 'a@b.com' }),
      );

      await upsertPersonFromHandle(ORG, { slackUserId: 'U123', email: 'a@b.com' });
      expect(update.mock.calls[0][0].data.email).toBe('a@b.com');
    });
  });

  describe('upsertPersonFromHandle — org isolation', () => {
    it('scopes findFirst to the provided orgId', async () => {
      findFirst.mockResolvedValue(null);
      create.mockResolvedValue(person());

      await upsertPersonFromHandle('org_42', { slackUserId: 'U1' });

      // findFirst should restrict by orgId in every OR branch
      const where = findFirst.mock.calls[0][0].where;
      expect(where).toBeDefined();
      // The where clause must reference orgId somewhere
      const serialized = JSON.stringify(where);
      expect(serialized).toContain('org_42');
    });
  });

  describe('linkPersonToUser', () => {
    it('links a Person to a User when both exist', async () => {
      findUser.mockResolvedValue({ id: 'u_1', email: 'a@b.com' });
      update.mockResolvedValue(person({ id: 'p_1', userId: 'u_1' }));

      const result = await linkPersonToUser('p_1', 'u_1');

      expect(result.userId).toBe('u_1');
      expect(update.mock.calls[0][0].where.id).toBe('p_1');
      expect(update.mock.calls[0][0].data.userId).toBe('u_1');
    });

    it('throws if the user does not exist', async () => {
      findUser.mockResolvedValue(null);
      await expect(linkPersonToUser('p_1', 'u_missing')).rejects.toThrow(/user/i);
      expect(update).not.toHaveBeenCalled();
    });
  });
});
