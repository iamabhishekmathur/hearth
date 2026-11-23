import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    invitation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    team: {
      findFirst: vi.fn(),
    },
    org: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('bcrypt', () => ({
  default: { hash: vi.fn(async () => 'hashed-pw') },
}));

const captureMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../lib/analytics.js', () => ({
  capture: (...args: unknown[]) => captureMock(...args),
}));

const sendEmailMock = vi.fn(async (..._args: unknown[]) => undefined);
let emailConfigured = false;
vi.mock('./email-service.js', () => ({
  isEmailConfigured: () => emailConfigured,
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

import { prisma } from '../lib/prisma.js';
import {
  createInvite,
  acceptInvite,
  revokeInvite,
  listInvites,
  getPreviewByToken,
} from './invitation-service.js';

const invFindFirst = prisma.invitation.findFirst as ReturnType<typeof vi.fn>;
const invFindUnique = prisma.invitation.findUnique as ReturnType<typeof vi.fn>;
const invCreate = prisma.invitation.create as ReturnType<typeof vi.fn>;
const invUpdate = prisma.invitation.update as ReturnType<typeof vi.fn>;
const invUpdateMany = prisma.invitation.updateMany as ReturnType<typeof vi.fn>;
const invFindMany = prisma.invitation.findMany as ReturnType<typeof vi.fn>;
const userFindUnique = prisma.user.findUnique as ReturnType<typeof vi.fn>;
const userCreate = prisma.user.create as ReturnType<typeof vi.fn>;
const teamFindFirst = prisma.team.findFirst as ReturnType<typeof vi.fn>;
const txMock = prisma.$transaction as ReturnType<typeof vi.fn>;

const ORG = 'org_1';
const INVITER = 'user_inviter';

function pendingInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv_1',
    orgId: ORG,
    email: 'teammate@acme.com',
    token: 'tok_abc',
    invitedByUserId: INVITER,
    role: 'member',
    status: 'pending',
    contextType: null,
    contextId: null,
    expiresAt: new Date(Date.now() + 1_000_000),
    createdAt: new Date(),
    acceptedAt: null,
    acceptedUserId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  emailConfigured = false;
});

describe('createInvite', () => {
  it('creates a new pending invite when none exists, returns acceptUrl + emits INVITE_SENT', async () => {
    invFindFirst.mockResolvedValue(null);
    invCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      pendingInvite({ token: data.token, email: data.email }),
    );

    const { invite, acceptUrl } = await createInvite({
      orgId: ORG,
      email: 'Teammate@Acme.com',
      invitedByUserId: INVITER,
    });

    expect(invCreate).toHaveBeenCalledOnce();
    expect(invUpdate).not.toHaveBeenCalled();
    // Email normalized to lowercase before persist.
    expect(invCreate.mock.calls[0][0].data.email).toBe('teammate@acme.com');
    expect(acceptUrl).toBe(`http://localhost:3000#/invite/${invite.token}`);
    expect(captureMock).toHaveBeenCalledWith(
      INVITER,
      'invite_sent',
      expect.objectContaining({ count: 1 }),
    );
    // No SMTP/RESEND configured -> no send, but acceptUrl still returned.
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('is idempotent: reuses + refreshes the existing pending invite (same id, new token)', async () => {
    const existing = pendingInvite({ token: 'old_tok' });
    invFindFirst.mockResolvedValue(existing);
    invUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      pendingInvite({ id: existing.id, token: data.token }),
    );

    const { invite } = await createInvite({
      orgId: ORG,
      email: 'teammate@acme.com',
      invitedByUserId: INVITER,
    });

    expect(invCreate).not.toHaveBeenCalled();
    expect(invUpdate).toHaveBeenCalledOnce();
    expect(invUpdate.mock.calls[0][0].where).toEqual({ id: existing.id });
    expect(invite.id).toBe(existing.id);
    expect(invite.token).not.toBe('old_tok');
  });

  it('sends the invite email when email is configured', async () => {
    emailConfigured = true;
    invFindFirst.mockResolvedValue(null);
    invCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      pendingInvite({ token: data.token }),
    );
    (prisma.org.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'Acme' });

    await createInvite({ orgId: ORG, email: 'teammate@acme.com', invitedByUserId: INVITER });

    expect(sendEmailMock).toHaveBeenCalledOnce();
    const emailArg = sendEmailMock.mock.calls[0]![0] as { to: string };
    expect(emailArg.to).toBe('teammate@acme.com');
  });

  it('persists context for a contextual invite', async () => {
    invFindFirst.mockResolvedValue(null);
    invCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      pendingInvite({ ...data }),
    );

    const { invite } = await createInvite({
      orgId: ORG,
      email: 'teammate@acme.com',
      invitedByUserId: INVITER,
      context: { type: 'decision', id: 'dec_42' },
    });

    expect(invCreate.mock.calls[0][0].data.contextType).toBe('decision');
    expect(invCreate.mock.calls[0][0].data.contextId).toBe('dec_42');
    expect(invite.contextType).toBe('decision');
  });
});

