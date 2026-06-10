import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──
// bcrypt is mocked so we exercise the service branching (first-user/admin, OAuth
// link, credential validation) without real hashing cost or a database.

vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn(async (pw: string) => `hashed:${pw}`),
    compare: vi.fn(async (pw: string, hash: string) => hash === `hashed:${pw}`),
  },
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    org: {
      upsert: vi.fn(),
    },
    team: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// The OAuth provisioner is dynamically imported inside findOrCreateOAuthUser.
const getOAuthProvisioner = vi.fn(() => null as unknown);
vi.mock('../extensions/oauth-provisioner.js', () => ({
  getOAuthProvisioner: () => getOAuthProvisioner(),
}));

import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';
import { register, validateCredentials, findOrCreateOAuthUser } from './auth-service.js';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  getOAuthProvisioner.mockReturnValue(null);
  // Sensible org/team defaults for first-user creation paths.
  asMock(prisma.org.upsert).mockResolvedValue({ id: 'org-1', slug: 'default' });
  asMock(prisma.team.findFirst).mockResolvedValue({ id: 'team-1', orgId: 'org-1' });
  asMock(prisma.team.create).mockResolvedValue({ id: 'team-1', orgId: 'org-1' });
  asMock(prisma.user.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'user-new',
    ...data,
  }));
});

// ── register ──

describe('register (AUTH-H-02/H-03, AUTH-ER-05)', () => {
  it('rejects a duplicate email (AUTH-ER-05)', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue({ id: 'existing', email: 'dup@example.com' });

    await expect(register('dup@example.com', 'pw', 'Dup')).rejects.toThrow('Email already registered');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('hashes the password with bcrypt before storing', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue(null);
    asMock(prisma.user.count).mockResolvedValue(5);

    await register('new@example.com', 'sup3rsecret', 'New User');

    expect(bcrypt.hash).toHaveBeenCalledWith('sup3rsecret', 12);
    const createArg = asMock(prisma.user.create).mock.calls[0][0];
    expect(createArg.data.passwordHash).toBe('hashed:sup3rsecret');
    // never stores the plaintext password
    expect(createArg.data).not.toHaveProperty('password');
  });

  it('makes the first user an admin and provisions the default org + team (AUTH-H-03)', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue(null);
    asMock(prisma.user.count).mockResolvedValue(0);

    await register('founder@example.com', 'pw', 'Founder');

    expect(prisma.org.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'default' } }),
    );
    const createArg = asMock(prisma.user.create).mock.calls[0][0];
    expect(createArg.data.role).toBe('admin');
    expect(createArg.data.teamId).toBe('team-1');
    expect(createArg.data.authProvider).toBe('email');
  });

  it('creates the default team when the org has none yet (first user)', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue(null);
    asMock(prisma.user.count).mockResolvedValue(0);
    asMock(prisma.team.findFirst).mockResolvedValue(null); // org exists but no team

    await register('founder@example.com', 'pw', 'Founder');

    expect(prisma.team.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1' }) }),
    );
  });

  it('makes every subsequent user a hard-coded member (AUTH-H-02)', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue(null);
    asMock(prisma.user.count).mockResolvedValue(3);

    await register('member@example.com', 'pw', 'Member');

    const createArg = asMock(prisma.user.create).mock.calls[0][0];
    expect(createArg.data.role).toBe('member');
    // subsequent users do NOT trigger org provisioning
    expect(prisma.org.upsert).not.toHaveBeenCalled();
  });

  it('assigns a non-first user to the first available team', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue(null);
    asMock(prisma.user.count).mockResolvedValue(3);
    asMock(prisma.team.findFirst).mockResolvedValue({ id: 'team-9', orgId: 'org-1' });

    await register('member@example.com', 'pw', 'Member');

    const createArg = asMock(prisma.user.create).mock.calls[0][0];
    expect(createArg.data.teamId).toBe('team-9');
  });

  it('tolerates no team existing for a subsequent user (teamId null)', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue(null);
    asMock(prisma.user.count).mockResolvedValue(3);
    asMock(prisma.team.findFirst).mockResolvedValue(null);

    await register('orphan@example.com', 'pw', 'Orphan');

    const createArg = asMock(prisma.user.create).mock.calls[0][0];
    expect(createArg.data.teamId).toBeNull();
  });

  it('stores a unicode/emoji name verbatim (AUTH-E-06)', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue(null);
    asMock(prisma.user.count).mockResolvedValue(2);

    await register('emoji@example.com', 'pw', '日本語 🎯');

    const createArg = asMock(prisma.user.create).mock.calls[0][0];
    expect(createArg.data.name).toBe('日本語 🎯');
  });

  it('AUTH-E-05: enforces NO server-side password minimum length (pins current behavior)', async () => {
    // DEFECT-adjacent (Part 3 #26 / AUTH-E-05): server has no password policy —
    // an empty-string password is accepted and hashed. Pins current behavior.
    asMock(prisma.user.findUnique).mockResolvedValue(null);
    asMock(prisma.user.count).mockResolvedValue(2);

    await expect(register('weak@example.com', '', 'Weak')).resolves.toBeTruthy();
    expect(bcrypt.hash).toHaveBeenCalledWith('', 12);
  });
});

