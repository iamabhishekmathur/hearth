import { Router } from 'express';
import { z } from 'zod';
import type { MemoryLayer } from '@hearth/shared';
import { requireAuth } from '../middleware/auth.js';
import * as memoryService from '../services/memory-service.js';
import { generateEmbedding } from '../services/embedding-service.js';
import {
  VersionConflictError,
  listMemoryVersions,
  rollbackMemory,
} from '../services/knowledge-versions.js';
import { isMemoryOwner, validateOwner } from '../services/knowledge-owner.js';
import { logAudit } from '../services/audit-service.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

const router: ReturnType<typeof Router> = Router();

/** Re-embed an entry after its content changed. Fire-and-forget. */
function reembed(entryId: string, content: string): void {
  generateEmbedding(content)
    .then(async (embedding) => {
      if (embedding) {
        const embeddingStr = `[${embedding.join(',')}]`;
        await prisma.$executeRawUnsafe(
          `UPDATE memory_entries SET embedding = $1::vector WHERE id = $2`,
          embeddingStr,
          entryId,
        );
      }
    })
    .catch((err) => {
      logger.warn({ err, entryId }, 'Failed to re-generate embedding');
    });
}

function sendConflict(res: import('express').Response, err: VersionConflictError): void {
  res.status(409).json({
    error: 'This memory entry changed since you loaded it',
    currentVersion: err.currentVersion,
  });
}

function getScope(user: Express.User) {
  return {
    orgId: user.orgId!,
    teamId: user.teamId,
    userId: user.id,
    role: user.role,
  };
}

/**
 * GET /memory — list memory entries with optional layer filter and pagination
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const scope = getScope(req.user!);
    const layer = req.query.layer as MemoryLayer | undefined;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 20;

    const result = await memoryService.listMemory(scope, { layer, page, pageSize });
    res.json({
      data: result.entries,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /memory/:id — get a single memory entry
 */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const scope = getScope(req.user!);
    const entry = await memoryService.getMemory(req.params.id as string, scope);
    if (!entry) {
      res.status(404).json({ error: 'Memory entry not found' });
      return;
    }
    res.json({ data: entry });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /memory — create a memory entry
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const scope = getScope(req.user!);
    const { layer, content, source, sourceRef, expiresAt } = req.body as {
      layer?: MemoryLayer;
      content?: string;
      source?: string;
      sourceRef?: Record<string, unknown>;
      expiresAt?: string;
    };

    if (!layer || !content) {
      res.status(400).json({ error: 'layer and content are required' });
      return;
    }

    const validLayers: MemoryLayer[] = ['org', 'team', 'user'];
    if (!validLayers.includes(layer)) {
      res.status(400).json({ error: 'Invalid layer' });
      return;
    }

    const entry = await memoryService.createMemory(scope, {
      layer,
      content,
      source,
      sourceRef,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    // Generate embedding asynchronously — don't block the response
    reembed(entry.id, content);

    res.status(201).json({ data: entry });
  } catch (err) {
    if ((err as Error).message.includes('Insufficient permissions')) {
      res.status(403).json({ error: (err as Error).message });
      return;
    }
    next(err);
  }
});

/**
 * PATCH /memory/:id — update a memory entry
 */
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const scope = getScope(req.user!);
    const { content, source, sourceRef, expiresAt, expectedVersion } = req.body as {
      content?: string;
      source?: string;
      sourceRef?: Record<string, unknown>;
      expiresAt?: string | null;
      expectedVersion?: number;
    };

    if (
      expectedVersion !== undefined &&
      (!Number.isInteger(expectedVersion) || expectedVersion < 1)
    ) {
      res.status(400).json({ error: 'expectedVersion must be a positive integer' });
      return;
    }

    const entry = await memoryService.updateMemory(
      req.params.id as string,
      scope,
      {
        content,
        source,
        sourceRef,
        expiresAt: expiresAt === null ? null : expiresAt ? new Date(expiresAt) : undefined,
      },
      { expectedVersion },
    );

    if (!entry) {
      res.status(404).json({ error: 'Memory entry not found' });
      return;
    }

    // Re-embed if content changed
    if (content) reembed(entry.id, content);

    res.json({ data: entry });
  } catch (err) {
    if (err instanceof VersionConflictError) {
      sendConflict(res, err);
      return;
    }
    if ((err as Error).message.includes('Insufficient permissions')) {
      res.status(403).json({ error: (err as Error).message });
      return;
    }
    next(err);
  }
});

/**
 * DELETE /memory/:id — delete a memory entry
 */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const scope = getScope(req.user!);
    const entry = await memoryService.deleteMemory(req.params.id as string, scope);
    if (!entry) {
      res.status(404).json({ error: 'Memory entry not found' });
      return;
    }
    res.json({ data: entry, message: 'Memory entry deleted' });
  } catch (err) {
    if ((err as Error).message.includes('Insufficient permissions')) {
      res.status(403).json({ error: (err as Error).message });
      return;
    }
    next(err);
  }
});

