import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import * as userService from '../../services/user-service.js';
import type { UserRole } from '@hearth/shared';

const router: ReturnType<typeof Router> = Router();

/**
 * GET /admin/users — list users with pagination
 */
router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 20;
    const teamId = req.query.teamId as string | undefined;
    const role = req.query.role as UserRole | undefined;

    const result = await userService.listUsers({ page, pageSize, teamId, role });
    res.json({
      data: result.users.map(userService.sanitizeUser),
      total: result.total,
      page,
      pageSize,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/users/:id — update user role or name
 */
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { name, role, teamId } = req.body as {
      name?: string;
      role?: UserRole;
      teamId?: string;
    };

    let user;
    if (teamId) {
      user = await userService.updateUserTeam(req.params.id as string, teamId);
    }
    if (name || role) {
      user = await userService.updateUser(req.params.id as string, { name, role });
    }

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ data: userService.sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /admin/users/:id — deactivate (delete) a user
 */
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (req.params.id as string === req.user!.id) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }
    await userService.deleteUser(req.params.id as string);
    res.json({ message: 'User deactivated' });
  } catch (err) {
    next(err);
  }
});

export default router;
