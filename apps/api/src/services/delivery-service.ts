import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { emitToUser } from '../ws/socket-manager.js';
import * as slackService from './slack-service.js';
import * as emailService from './email-service.js';
import { decrypt } from '../mcp/token-store.js';

export type DeliveryChannel = 'in_app' | 'slack' | 'email';

export interface DeliveryPayload {
  userId: string;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  channels: DeliveryChannel[];
  metadata?: Record<string, unknown>;
}

/**
 * Delivers a message to the user via configured channels.
 * Supports in-app (WebSocket), Slack, and email (SMTP).
 */
export async function deliver(payload: DeliveryPayload): Promise<void> {
  for (const channel of payload.channels) {
    try {
      switch (channel) {
        case 'in_app':
          emitToUser(payload.userId, 'notification', {
            type: 'routine_result',
            title: payload.title,
            body: payload.body,
            entityType: payload.entityType,
            entityId: payload.entityId,
            metadata: payload.metadata,
            timestamp: new Date().toISOString(),
          });
          break;

        case 'slack': {
          // Find the Slack integration for the user's org
          const user = await prisma.user.findUnique({
            where: { id: payload.userId },
            include: { team: { select: { orgId: true } } },
          });
          if (!user?.team?.orgId) break;

          const integration = await prisma.integration.findFirst({
            where: { orgId: user.team.orgId, provider: 'slack', enabled: true, status: 'active' },
          });
          if (!integration) {
            logger.info({ userId: payload.userId }, 'No active Slack integration for delivery');
            break;
          }

          const config = integration.config as Record<string, unknown>;
          const rawToken = config.bot_token as string;
          const botToken = config.bot_token_encrypted ? decrypt(rawToken) : rawToken;
          const slackChannel = (payload.metadata?.slackChannel as string) ?? 'general';

          if (botToken) {
            await slackService.postMessage(
              botToken,
              slackChannel,
              `*${payload.title}*\n${payload.body}\n\n_Powered by Hearth_`,
            );
          }
          break;
        }

        case 'email': {
          if (!emailService.isEmailConfigured()) {
            logger.info({ userId: payload.userId }, 'Email delivery skipped: SMTP not configured');
            break;
          }

          const emailUser = await prisma.user.findUnique({
            where: { id: payload.userId },
            select: { email: true, name: true },
          });
          if (!emailUser?.email) break;

          await emailService.sendEmail({
            to: emailUser.email,
            subject: payload.title,
            text: payload.body,
            html: `<h2>${payload.title}</h2><p>${payload.body}</p><br/><small><em>Powered by Hearth</em></small>`,
          });
          break;
        }
      }
    } catch (err) {
      logger.error({ err, channel, userId: payload.userId }, 'Delivery failed');
    }
  }
}
