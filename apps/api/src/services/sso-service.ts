import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { Prisma, type User } from '@prisma/client';

export interface SSOConfig {
  type: 'saml' | 'oidc';
  // SAML fields
  entryPoint?: string;
  issuer?: string;
  cert?: string;
  // OIDC fields
  discoveryUrl?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface SSOProfile {
  email: string;
  name: string;
  provider: 'saml' | 'oidc';
}

/**
 * Get SSO configuration for an org.
 */
export async function getSSOConfig(orgId: string): Promise<SSOConfig | null> {
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { ssoConfig: true },
  });

  if (!org?.ssoConfig) return null;
  return org.ssoConfig as unknown as SSOConfig;
}

/**
 * Get SSO config by org slug (used for login flow).
 */
export async function getSSOConfigBySlug(slug: string): Promise<{ orgId: string; config: SSOConfig } | null> {
  const org = await prisma.org.findUnique({
    where: { slug },
    select: { id: true, ssoConfig: true },
  });

  if (!org?.ssoConfig) return null;
  return { orgId: org.id, config: org.ssoConfig as unknown as SSOConfig };
}

/**
 * Save SSO configuration for an org.
 */
export async function saveSSOConfig(orgId: string, config: SSOConfig): Promise<void> {
  await prisma.org.update({
    where: { id: orgId },
    data: { ssoConfig: config as unknown as Prisma.InputJsonValue },
  });
  logger.info({ orgId, type: config.type }, 'SSO config saved');
}

/**
 * Find or create a user from an SSO profile (JIT provisioning).
 * If the user already exists (by email), returns them.
 * If they don't exist, creates them with the org's default team.
 */
export async function findOrCreateSSOUser(orgId: string, profile: SSOProfile): Promise<User> {
  // Check if user already exists
  const existing = await prisma.user.findUnique({ where: { email: profile.email } });
  if (existing) {
    return existing;
  }

  // Find a default team in the org for JIT provisioning
  const defaultTeam = await prisma.team.findFirst({ where: { orgId } });

  const user = await prisma.user.create({
    data: {
      email: profile.email,
      name: profile.name,
      authProvider: 'saml',
      role: 'member',
      teamId: defaultTeam?.id ?? null,
      preferences: {},
    },
  });

  logger.info({ userId: user.id, email: user.email, orgId }, 'JIT provisioned SSO user');
  return user;
}

/**
 * Validate SAML config has required fields.
 */
export function validateSAMLConfig(config: Partial<SSOConfig>): string[] {
  const errors: string[] = [];
  if (!config.entryPoint) errors.push('entryPoint is required for SAML');
  if (!config.issuer) errors.push('issuer is required for SAML');
  if (!config.cert) errors.push('cert is required for SAML');
  return errors;
}

/**
 * Validate OIDC config has required fields.
 */
export function validateOIDCConfig(config: Partial<SSOConfig>): string[] {
  const errors: string[] = [];
  if (!config.discoveryUrl) errors.push('discoveryUrl is required for OIDC');
  if (!config.clientId) errors.push('clientId is required for OIDC');
  if (!config.clientSecret) errors.push('clientSecret is required for OIDC');
  return errors;
}
