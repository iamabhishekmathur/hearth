import { Router } from 'express';
import { env } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';
import { encrypt } from '../mcp/token-store.js';

const router: ReturnType<typeof Router> = Router();

/**
 * GET /auth/slack — initiate Slack OAuth flow
 */
router.get('/', requireAuth, (_req, res) => {
  const clientId = env.SLACK_CLIENT_ID;
  if (!clientId) {
    res.status(500).json({ error: 'Slack OAuth not configured' });
    return;
  }

  const scopes = 'channels:read,chat:write,search:read,im:read,groups:read';
  const redirectUri = `${env.API_URL}/api/v1/auth/slack/callback`;
  const url = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  res.json({ data: { url } });
});

/**
 * GET /auth/slack/callback — handle OAuth callback
 */
router.get('/callback', requireAuth, async (req, res, next) => {
  try {
    const { code } = req.query as { code?: string };
    if (!code) {
      res.status(400).json({ error: 'Missing authorization code' });
      return;
    }

    const clientId = env.SLACK_CLIENT_ID;
    const clientSecret = env.SLACK_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      res.status(500).json({ error: 'Slack OAuth not configured' });
      return;
    }

    const redirectUri = `${env.API_URL}/api/v1/auth/slack/callback`;

    // Exchange code for token
    const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenRes.json() as Record<string, unknown>;
    if (!tokenData.ok) {
      logger.error({ error: tokenData.error }, 'Slack OAuth token exchange failed');
      res.status(400).json({ error: 'Slack OAuth failed' });
      return;
    }

    // Store the integration
    const orgId = req.user!.orgId;
    if (!orgId) {
      res.status(400).json({ error: 'User must belong to an organization' });
      return;
    }

    const botToken = (tokenData.access_token as string) ?? '';
    const teamInfo = tokenData.team as Record<string, unknown> | undefined;

    // Encrypt the bot token before storing (AES-256-GCM)
    const encryptedToken = encrypt(botToken);

    await prisma.integration.upsert({
      where: {
        id: `slack-${orgId}`,
      },
      create: {
        id: `slack-${orgId}`,
        orgId,
        provider: 'slack',
        config: {
          bot_token: encryptedToken,
          bot_token_encrypted: true,
          team_id: teamInfo?.id ?? '',
          team_name: teamInfo?.name ?? '',
        },
        status: 'active',
        enabled: true,
      },
      update: {
        config: {
          bot_token: encryptedToken,
          bot_token_encrypted: true,
          team_id: teamInfo?.id ?? '',
          team_name: teamInfo?.name ?? '',
        },
        status: 'active',
        enabled: true,
      },
    });

    logger.info({ orgId }, 'Slack integration connected');

    // Redirect back to settings page
    res.redirect(`${env.WEB_URL}/#/settings`);
  } catch (err) {
    next(err);
  }
});

export default router;
