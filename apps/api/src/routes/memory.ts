import { Router } from 'express';
import type { MemoryLayer } from '@hearth/shared';
import { requireAuth } from '../middleware/auth.js';
import * as memoryService from '../services/memory-service.js';
import { generateEmbedding } from '../services/embedding-service.js';
import { logger } from '../lib/logger.js';

const router: ReturnType<typeof Router> = Router();

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
    generateEmbedding(content)
      .then(async (embedding) => {
        if (embedding) {
          const embeddingStr = `[${embedding.join(',')}]`;
          const { prisma } = await import('../lib/prisma.js');
          await prisma.$executeRawUnsafe(
            `UPDATE memory_entries SET embedding = $1::vector WHERE id = $2`,
            embeddingStr,
            entry.id,
          );
        }
      })
      .catch((err) => {
        logger.warn({ err, entryId: entry.id }, 'Failed to generate embedding');
      });

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
    const { content, source, sourceRef, expiresAt } = req.body as {
      content?: string;
      source?: string;
      sourceRef?: Record<string, unknown>;
      expiresAt?: string | null;
    };

    const entry = await memoryService.updateMemory(req.params.id as string, scope, {
      content,
      source,
      sourceRef,
      expiresAt: expiresAt === null ? null : expiresAt ? new Date(expiresAt) : undefined,
    });

    if (!entry) {
      res.status(404).json({ error: 'Memory entry not found' });
      return;
    }

    // Re-embed if content changed
    if (content) {
      generateEmbedding(content)
        .then(async (embedding) => {
          if (embedding) {
            const embeddingStr = `[${embedding.join(',')}]`;
            const { prisma } = await import('../lib/prisma.js');
            await prisma.$executeRawUnsafe(
              `UPDATE memory_entries SET embedding = $1::vector WHERE id = $2`,
              embeddingStr,
              entry.id,
            );
          }
        })
        .catch((err) => {
          logger.warn({ err, entryId: entry.id }, 'Failed to re-generate embedding');
        });
    }

    res.json({ data: entry });
  } catch (err) {
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
