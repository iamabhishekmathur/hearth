import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { register } from '../../services/auth-service.js';
import { logger } from '../../lib/logger.js';

const router: ReturnType<typeof Router> = Router();

/**
 * GET /admin/setup/status — check if first-run setup is needed
 */
router.get('/status', async (_req, res, next) => {
  try {
    const userCount = await prisma.user.count();
    const hasOrg = (await prisma.org.count()) > 0;

    res.json({
      data: {
        needsSetup: userCount === 0,
        hasAdmin: userCount > 0,
        hasOrg,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/setup/init — first-run setup: create admin + org
 */
router.post('/init', async (req, res, next) => {
  try {
    // Only allow if no users exist
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      res.status(400).json({ error: 'Setup already completed' });
      return;
    }

    const { email, password, name, orgName } = req.body as {
      email: string;
      password: string;
      name: string;
      orgName?: string;
    };

    if (!email || !password || !name) {
      res.status(400).json({ error: 'Email, password, and name are required' });
      return;
    }

    // Register creates admin + org for first user
    const user = await register(email, password, name);

    // Update org name if provided
    if (orgName) {
      const userWithTeam = await prisma.user.findUnique({
        where: { id: user.id },
        include: { team: { include: { org: true } } },
      });
      if (userWithTeam?.team?.org) {
        await prisma.org.update({
          where: { id: userWithTeam.team.org.id },
          data: { name: orgName, slug: orgName.toLowerCase().replace(/[^a-z0-9]/g, '-') },
        });
      }
    }

    logger.info({ userId: user.id, email }, 'First-run setup completed');

    res.status(201).json({
      data: {
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        message: 'Setup completed. You can now log in.',
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/setup/test-llm — test LLM provider connection with a real API call
 */
router.post('/test-llm', async (req, res, next) => {
  try {
    const { provider, apiKey } = req.body as { provider: string; apiKey?: string };

    const envKey: Record<string, string | undefined> = {
      anthropic: process.env.ANTHROPIC_API_KEY,
      openai: process.env.OPENAI_API_KEY,
      ollama: process.env.OLLAMA_BASE_URL,
    };

    const key = apiKey?.trim() || envKey[provider];

    if (!key) {
      res.json({ data: { connected: false, message: `No API key provided for ${provider}` } });
      return;
    }

    if (provider === 'anthropic') {
      const resp = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      });
      if (!resp.ok) {
        res.json({ data: { connected: false, message: 'Invalid Anthropic API key' } });
        return;
      }
    } else if (provider === 'openai') {
      const resp = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!resp.ok) {
        res.json({ data: { connected: false, message: 'Invalid OpenAI API key' } });
        return;
      }
    } else if (provider === 'ollama') {
      const base = key.replace(/\/$/, '');
      const resp = await fetch(`${base}/api/tags`).catch(() => null);
      if (!resp?.ok) {
        res.json({ data: { connected: false, message: 'Cannot reach Ollama at that URL' } });
        return;
      }
    } else {
      res.status(400).json({ error: 'Unknown provider' });
      return;
    }

    res.json({ data: { connected: true, message: `Connected to ${provider} successfully` } });
  } catch (err) {
    next(err);
  }
});

export default router;
