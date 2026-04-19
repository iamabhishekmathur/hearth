import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as chainService from '../services/chain-service.js';

const router: ReturnType<typeof Router> = Router();

/**
 * GET /routines/:id/chains — get chains for a routine
 */
router.get('/:id/chains', requireAuth, async (req, res, next) => {
  try {
    const chains = await chainService.getChains(req.params.id as string);
    res.json({ data: chains });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /routines/:id/chains — create a chain from this routine
 */
router.post('/:id/chains', requireAuth, async (req, res, next) => {
  try {
    const { targetRoutineId, condition, parameterMapping } = req.body as {
      targetRoutineId?: string;
      condition?: string;
      parameterMapping?: Record<string, string>;
    };

    if (!targetRoutineId) {
      res.status(400).json({ error: 'targetRoutineId is required' });
      return;
    }

    const chain = await chainService.createChain({
      sourceRoutineId: req.params.id as string,
      targetRoutineId,
      condition,
      parameterMapping,
    });

    res.status(201).json({ data: chain });
  } catch (err) {
    if (err instanceof Error && (err.message.includes('cycle') || err.message.includes('itself'))) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * DELETE /routines/:id/chains/:chainId — delete a chain
 */
router.delete('/:id/chains/:chainId', requireAuth, async (req, res, next) => {
  try {
    await chainService.deleteChain(req.params.chainId as string);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
