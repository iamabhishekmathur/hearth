import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';

const router: ReturnType<typeof Router> = Router();

/**
 * GET /admin/teams — list teams for the current org
 */
router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const orgId = req.user!.orgId!;
    const teams = await prisma.team.findMany({
      where: { orgId },
      include: { _count: { select: { users: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ data: teams });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/teams — create a team
 */
router.post('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const team = await prisma.team.create({
      data: { name, orgId: req.user!.orgId! },
    });
    res.status(201).json({ data: team });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/teams/:id — update team name
 */
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { name } = req.body as { name?: string };
    // Org isolation: only update a team that belongs to the admin's org.
    const result = await prisma.team.updateMany({
      where: { id: req.params.id as string, orgId: req.user!.orgId! },
      data: { name },
    });
    if (result.count === 0) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    const team = await prisma.team.findUnique({ where: { id: req.params.id as string } });
    res.json({ data: team });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /admin/teams/:id — delete a team
 */
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    // Org isolation: only delete a team that belongs to the admin's org.
    const result = await prisma.team.deleteMany({
      where: { id: req.params.id as string, orgId: req.user!.orgId! },
    });
    if (result.count === 0) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    res.json({ message: 'Team deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
