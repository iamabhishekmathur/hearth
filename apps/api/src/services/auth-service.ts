import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';
import type { User } from '@prisma/client';

const BCRYPT_ROUNDS = 12;

interface OAuthProfile {
  provider: string;
  email: string;
  name: string;
}

/**
 * Resolve the team a non-first self-service signup should join: the bootstrap
 * org's oldest team. Single-org self-hosted has exactly one org, so this is
 * unambiguous; we pick the OLDEST org deterministically rather than by slug
 * because the setup wizard renames the bootstrap org (its slug is no longer
 * 'default' after the admin names their org). Cloud multi-tenant self-service
 * signup goes through the OAuth provisioner (a new org per signup), so it never
 * reaches this fallback — meaning "oldest org" is only ever the single
 * self-hosted org in practice.
 *
 * (Previously this used an unscoped `prisma.team.findFirst()` — first team in
 * the ENTIRE db, a cross-org leak; then `slug: 'default'`, which broke teammate
 * signup once the org was renamed. Oldest-org fixes both.)
 */
async function resolveDefaultTeam(): Promise<{ id: string } | null> {
  const org = await prisma.org.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!org) return null;
  return prisma.team.findFirst({
    where: { orgId: org.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
}

/**
 * Register a new user with email and password.
 * If this is the first user in the system, they become admin and a default org/team is created.
 */
export async function register(
  email: string,
  password: string,
  name: string,
): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error('Email already registered');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const userCount = await prisma.user.count();
  const isFirstUser = userCount === 0;

  // If first user, create default org and team
  if (isFirstUser) {
    const org = await prisma.org.upsert({
      where: { slug: 'default' },
      update: {},
      create: {
        name: 'Default Organization',
        slug: 'default',
        settings: {},
      },
    });

    let team = await prisma.team.findFirst({ where: { orgId: org.id } });
    if (!team) {
      team = await prisma.team.create({
        data: { name: 'Default Team', orgId: org.id },
      });
    }

    return prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        authProvider: 'email',
        role: 'admin',
        teamId: team.id,
        preferences: {},
      },
    });
  }

  // Non-first user: assign to the bootstrap `default` org's team (org-scoped).
  const defaultTeam = await resolveDefaultTeam();

  return prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      authProvider: 'email',
      role: 'member',
      teamId: defaultTeam?.id ?? null,
      preferences: {},
    },
  });
}

/**
 * Validate email/password credentials. Returns user if valid, null otherwise.
 */
export async function validateCredentials(
  email: string,
  password: string,
): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    return null;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  return valid ? user : null;
}

/**
 * Find or create a user from an OAuth profile.
 * If the user already exists (by email), returns them.
 * If this is the first user, they become admin.
 */
export async function findOrCreateOAuthUser(profile: OAuthProfile): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { email: profile.email } });
  if (existing) {
    return existing;
  }

  // Cloud (or any downstream consumer) can register an OAuthProvisioner
  // to take over new-user creation — used to auto-provision a new org per
  // signup. If the provisioner returns a User, use it. If it returns null
  // or no provisioner is registered, fall back to OSS default behavior.
  const { getOAuthProvisioner } = await import('../extensions/oauth-provisioner.js');
  const provisioner = getOAuthProvisioner();
  if (provisioner) {
    const user = await provisioner({
      provider: profile.provider as 'google' | 'github',
      email: profile.email,
      name: profile.name,
    });
    if (user) return user;
  }

  const userCount = await prisma.user.count();
  const isFirstUser = userCount === 0;

  // Create default org/team if first user
  if (isFirstUser) {
    const org = await prisma.org.upsert({
      where: { slug: 'default' },
      update: {},
      create: {
        name: 'Default Organization',
        slug: 'default',
        settings: {},
      },
    });

    let team = await prisma.team.findFirst({ where: { orgId: org.id } });
    if (!team) {
      team = await prisma.team.create({
        data: { name: 'Default Team', orgId: org.id },
      });
    }

    return prisma.user.create({
      data: {
        email: profile.email,
        name: profile.name,
        authProvider: profile.provider as 'google' | 'github',
        role: 'admin',
        teamId: team.id,
        preferences: {},
      },
    });
  }

  // Non-first OAuth user: assign to the bootstrap `default` org's team (org-scoped).
  const defaultTeam = await resolveDefaultTeam();

  return prisma.user.create({
    data: {
      email: profile.email,
      name: profile.name,
      authProvider: profile.provider as 'google' | 'github',
      role: 'member',
      teamId: defaultTeam?.id ?? null,
      preferences: {},
    },
  });
}
