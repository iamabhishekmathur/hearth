import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config.js';
import { requireAuth, requireOrg } from '../middleware/auth.js';
import { authRateLimit } from '../middleware/rate-limiter.js';
import { logger } from '../lib/logger.js';
import * as chatgptPlan from '../services/chatgpt-plan-service.js';
import { ChatGPTAuthError } from '../services/chatgpt-plan-service.js';

/**
 * Sign in with ChatGPT — connect a ChatGPT plan to an existing Hearth account.
 *
 *   POST   /api/v1/auth/chatgpt/start     → { url } to open (CSRF-protected)
 *   GET    /api/v1/auth/chatgpt/callback  → OAuth redirect target (127.0.0.1 in OSS)
 *   GET    /api/v1/me/chatgpt-plan        → connection status
 *   PATCH  /api/v1/me/chatgpt-plan        → { useForChat?, defaultModel?, acknowledgeWelcome? }
 *   GET    /api/v1/me/chatgpt-plan/models → models available on the user's plan
 *   DELETE /api/v1/me/chatgpt-plan        → disconnect (delete stored tokens)
 */

export const chatgptAuthRouter: ReturnType<typeof Router> = Router();
export const chatgptPlanRouter: ReturnType<typeof Router> = Router();

function settingsUrl(result: string): string {
  // Hash-router SPA: carry the result in the query string so the tab route
  // (`#/settings/ai-plan`) stays parseable.
  return `${env.WEB_URL}/?chatgpt=${encodeURIComponent(result)}#/settings/ai-plan`;
}

chatgptAuthRouter.post('/start', authRateLimit, requireAuth, requireOrg, async (req, res, next) => {
  try {
    const url = await chatgptPlan.startAuthorization({ id: req.user!.id, orgId: req.user!.orgId! });
    res.json({ data: { url } });
  } catch (err) {
    if (err instanceof ChatGPTAuthError && err.code === 'not_enabled') {
      res.status(404).json({ error: err.message, code: err.code });
      return;
    }
    next(err);
  }
});

/**
 * OAuth callback. Deliberately NOT behind requireAuth: in the open-source flow
 * it is served on 127.0.0.1, which never carries the user's session cookie.
 * The single-use `state` (stored server-side with the user id + PKCE verifier)
 * is what binds the callback to the user who started it.
 */
chatgptAuthRouter.get('/callback', authRateLimit, async (req, res) => {
  try {
    await chatgptPlan.completeAuthorization(req.query as chatgptPlan.CallbackQuery);
    res.redirect(settingsUrl('connected'));
  } catch (err) {
    const code = err instanceof ChatGPTAuthError ? err.code : 'error';
    if (!(err instanceof ChatGPTAuthError)) logger.error({ err }, 'ChatGPT OAuth callback failed');
    else logger.warn({ code, msg: err.message }, 'ChatGPT OAuth callback rejected');
    res.redirect(settingsUrl(code));
  }
});

chatgptPlanRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    res.json({ data: await chatgptPlan.getStatus(req.user!.id) });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z
  .object({
    useForChat: z.boolean().optional(),
    defaultModel: z.string().min(1).max(200).nullable().optional(),
    acknowledgeWelcome: z.literal(true).optional(),
  })
  .strict();

chatgptPlanRouter.patch('/', requireAuth, async (req, res, next) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    await chatgptPlan.updateSettings(req.user!.id, parsed.data);
    res.json({ data: await chatgptPlan.getStatus(req.user!.id) });
  } catch (err) {
    if (err instanceof ChatGPTAuthError && err.code === 'not_connected') {
      res.status(404).json({ error: err.message, code: err.code });
      return;
    }
    next(err);
  }
});

chatgptPlanRouter.get('/models', requireAuth, async (req, res, next) => {
  try {
    res.json({ data: await chatgptPlan.listPlanModels(req.user!.id) });
  } catch (err) {
    if (err instanceof ChatGPTAuthError) {
      res
        .status(err.code === 'not_connected' ? 404 : 409)
        .json({ error: err.message, code: err.code });
      return;
    }
    next(err);
  }
});

chatgptPlanRouter.delete('/', requireAuth, async (req, res, next) => {
  try {
    await chatgptPlan.disconnect(req.user!.id);
    res.json({
      data: await chatgptPlan.getStatus(req.user!.id),
      message: 'ChatGPT plan disconnected',
    });
  } catch (err) {
    next(err);
  }
});