/**
 * GET /memory/:id/versions — version history, newest first. Anyone who can
 * read the entry can read its history.
 */
router.get('/:id/versions', requireAuth, async (req, res, next) => {
  try {
    const scope = getScope(req.user!);
    const entry = await memoryService.getMemory(req.params.id as string, scope);
    if (!entry) {
      res.status(404).json({ error: 'Memory entry not found' });
      return;
    }
    const page = req.query.page ? parseInt(req.query.page as string, 10) || 1 : 1;
    const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) || 20 : 20;
    const result = await listMemoryVersions(entry.id, page, pageSize);
    res.json({
      data: result.versions,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      currentVersion: entry.version,
    });
  } catch (err) {
    next(err);
  }
});

const rollbackSchema = z.object({ version: z.number().int().positive() });

/**
 * POST /memory/:id/rollback — restore an earlier version's content as a NEW
 * version. Owners only.
 */
router.post('/:id/rollback', requireAuth, async (req, res, next) => {
  try {
    const parsed = rollbackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'version must be a positive integer' });
      return;
    }
    const scope = getScope(req.user!);
    const entry = await memoryService.getMemory(req.params.id as string, scope);
    if (!entry) {
      res.status(404).json({ error: 'Memory entry not found' });
      return;
    }
    if (!isMemoryOwner(scope, entry)) {
      res.status(403).json({ error: 'Only an owner of this memory entry can roll it back' });
      return;
    }

    const result = await rollbackMemory(entry.id, parsed.data.version, scope.userId);
    if (result.status === 'not_found') {
      res.status(404).json({ error: 'Memory entry not found' });
      return;
    }
    if (result.status === 'version_not_found') {
      res.status(404).json({ error: `Version ${parsed.data.version} does not exist` });
      return;
    }
    if (result.status === 'rolled_back') {
      reembed(result.item.id, result.item.content);
      void logAudit({
        orgId: scope.orgId,
        userId: scope.userId,
        action: 'knowledge_rollback',
        entityType: 'memory',
        entityId: entry.id,
        details: { restoredFrom: parsed.data.version, newVersion: result.item.version },
      });
    }
    res.json({ data: result.item, changed: result.status === 'rolled_back' });
  } catch (err) {
    if (err instanceof VersionConflictError) {
      sendConflict(res, err);
      return;
    }
    next(err);
  }
});

const ownerSchema = z.object({ ownerId: z.string().min(1).nullable() });

/**
 * PATCH /memory/:id/owner — name an explicit owner, or null for the default.
 * Admins only.
 */
router.patch('/:id/owner', requireAuth, async (req, res, next) => {
  try {
    const parsed = ownerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'ownerId must be a user id or null' });
      return;
    }
    const scope = getScope(req.user!);
    const entry = await memoryService.getMemory(req.params.id as string, scope);
    if (!entry) {
      res.status(404).json({ error: 'Memory entry not found' });
      return;
    }
    if (scope.role !== 'admin') {
      res.status(403).json({ error: 'Only an admin can change the owner' });
      return;
    }
    if (entry.layer === 'session') {
      res.status(400).json({ error: 'Session notes have no owner' });
      return;
    }
    const { ownerId } = parsed.data;
    if (ownerId) {
      const check = await validateOwner(ownerId, {
        orgId: entry.orgId,
        kind: entry.layer === 'org' ? 'org' : entry.layer === 'team' ? 'team' : 'personal',
        teamId: entry.teamId,
        userId: entry.userId,
      });
      if (!check.ok) {
        res.status(400).json({ error: check.reason });
        return;
      }
    }
    const updated = await prisma.memoryEntry.update({
      where: { id: entry.id },
      data: { ownerId },
    });
    void logAudit({
      orgId: scope.orgId,
      userId: scope.userId,
      action: 'knowledge_owner_change',
      entityType: 'memory',
      entityId: entry.id,
      details: { from: entry.ownerId, to: ownerId },
    });
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /memory/search — hybrid vector + FTS search
 */
router.post('/search', requireAuth, async (req, res, next) => {
  try {
    const scope = getScope(req.user!);
    const { query, layer, limit } = req.body as {
      query?: string;
      layer?: MemoryLayer;
      limit?: number;
    };

    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const validLayers: MemoryLayer[] = ['org', 'team', 'user'];
    if (layer && !validLayers.includes(layer)) {
      res.status(400).json({ error: 'Invalid layer' });
      return;
    }

    // Generate embedding for the search query
    const embedding = await generateEmbedding(query);

    const results = await memoryService.searchMemory(scope, query, {
      layer,
      limit,
      embedding: embedding ?? undefined,
    });

    res.json({ data: results });
  } catch (err) {
    next(err);
  }
});

export default router;
