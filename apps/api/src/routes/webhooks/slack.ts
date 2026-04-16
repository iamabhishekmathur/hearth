import { Router } from 'express';
import express from 'express';
import { env } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import * as slackService from '../../services/slack-service.js';
import * as taskService from '../../services/task-service.js';
import { enqueueSlackMessage } from '../../jobs/work-intake-scheduler.js';

/** Typed Slack event payloads */
interface SlackEventPayload {
  type: 'url_verification' | 'event_callback' | 'interactive_message';
  challenge?: string;
  team_id?: string;
  event?: {
    type: string;
    text?: string;
    user?: string;
    bot_id?: string;
    channel?: string;
    ts?: string;
    client_msg_id?: string;
  };
  payload?: string;
  actions?: SlackAction[];
}

interface SlackAction {
  action_id?: string;
  value?: string;
}

const router: ReturnType<typeof Router> = Router();

// Need raw body for signature verification
router.use(express.raw({ type: 'application/json' }));

/**
 * POST /webhooks/slack — handle Slack events and interactions
 */
router.post('/', async (req, res) => {
  const signingSecret = env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    res.status(500).json({ error: 'Slack signing secret not configured' });
    return;
  }

  const rawBody = typeof req.body === 'string' ? req.body : req.body.toString();
  const timestamp = req.headers['x-slack-request-timestamp'] as string;
  const signature = req.headers['x-slack-signature'] as string;

  if (!timestamp || !signature) {
    res.status(400).json({ error: 'Missing Slack headers' });
    return;
  }

  // Verify signature
  if (!slackService.verifySlackSignature(signingSecret, timestamp, rawBody, signature)) {
    logger.warn('Slack webhook signature verification failed');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  const payload = JSON.parse(rawBody) as SlackEventPayload;

  // URL verification challenge
  if (payload.type === 'url_verification') {
    res.json({ challenge: payload.challenge });
    return;
  }

  // Event callback
  if (payload.type === 'event_callback') {
    const event = payload.event;
    if (!event) { res.status(200).send(); return; }

    logger.info({ eventType: event.type }, 'Slack event received');

    // Acknowledge immediately
    res.status(200).send();

    // Process message events for work intake
    if (event.type === 'message' && !event.bot_id && event.text) {
      // Find users in the org that owns this Slack integration
      const teamId = payload.team_id ?? '';
      const integration = await prisma.integration.findFirst({
        where: { provider: 'slack', config: { path: ['team_id'], equals: teamId } },
        include: { org: { include: { teams: { include: { users: { select: { id: true } } } } } } },
      });

      if (integration) {
        for (const team of integration.org.teams) {
          for (const user of team.users) {
            enqueueSlackMessage(user.id, {
              text: event.text,
              from: event.user ?? 'unknown',
              messageId: event.client_msg_id ?? `${event.ts}`,
              channel: event.channel ?? '',
            }).catch((err) => logger.error({ err }, 'Failed to enqueue Slack intake'));
          }
        }
      }
    }
    return;
  }

  // Interactive message (button clicks)
  if (payload.type === 'interactive_message' || typeof payload.payload === 'string') {
    const interactionPayload: SlackEventPayload = typeof payload.payload === 'string'
      ? JSON.parse(payload.payload) as SlackEventPayload
      : payload;

    const actions = interactionPayload.actions ?? [];
    if (actions.length > 0) {
      const action = actions[0];
      const taskId = action.value;

      if (action.action_id === 'task_approve' && taskId) {
        try {
          const task = await prisma.task.findUnique({ where: { id: taskId } });
          if (task) {
            await taskService.updateTask(taskId, task.userId, { status: 'backlog' });
            logger.info({ taskId }, 'Task approved via Slack');
          }
        } catch (err) {
          logger.error({ err, taskId }, 'Failed to approve task via Slack');
        }
      } else if (action.action_id === 'task_dismiss' && taskId) {
        try {
          const task = await prisma.task.findUnique({ where: { id: taskId } });
          if (task) {
            await taskService.updateTask(taskId, task.userId, { status: 'archived' });
            logger.info({ taskId }, 'Task dismissed via Slack');
          }
        } catch (err) {
          logger.error({ err, taskId }, 'Failed to dismiss task via Slack');
        }
      }
    }

    res.status(200).send();
    return;
  }

  res.status(200).send();
});

export default router;
