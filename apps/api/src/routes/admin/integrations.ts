import { Router, type Router as RouterType } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import * as integrationService from '../../services/integration-service.js';
import { mcpGateway } from '../../mcp/gateway.js';

const router: RouterType = Router();

// All admin routes require authentication + admin role
router.use(requireAuth, requireRole('admin'));

/**
 * GET /admin/integrations — list all integrations for the org
 */
router.get('/', async (req, res, next) => {
  try {
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.status(400).json({ error: 'User has no organization' });
      return;
    }

    const integrations = await integrationService.listIntegrations(orgId);
    res.json({ data: integrations });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/integrations — connect a new integration
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
    });

    res.status(201).json({ data: integration });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/integrations/:id — update integration config
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { credentials, enabled } = req.body as {
      credentials?: Record<string, string>;
      enabled?: boolean;
    };

    const existing = await integrationService.getIntegration(id);
    if (!existing || existing.orgId !== req.user!.orgId) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }

    const updated = await integrationService.updateIntegration(id, {
      credentials,
      enabled,
    });

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /admin/integrations/:id — disconnect and remove
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await integrationService.getIntegration(id);
    if (!existing || existing.orgId !== req.user!.orgId) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }

    await integrationService.disconnectIntegration(id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/integrations/:id/health — health check
 */
router.get('/:id/health', async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await integrationService.getIntegration(id);
    if (!existing || existing.orgId !== req.user!.orgId) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }

    const health = await mcpGateway.healthCheck(id);
    res.json({ health });
  } catch (err) {
    next(err);
  }
});

export default router;
