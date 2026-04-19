import { createHmac, timingSafeEqual } from 'crypto';
import { decrypt } from '../mcp/token-store.js';
import { logger } from '../lib/logger.js';

/**
 * Verifies webhook signatures based on provider-specific algorithms.
 */
export function verifyWebhookSignature(
  provider: string,
  encryptedSecret: string,
  headers: Record<string, string | undefined>,
  rawBody: string,
): boolean {
  const secret = decrypt(encryptedSecret);

  switch (provider) {
    case 'github':
      return verifyGitHub(secret, headers, rawBody);
    case 'jira':
      // Jira uses shared secret in URL — verification is done by URL token presence
      return true;
    case 'notion':
      // Notion doesn't support webhook signatures yet
      return true;
    case 'slack':
      return verifySlack(secret, headers, rawBody);
    default:
      // For unknown providers, check for a basic HMAC-SHA256 header
      return verifyGenericHmac(secret, headers, rawBody);
  }
}

function verifyGitHub(secret: string, headers: Record<string, string | undefined>, rawBody: string): boolean {
  const signature = headers['x-hub-signature-256'];
  if (!signature) {
    logger.warn('GitHub webhook: missing x-hub-signature-256 header');
    return false;
  }

  const hmac = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expected = `sha256=${hmac}`;

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function verifySlack(secret: string, headers: Record<string, string | undefined>, rawBody: string): boolean {
  const timestamp = headers['x-slack-request-timestamp'];
  const signature = headers['x-slack-signature'];
  if (!timestamp || !signature) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const hmac = createHmac('sha256', secret).update(baseString).digest('hex');
  const expected = `v0=${hmac}`;

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function verifyGenericHmac(secret: string, headers: Record<string, string | undefined>, rawBody: string): boolean {
  const signature = headers['x-webhook-signature'] || headers['x-signature'];
  if (!signature) return true; // No signature header means no verification expected

  const hmac = createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(hmac));
  } catch {
    return false;
  }
}
