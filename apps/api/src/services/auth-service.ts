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

  // Non-first user: assign to the first available team
  const defaultTeam = await prisma.team.findFirst();

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

  const defaultTeam = await prisma.team.findFirst();

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
