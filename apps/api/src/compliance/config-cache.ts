import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import type { OrgComplianceConfig } from './types.js';

const DEFAULT_CONFIG: OrgComplianceConfig = {
  enabledPacks: [],
  detectorOverrides: {},
  auditLevel: 'summary',
  allowUserOverride: false,
};

interface CacheEntry {
  config: OrgComplianceConfig;
  expiresAt: number;
}

/** TTL for cache entries (60 seconds) */
const CACHE_TTL_MS = 60_000;

const cache = new Map<string, CacheEntry>();

/** Get compliance config for an org, with in-memory caching */
export async function getComplianceConfig(
  orgId: string,
): Promise<OrgComplianceConfig> {
  // Check cache
  const cached = cache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  try {
    const org = await prisma.org.findUnique({
      where: { id: orgId },
      select: { settings: true },
    });

    const settings = (org?.settings as Record<string, unknown>) ?? {};
    const compliance = (settings.compliance ?? DEFAULT_CONFIG) as OrgComplianceConfig;

    // Normalize
    const config: OrgComplianceConfig = {
      enabledPacks: compliance.enabledPacks ?? [],
      detectorOverrides: compliance.detectorOverrides ?? {},
      auditLevel: compliance.auditLevel ?? 'summary',
      allowUserOverride: compliance.allowUserOverride ?? false,
    };

    // Cache it
    cache.set(orgId, {
      config,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return config;
  } catch (err) {
    logger.error({ err, orgId }, 'Failed to load compliance config');
    return DEFAULT_CONFIG;
  }
}

/** Invalidate cache for an org (called after config updates) */
export function invalidateComplianceCache(orgId: string): void {
  cache.delete(orgId);
}

/** Clear entire cache (for tests) */
export function clearComplianceCache(): void {
  cache.clear();
}
