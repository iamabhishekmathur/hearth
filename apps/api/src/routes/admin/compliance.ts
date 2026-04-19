import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { getAvailablePacks, resolveDetectors } from '../../compliance/packs/index.js';
import { scrubText, createTokenMap } from '../../compliance/scrubber.js';
import { invalidateComplianceCache } from '../../compliance/config-cache.js';
import type { OrgComplianceConfig } from '../../compliance/types.js';

const router: ReturnType<typeof Router> = Router();

/**
 * GET /admin/compliance/packs — list all available compliance packs
 */
router.get('/packs', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    const packs = getAvailablePacks().map((pack) => ({
      id: pack.id,
      name: pack.name,
      description: pack.description,
      category: pack.category,
      detectorCount: pack.detectors.length,
      detectors: pack.detectors.map((d) => ({
        id: d.id,
        name: d.name,
        entityType: d.entityType,
      })),
      extends: pack.extends,
    }));

    res.json({ data: packs });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/compliance/config — get org's compliance configuration
 */
router.get('/config', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const org = await prisma.org.findUnique({
      where: { id: req.user!.orgId! },
      select: { settings: true },
    });

    const settings = (org?.settings as Record<string, unknown>) ?? {};
    const compliance = (settings.compliance ?? {
      enabledPacks: [],
      detectorOverrides: {},
      auditLevel: 'summary',
      allowUserOverride: false,
    }) as OrgComplianceConfig;

    res.json({ data: compliance });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /admin/compliance/config — update org's compliance configuration
 */
router.put('/config', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const body = req.body as Partial<OrgComplianceConfig>;

    // Validate pack IDs
    const availableIds = new Set(getAvailablePacks().map((p) => p.id));
    if (body.enabledPacks) {
      const invalid = body.enabledPacks.filter((id) => !availableIds.has(id));
      if (invalid.length > 0) {
        res.status(400).json({ error: `Unknown compliance packs: ${invalid.join(', ')}` });
        return;
      }
    }

    // Validate audit level
    if (body.auditLevel && !['summary', 'detailed'].includes(body.auditLevel)) {
      res.status(400).json({ error: 'auditLevel must be "summary" or "detailed"' });
      return;
    }

    const org = await prisma.org.findUnique({
      where: { id: req.user!.orgId! },
      select: { settings: true },
    });

    const currentSettings = (org?.settings as Record<string, unknown>) ?? {};
    const currentCompliance = (currentSettings.compliance ?? {}) as Record<string, unknown>;

    const newCompliance: OrgComplianceConfig = {
      enabledPacks: body.enabledPacks ?? (currentCompliance.enabledPacks as string[]) ?? [],
      detectorOverrides: body.detectorOverrides ?? (currentCompliance.detectorOverrides as Record<string, { enabled: boolean }>) ?? {},
      auditLevel: body.auditLevel ?? (currentCompliance.auditLevel as 'summary' | 'detailed') ?? 'summary',
      allowUserOverride: body.allowUserOverride ?? (currentCompliance.allowUserOverride as boolean) ?? false,
    };

    const newSettings = {
      ...currentSettings,
      compliance: newCompliance,
    };

    await prisma.org.update({
      where: { id: req.user!.orgId! },
      data: { settings: newSettings as unknown as Prisma.InputJsonValue },
    });

    // Invalidate config cache so interceptors pick up changes immediately
    invalidateComplianceCache(req.user!.orgId!);

    res.json({ data: newCompliance, message: 'Compliance configuration updated' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/compliance/test — dry-run scrub on sample text
 */
router.post('/test', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { text, packIds } = req.body as { text: string; packIds: string[] };

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    if (!packIds || !Array.isArray(packIds) || packIds.length === 0) {
      res.status(400).json({ error: 'packIds is required and must be a non-empty array' });
      return;
    }

    const detectors = resolveDetectors(packIds);
    const tokenMap = createTokenMap();
    const result = scrubText(text, detectors, tokenMap);

    res.json({
      data: {
        scrubbedText: result.scrubbedText,
        entitiesFound: result.entities.length,
        entities: result.entities.map((e) => ({
          type: e.entityType,
          original: e.originalValue,
          placeholder: e.placeholder,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/compliance/stats — scrubbing statistics from audit logs
 */
router.get('/stats', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const orgId = req.user!.orgId!;

    // Get compliance_scrub audit logs from the last 30 days
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const logs = await prisma.auditLog.findMany({
      where: {
        orgId,
        action: 'compliance_scrub',
        createdAt: { gte: since },
      },
      select: { details: true },
    });

    const entityCounts: Record<string, number> = {};
    const packUsage: Record<string, number> = {};
    let totalScrubs = logs.length;

    for (const log of logs) {
      const details = log.details as Record<string, unknown> | null;
      if (!details) continue;

      // Aggregate entity counts
      const counts = details.entityCounts as Record<string, number> | undefined;
      if (counts) {
        for (const [type, count] of Object.entries(counts)) {
          entityCounts[type] = (entityCounts[type] ?? 0) + count;
        }
      }

      // Aggregate pack usage
      const packs = details.packs as string[] | undefined;
      if (packs) {
        for (const pack of packs) {
          packUsage[pack] = (packUsage[pack] ?? 0) + 1;
        }
      }
    }

    res.json({
      data: {
        totalScrubs,
        entityCounts,
        packUsage,
        period: 'last_30_days',
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
