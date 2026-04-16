import { Router } from 'express';
import type { SkillScope, SkillStatus } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import * as skillService from '../services/skill-service.js';
import * as proposalService from '../services/skill-proposal-service.js';
import { logger } from '../lib/logger.js';

const router: ReturnType<typeof Router> = Router();

/**
 * GET /installed — list current user's installed skills
 * NOTE: This must be defined before /:id to avoid matching "installed" as an id.
 */
router.get('/installed', requireAuth, async (req, res, next) => {
  try {
    const skills = await skillService.getUserSkills(req.user!.id);
    res.json({ data: skills });
  } catch (err) {
    next(err);
  }
});

/**
 * GET / — list available skills with optional search/filter
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { search, scope, status } = req.query as {
      search?: string;
      scope?: SkillScope;
      status?: SkillStatus;
    };

    if (!req.user!.orgId) {
      res.status(400).json({ error: 'User must belong to an organization' });
      return;
    }

    const skills = await skillService.listSkills(req.user!.orgId, {
      search,
      scope,
      status,
      installedByUser: req.user!.id,
    });
    res.json({ data: skills });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /:id — get skill detail
 */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const skill = await skillService.getSkill(req.params.id as string);
    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }
    res.json({ data: skill });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /:id — update a skill (admin: status changes for governance; author: content edits)
 */
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const skill = await skillService.getSkill(req.params.id as string);
    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    const isAdmin = req.user!.role === 'admin';
    const isAuthor = skill.authorId === req.user!.id;

    const { status, name, description, content } = req.body as {
      status?: string;
      name?: string;
      description?: string;
      content?: string;
    };

    // Status changes require admin
    if (status && !isAdmin) {
      res.status(403).json({ error: 'Only admins can change skill status' });
      return;
    }

    // Content edits require admin or author
    if ((name || description || content) && !isAdmin && !isAuthor) {
      res.status(403).json({ error: 'Only admins or the skill author can edit a skill' });
      return;
    }

    const data: Record<string, unknown> = {};
    if (status) data.status = status;
    if (name) data.name = name;
    if (description !== undefined) data.description = description;
    if (content) data.content = content;

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const updated = await skillService.updateSkill(req.params.id as string, data);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /:id — delete a skill (admin only)
 */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    // Must come before /:id/install DELETE — Express matches first registered route
    // Since this is /:id (no sub-path) and /:id/install has /install, they don't conflict.
    if (req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Only admins can delete skills' });
      return;
    }

    const skill = await skillService.getSkill(req.params.id as string);
    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    await skillService.deleteSkill(req.params.id as string);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * POST / — create a custom skill
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    if (!req.user!.orgId) {
      res.status(400).json({ error: 'User must belong to an organization' });
      return;
    }

    const { name, description, content, scope, teamId } = req.body as {
      name: string;
      description: string;
      content: string;
      scope?: SkillScope;
      teamId?: string;
    };

    // Personal skills are published immediately; team/org skills need review
    const effectiveStatus = !scope || scope === 'personal' ? 'published' : 'pending_review';

    const skill = await skillService.createSkill({
      orgId: req.user!.orgId,
      authorId: req.user!.id,
      name,
      description,
      content,
      scope,
      teamId,
      status: effectiveStatus as SkillStatus,
    });

    res.status(201).json({ data: skill });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid skill:')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * POST /:id/install — install a skill for the current user
 */
