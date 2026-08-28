import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    integration: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// connectIntegration pulls in the MCP gateway + backfill + onboarding side
// effects, none of which we exercise here. Stub them so importing the service
// stays side-effect free and the userId-persistence test is hermetic.
vi.mock('../mcp/token-store.js', () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ''),
}));
vi.mock('../mcp/gateway.js', () => ({
  mcpGateway: { connect: vi.fn(), disconnect: vi.fn(), healthCheck: vi.fn() },
}));
vi.mock('../jobs/work-intake-scheduler.js', () => ({
  enqueueConnectBackfill: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./onboarding-service.js', () => ({
  markStepComplete: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../lib/prisma.js';
import {
  listUserIntegrations,
  getUserManagedIntegration,
  connectIntegration,
} from './integration-service.js';

const findMany = prisma.integration.findMany as ReturnType<typeof vi.fn>;
const findUnique = prisma.integration.findUnique as ReturnType<typeof vi.fn>;
const create = prisma.integration.create as ReturnType<typeof vi.fn>;

const ORG = 'org_1';
const ME = 'user_me';
const OTHER = 'user_other';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listUserIntegrations', () => {
  it('queries for my-own OR org-level, scoped to my org', async () => {
    findMany.mockResolvedValue([]);
    await listUserIntegrations(ORG, ME);

    const where = findMany.mock.calls[0]![0].where;
    expect(where.orgId).toBe(ORG);
    expect(where.OR).toEqual([{ userId: ME }, { userId: null }]);
    // Never selects encrypted config.
    expect(findMany.mock.calls[0]![0].select).not.toHaveProperty('config');
  });
});

describe('getUserManagedIntegration (ownership)', () => {
  it('returns the integration when I own it', async () => {
    findUnique.mockResolvedValue({ id: 'i1', orgId: ORG, userId: ME });
    expect(await getUserManagedIntegration('i1', ORG, ME)).toEqual({
      id: 'i1',
      orgId: ORG,
      userId: ME,
    });
  });

  it('returns null for an org-level (null userId) integration — not member-managed', async () => {
    findUnique.mockResolvedValue({ id: 'i1', orgId: ORG, userId: null });
    expect(await getUserManagedIntegration('i1', ORG, ME)).toBeNull();
  });

  it("returns null for another member's personal integration", async () => {
    findUnique.mockResolvedValue({ id: 'i1', orgId: ORG, userId: OTHER });
    expect(await getUserManagedIntegration('i1', ORG, ME)).toBeNull();
  });

  it('returns null when the integration is in another org', async () => {
    findUnique.mockResolvedValue({ id: 'i1', orgId: 'org_2', userId: ME });
    expect(await getUserManagedIntegration('i1', ORG, ME)).toBeNull();
  });

  it('returns null when the integration does not exist', async () => {
    findUnique.mockResolvedValue(null);
    expect(await getUserManagedIntegration('missing', ORG, ME)).toBeNull();
  });
});

describe('connectIntegration ownership persistence', () => {
  it('persists userId when a member connects their own integration', async () => {
    create.mockResolvedValue({
      id: 'i1',
      provider: 'slack',
      status: 'active',
      enabled: true,
      createdAt: new Date(),
    });

    await connectIntegration(ORG, {
      provider: 'slack',
      credentials: { token: 'x' },
      userId: ME,
    });

    expect(create.mock.calls[0]![0].data).toMatchObject({ orgId: ORG, userId: ME });
  });

  it('stores null userId for the admin/org-level path (no userId supplied)', async () => {
    create.mockResolvedValue({
      id: 'i2',
      provider: 'slack',
      status: 'active',
      enabled: true,
      createdAt: new Date(),
    });

    await connectIntegration(ORG, {
      provider: 'slack',
      credentials: { token: 'x' },
    });

    expect(create.mock.calls[0]![0].data).toMatchObject({ orgId: ORG, userId: null });
  });
});