describe('acceptInvite', () => {
  it('creates a member user in the org, marks accepted, returns context + emits INVITE_ACCEPTED', async () => {
    const invite = pendingInvite({ contextType: 'task', contextId: 'task_9' });
    invFindUnique.mockResolvedValue(invite);
    userFindUnique.mockResolvedValue(null);
    teamFindFirst.mockResolvedValue({ id: 'team_1' });

    const createdUser = { id: 'new_user', email: invite.email, name: 'New Person', role: 'member' };
    // Drive the real transaction body against a tx that proxies the same mocks.
    txMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      userCreate.mockResolvedValue(createdUser);
      return fn({
        user: { create: userCreate },
        invitation: { update: invUpdate },
      });
    });
    invUpdate.mockResolvedValue(pendingInvite({ status: 'accepted' }));

    const { user, context } = await acceptInvite('tok_abc', {
      name: 'New Person',
      password: 'supersecret',
    });

    expect(user).toEqual(createdUser);
    expect(userCreate.mock.calls[0][0].data).toMatchObject({
      email: invite.email,
      role: 'member',
      teamId: 'team_1',
      authProvider: 'email',
    });
    expect(invUpdate.mock.calls[0][0].data).toMatchObject({
      status: 'accepted',
      acceptedUserId: 'new_user',
    });
    expect(context).toEqual({ type: 'task', id: 'task_9' });
    expect(captureMock).toHaveBeenCalledWith('new_user', 'invite_accepted', {
      inviteId: invite.id,
    });
  });

  it('rejects an unknown token', async () => {
    invFindUnique.mockResolvedValue(null);
    await expect(
      acceptInvite('nope', { name: 'X', password: 'supersecret' }),
    ).rejects.toThrow('Invitation not found');
  });

  it('rejects a non-pending invite', async () => {
    invFindUnique.mockResolvedValue(pendingInvite({ status: 'revoked' }));
    await expect(
      acceptInvite('tok_abc', { name: 'X', password: 'supersecret' }),
    ).rejects.toThrow('Invitation is no longer valid');
  });

  it('expires + rejects a past-expiry invite', async () => {
    invFindUnique.mockResolvedValue(
      pendingInvite({ expiresAt: new Date(Date.now() - 1000) }),
    );
    invUpdate.mockResolvedValue({});
    await expect(
      acceptInvite('tok_abc', { name: 'X', password: 'supersecret' }),
    ).rejects.toThrow('Invitation is no longer valid');
    expect(invUpdate).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data: { status: 'expired' },
    });
  });

  it('rejects when a user already exists with that email', async () => {
    invFindUnique.mockResolvedValue(pendingInvite());
    userFindUnique.mockResolvedValue({ id: 'existing' });
    await expect(
      acceptInvite('tok_abc', { name: 'X', password: 'supersecret' }),
    ).rejects.toThrow('Email already registered');
  });
});

describe('revokeInvite', () => {
  it('revokes a pending invite scoped by id + orgId', async () => {
    invUpdateMany.mockResolvedValue({ count: 1 });
    const ok = await revokeInvite('inv_1', ORG);
    expect(ok).toBe(true);
    expect(invUpdateMany).toHaveBeenCalledWith({
      where: { id: 'inv_1', orgId: ORG, status: 'pending' },
      data: { status: 'revoked' },
    });
  });

  it('returns false when nothing matched (wrong org or not pending)', async () => {
    invUpdateMany.mockResolvedValue({ count: 0 });
    expect(await revokeInvite('inv_1', 'other_org')).toBe(false);
  });
});

describe('listInvites', () => {
  it('lists org invites newest-first, scoped by orgId', async () => {
    invFindMany.mockResolvedValue([pendingInvite()]);
    const out = await listInvites(ORG);
    expect(out).toHaveLength(1);
    expect(invFindMany).toHaveBeenCalledWith({
      where: { orgId: ORG },
      orderBy: { createdAt: 'desc' },
    });
  });
});

describe('getPreviewByToken', () => {
  it('returns org + inviter + context for a valid pending invite', async () => {
    invFindUnique.mockResolvedValue({
      ...pendingInvite({ contextType: 'chat_session', contextId: 'sess_3' }),
      org: { name: 'Acme' },
      invitedBy: { name: 'Dana' },
    });
    const preview = await getPreviewByToken('tok_abc');
    expect(preview).toEqual({
      orgName: 'Acme',
      invitedByName: 'Dana',
      email: 'teammate@acme.com',
      context: { type: 'chat_session', id: 'sess_3' },
    });
  });

  it('returns null for unknown / non-pending / expired tokens', async () => {
    invFindUnique.mockResolvedValue(null);
    expect(await getPreviewByToken('x')).toBeNull();

    invFindUnique.mockResolvedValue({
      ...pendingInvite({ status: 'accepted' }),
      org: { name: 'Acme' },
      invitedBy: { name: 'Dana' },
    });
    expect(await getPreviewByToken('x')).toBeNull();

    invFindUnique.mockResolvedValue({
      ...pendingInvite({ expiresAt: new Date(Date.now() - 1000) }),
      org: { name: 'Acme' },
      invitedBy: { name: 'Dana' },
    });
    expect(await getPreviewByToken('x')).toBeNull();
  });
});