// ── validateCredentials ──

describe('validateCredentials (AUTH-H-01, AUTH-ER-01)', () => {
  it('returns the user when the password matches', async () => {
    const user = { id: 'u1', email: 'a@example.com', passwordHash: 'hashed:correct' };
    asMock(prisma.user.findUnique).mockResolvedValue(user);

    const result = await validateCredentials('a@example.com', 'correct');
    expect(result).toBe(user);
  });

  it('returns null on a wrong password (AUTH-ER-01)', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue({
      id: 'u1',
      email: 'a@example.com',
      passwordHash: 'hashed:correct',
    });

    const result = await validateCredentials('a@example.com', 'wrong');
    expect(result).toBeNull();
  });

  it('returns null when the user does not exist', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue(null);

    const result = await validateCredentials('ghost@example.com', 'whatever');
    expect(result).toBeNull();
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it('returns null for an OAuth-only user with no passwordHash', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue({
      id: 'u1',
      email: 'oauth@example.com',
      passwordHash: null,
    });

    const result = await validateCredentials('oauth@example.com', 'anything');
    expect(result).toBeNull();
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });
});

// ── findOrCreateOAuthUser ──

describe('findOrCreateOAuthUser (AUTH-H-06, AUTH-X-05)', () => {
  const profile = { provider: 'google', email: 'g@example.com', name: 'Goog Le' };

  it('AUTH-X-05: links an existing email to OAuth with no provider check (pins current behavior)', async () => {
    // DEFECT (AUTH-X-05): an OAuth login for an email that already exists returns
    // that user regardless of which provider originally created it — account-takeover
    // surface if the upstream email is unverified. Pins current behavior.
    const existing = { id: 'u1', email: 'g@example.com', authProvider: 'email' };
    asMock(prisma.user.findUnique).mockResolvedValue(existing);

    const result = await findOrCreateOAuthUser(profile);
    expect(result).toBe(existing);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('provisions a new OAuth user as member when not the first user (AUTH-H-06)', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue(null);
    asMock(prisma.user.count).mockResolvedValue(4);

    const result = await findOrCreateOAuthUser(profile);

    const createArg = asMock(prisma.user.create).mock.calls[0][0];
    expect(createArg.data.role).toBe('member');
    expect(createArg.data.authProvider).toBe('google');
    expect(createArg.data).not.toHaveProperty('passwordHash');
    expect(result).toBeTruthy();
  });

  it('makes the first OAuth user an admin and provisions org/team', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue(null);
    asMock(prisma.user.count).mockResolvedValue(0);

    await findOrCreateOAuthUser(profile);

    expect(prisma.org.upsert).toHaveBeenCalled();
    const createArg = asMock(prisma.user.create).mock.calls[0][0];
    expect(createArg.data.role).toBe('admin');
  });

  it('delegates to a registered OAuth provisioner when present', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue(null);
    const provisioned = { id: 'cloud-user', email: 'g@example.com' };
    const provisioner = vi.fn(async () => provisioned);
    getOAuthProvisioner.mockReturnValue(provisioner);

    const result = await findOrCreateOAuthUser(profile);

    expect(provisioner).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google', email: 'g@example.com' }),
    );
    expect(result).toBe(provisioned);
    // provisioner short-circuits the OSS default user.create
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('falls back to OSS default when the provisioner returns null', async () => {
    asMock(prisma.user.findUnique).mockResolvedValue(null);
    asMock(prisma.user.count).mockResolvedValue(4);
    getOAuthProvisioner.mockReturnValue(vi.fn(async () => null));

    await findOrCreateOAuthUser(profile);

    expect(prisma.user.create).toHaveBeenCalledTimes(1);
  });
});
