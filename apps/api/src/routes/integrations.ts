import { Router, type Router as RouterType } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as integrationService from '../services/integration-service.js';
import { mcpGateway } from '../mcp/gateway.js';

/**
 * Per-user integrations API at /api/v1/integrations.
 *
 * Unlike the admin org-level router (/admin/integrations, requireRole admin),
 * this path is open to every MEMBER (requireAuth only). A member connects their
 * OWN Slack/Gmail/Granola — the connection is scoped to them (userId = me), the
 * on-connect backfill surfaces THEIR tasks + memory, and they can only ever
 * list/manage their own personal integrations plus see org-level ones.
 *
 * Authz invariants enforced here:
 *  - POST always sets userId = the caller (no client-supplied ownership).
 *  - DELETE / health only resolve an integration the caller OWNS (userId = me);
 *    org-level (null userId) and other members' personal integrations 404.
 */
const router: RouterType = Router();

router.use(requireAuth);

/**
 * GET /integrations — my personal integrations + org-level ones in my org.
 */
router.get('/', async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.status(400).json({ error: 'User has no organization' });
      return;
    }

    const integrations = await integrationService.listUserIntegrations(orgId, req.user!.id);
    res.json({ data: integrations });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /integrations — connect a personal integration scoped to me.
 */
router.post('/', async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.status(400).json({ error: 'User has no organization' });
      return;
    }

    const { provider, credentials, serverUrl, label } = req.body as {
      provider: string;
      credentials: Record<string, string>;
      serverUrl?: string;
      label?: string;
    };

    if (!provider || !credentials) {
      res.status(400).json({ error: 'provider and credentials are required' });
      return;
    }

    const integration = await integrationService.connectIntegration(orgId, {
      provider,
      credentials,
      serverUrl,
      label,
      // Force ownership to the caller — never trust a client-supplied userId.
      userId: req.user!.id,
    });

    res.status(201).json({ data: integration });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /integrations/:id — disconnect one of MY integrations.
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.status(400).json({ error: 'User has no organization' });
      return;
    }

    const owned = await integrationService.getUserManagedIntegration(
      req.params.id,
      orgId,
      req.user!.id,
    );
    if (!owned) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }

    await integrationService.disconnectIntegration(owned.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * GET /integrations/:id/health — health check for one of MY integrations.
 */
router.get('/:id/health', async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.status(400).json({ error: 'User has no organization' });
      return;
    }

    const owned = await integrationService.getUserManagedIntegration(
      req.params.id,
      orgId,
      req.user!.id,
    );
    if (!owned) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }

    const health = await mcpGateway.healthCheck(owned.id);
    res.json({ health });
  } catch (err) {
    next(err);
  }
});

export default router;
