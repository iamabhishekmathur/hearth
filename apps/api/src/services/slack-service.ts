import crypto from 'node:crypto';
import { logger } from '../lib/logger.js';

/**
 * Verify Slack request signing secret (HMAC-SHA256).
 */
export function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  // Reject requests older than 5 minutes
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature =
    'v0=' + crypto.createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');

  return crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature));
}

/**
 * Post a message to a Slack channel using the Web API.
 */
export async function postMessage(
  botToken: string,
  channel: string,
  text: string,
  blocks?: Record<string, unknown>[],
): Promise<Record<string, unknown>> {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel,
      text,
      ...(blocks && { blocks }),
    }),
  });

  const data = await res.json() as Record<string, unknown>;
  if (!data.ok) {
    logger.error({ error: data.error, channel }, 'Slack postMessage failed');
    throw new Error(`Slack API error: ${data.error}`);
  }

  return data;
}

/**
 * List Slack channels.
 */
export async function listChannels(
  botToken: string,
  limit = 100,
): Promise<Record<string, unknown>[]> {
  const res = await fetch(
    `https://slack.com/api/conversations.list?limit=${limit}&types=public_channel,private_channel`,
    {
      headers: { Authorization: `Bearer ${botToken}` },
    },
  );

  const data = await res.json() as Record<string, unknown>;
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }

  return (data.channels as Record<string, unknown>[]) ?? [];
}

/**
 * Search Slack messages.
 */
export async function searchMessages(
  botToken: string,
  query: string,
  limit = 20,
): Promise<Record<string, unknown>[]> {
  const res = await fetch(
    `https://slack.com/api/search.messages?query=${encodeURIComponent(query)}&count=${limit}`,
    {
      headers: { Authorization: `Bearer ${botToken}` },
    },
  );

  const data = await res.json() as Record<string, unknown>;
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }

  const messages = data.messages as Record<string, unknown> | undefined;
  return (messages?.matches as Record<string, unknown>[]) ?? [];
}

/**
 * Post a task approval message with Block Kit buttons.
 */
export async function postTaskApproval(
  botToken: string,
  channel: string,
  taskId: string,
  taskTitle: string,
  taskDescription: string | null,
): Promise<Record<string, unknown>> {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*New Task Detected:* ${taskTitle}\n${taskDescription ?? ''}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Approve' },
          style: 'primary',
          action_id: 'task_approve',
          value: taskId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Dismiss' },
          action_id: 'task_dismiss',
          value: taskId,
        },
      ],
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: '_Powered by Hearth_' },
      ],
    },
  ];

  return postMessage(botToken, channel, `Task: ${taskTitle}`, blocks);
}