router.post('/:id/install', requireAuth, async (req, res, next) => {
  try {
    const userSkill = await skillService.installSkill(req.user!.id, req.params.id as string);
    res.status(201).json({ data: userSkill });
  } catch (err) {
    if (err instanceof Error && err.message === 'Skill not found') {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * DELETE /:id/install — uninstall a skill for the current user
 */
router.delete('/:id/install', requireAuth, async (req, res, next) => {
  try {
    await skillService.uninstallSkill(req.user!.id, req.params.id as string);
    res.status(204).send();
  } catch (err) {
    if (err instanceof Error && err.message === 'Skill is not installed') {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * GET /proposals — list skill proposals for a task
 */
router.get('/proposals', requireAuth, async (req, res, next) => {
  try {
    const taskId = req.query.taskId as string;
    if (!taskId) {
      res.status(400).json({ error: 'taskId query parameter is required' });
      return;
    }
    const proposals = await proposalService.getProposalsByTask(taskId);
    res.json({ data: proposals });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /:id/submit-for-review — submit a draft skill proposal for review
 */
router.post('/:id/submit-for-review', requireAuth, async (req, res, next) => {
  try {
    const skill = await proposalService.submitForReview(req.params.id as string, req.user!.id);
    if (!skill) {
      res.status(404).json({ error: 'Draft proposal not found' });
      return;
    }
    res.json({ data: skill });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /:id/proposal — dismiss a skill proposal
 */
router.delete('/:id/proposal', requireAuth, async (req, res, next) => {
  try {
    const result = await proposalService.dismissProposal(req.params.id as string, req.user!.id);
    if (!result) {
      res.status(404).json({ error: 'Proposal not found' });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * POST /seed — seeds skills from agent-skills/skills/ into the database (admin only)
 */
router.post('/seed', requireAuth, async (req, res, next) => {
  try {
    if (!req.user!.orgId) {
      res.status(400).json({ error: 'User must belong to an organization' });
      return;
    }

    const results = await skillService.seedSkills(req.user!.orgId, req.user!.id);
    logger.info({ count: results.length }, 'Skills seeded from disk');
    res.json({ data: results });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /import/preview — fetch a SKILL.md from a GitHub URL and parse it for preview
 */
router.post('/import/preview', requireAuth, async (req, res, next) => {
  try {
    const { url } = req.body as { url?: string };
    if (!url) {
      res.status(400).json({ error: 'url is required' });
      return;
    }

    const result = await fetchGitHubSkill(url);
    if (!result) {
      res.status(400).json({ error: 'Could not fetch or parse skill from that URL. Make sure it points to a public SKILL.md file with YAML frontmatter.' });
      return;
    }

    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /import — import a skill from a GitHub URL into the database
 */
router.post('/import', requireAuth, async (req, res, next) => {
  try {
    if (!req.user!.orgId) {
      res.status(400).json({ error: 'User must belong to an organization' });
      return;
    }

    const { url, name, description, content } = req.body as {
      url?: string;
      name?: string;
      description?: string;
      content?: string;
    };

    if (!name || !description || !content) {
      res.status(400).json({ error: 'name, description, and content are required' });
      return;
    }

    const skill = await skillService.createSkill({
      orgId: req.user!.orgId,
      authorId: req.user!.id,
      name,
      description,
      content,
      scope: 'org',
      status: 'pending_review',
    });

    // Store the git ref for provenance
    if (url) {
      const { prisma } = await import('../lib/prisma.js');
      await prisma.skill.update({
        where: { id: skill.id },
        data: { gitRef: url },
      });
    }

    logger.info({ skillName: name, url }, 'Skill imported from GitHub');
    res.status(201).json({ data: skill });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid skill:')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * Fetches a SKILL.md file from a GitHub URL, converts to raw content URL,
 * and parses the YAML frontmatter.
 */
async function fetchGitHubSkill(
  url: string,
): Promise<{ name: string; description: string; content: string } | null> {
  try {
    // Convert GitHub blob URL to raw URL
    let rawUrl = url.trim();
    if (rawUrl.includes('github.com') && rawUrl.includes('/blob/')) {
      rawUrl = rawUrl
        .replace('github.com', 'raw.githubusercontent.com')
        .replace('/blob/', '/');
    }

    const response = await fetch(rawUrl, {
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return null;
    }

    const content = await response.text();

    // Parse YAML frontmatter
    const matter = await import('gray-matter');
    const parsed = matter.default(content);

    const name = parsed.data?.name;
    const description = parsed.data?.description;

    if (!name || !description) {
      return null;
    }

    return { name, description, content };
  } catch {
    return null;
  }
}

export default router;
