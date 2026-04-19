import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { encrypt } from '../../mcp/token-store.js';
import { loadProviders } from '../../llm/provider-loader.js';
import { getEmbeddingStatus } from '../../services/embedding-service.js';
import { env } from '../../config.js';

const router: ReturnType<typeof Router> = Router();

const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o3-mini', 'o4-mini'],
  ollama: [],
};

const VISION_CAPABLE_MODELS = new Set([
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5-20251001',
  'gpt-4o',
  'gpt-4o-mini',
  'o4-mini',
]);

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  ollama: 'Ollama (local)',
};

/**
 * GET /admin/llm-config — get org LLM settings (defaultProvider + defaultModel)
 */
router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const org = await prisma.org.findUnique({
      where: { id: req.user!.orgId! },
      select: { settings: true },
    });
    const settings = (org?.settings as Record<string, unknown>) ?? {};
    const llm = (settings.llm ?? {}) as Record<string, unknown>;
    res.json({
      data: {
        defaultProvider: llm.defaultProvider ?? null,
        defaultModel: llm.defaultModel ?? null,
        visionEnabled: llm.visionEnabled ?? true,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /admin/llm-config — update default provider and model
 */
router.put('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { defaultProvider, defaultModel, visionEnabled } = req.body as {
      defaultProvider?: string;
      defaultModel?: string;
      visionEnabled?: boolean;
    };

    const org = await prisma.org.findUnique({
      where: { id: req.user!.orgId! },
      select: { settings: true },
    });

    const currentSettings = (org?.settings as Record<string, unknown>) ?? {};
    const llm = (currentSettings.llm ?? {}) as Record<string, unknown>;
    const newSettings = {
      ...currentSettings,
      llm: { ...llm, defaultProvider, defaultModel, visionEnabled },
    };

    await prisma.org.update({
      where: { id: req.user!.orgId! },
      data: { settings: newSettings as Prisma.InputJsonValue },
    });

    // Apply new default in the live registry
    await loadProviders();

    res.json({ data: { defaultProvider, defaultModel, visionEnabled }, message: 'LLM configuration updated' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/llm-config/providers — return configured status for each provider
 */
router.get('/providers', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const org = await prisma.org.findUnique({
      where: { id: req.user!.orgId! },
      select: { settings: true },
    });

    const settings = (org?.settings as Record<string, unknown>) ?? {};
    const llm = (settings.llm ?? {}) as Record<string, unknown>;
    const encryptedKeys = (llm.encryptedKeys ?? {}) as Record<string, string>;

    const providers = ['anthropic', 'openai', 'ollama'].map((id) => {
      const hasDbKey = !!encryptedKeys[id];
      const hasEnvKey = id === 'anthropic'
        ? !!env.ANTHROPIC_API_KEY
        : id === 'openai'
          ? !!env.OPENAI_API_KEY
          : !!env.OLLAMA_BASE_URL;

      const visionModels = PROVIDER_MODELS[id].filter((m) => VISION_CAPABLE_MODELS.has(m));

      return {
        id,
        name: PROVIDER_NAMES[id],
        configured: hasDbKey || hasEnvKey,
        keySource: hasDbKey ? 'db' : hasEnvKey ? 'env' : null,
        models: PROVIDER_MODELS[id],
        supportsVision: visionModels.length > 0 || id === 'ollama',
        visionCapableModels: visionModels,
      };
    });

    // Include embedding status alongside providers
    const embedding = getEmbeddingStatus();

    res.json({ data: providers, embedding });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/llm-config/embedding — return embedding provider status
 */
router.get('/embedding', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    const status = getEmbeddingStatus();
    res.json({ data: status });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/llm-config/keys — save an encrypted API key for a provider
 */
router.post('/keys', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { provider, apiKey } = req.body as { provider: string; apiKey: string };

    if (!['anthropic', 'openai', 'ollama'].includes(provider)) {
      res.status(400).json({ error: 'Invalid provider. Must be anthropic, openai, or ollama.' });
      return;
    }
    if (!apiKey?.trim()) {
      res.status(400).json({ error: 'API key is required' });
      return;
    }

    const encryptedKey = encrypt(apiKey.trim());

    const org = await prisma.org.findUnique({
      where: { id: req.user!.orgId! },
      select: { settings: true },
    });

    const currentSettings = (org?.settings as Record<string, unknown>) ?? {};
    const llm = (currentSettings.llm ?? {}) as Record<string, unknown>;
    const encryptedKeys = (llm.encryptedKeys ?? {}) as Record<string, string>;

    const newSettings = {
      ...currentSettings,
      llm: {
        ...llm,
        encryptedKeys: { ...encryptedKeys, [provider]: encryptedKey },
      },
    };

    await prisma.org.update({
      where: { id: req.user!.orgId! },
      data: { settings: newSettings as Prisma.InputJsonValue },
    });

    // Hot-reload providers so chat works immediately
    await loadProviders();

    res.json({ data: { provider, configured: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
